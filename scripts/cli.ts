/**
 * CLI for the client lifecycle — triggers the Trigger.dev tasks and reports
 * their output. One subcommand per operation:
 *
 *   connect     <gmail|sheets> <userId>   → prints the Composio consent URL
 *   onboard     <userId> [cron]           → (re)creates the poll-inbox schedule
 *   offboard    <userId>                  → removes the poll-inbox schedule
 *   reschedule  [cron] [--dry-run]        → bulk-update every existing schedule
 *
 * Usage: node --env-file=.env --import tsx scripts/cli.ts <subcommand> … [--prod]
 * (or the npm aliases: npm run connect|onboard|offboard|reschedule -- …)
 *
 * Auth: the SDK needs TRIGGER_SECRET_KEY; we map it from the env-specific key
 * in .env (TRIGGER_SECRET_KEY_DEV by default, _PROD with --prod). In DEV, runs
 * only execute while a `npm run dev` worker is connected.
 *
 * Note on reschedule: the cron lives server-side in each schedule, so editing
 * DEFAULT_POLL_CRON only affects *newly* onboarded clients. This subcommand
 * walks schedules.list() and updates existing imperative poll-inbox schedules
 * in place (task + externalId + timezone preserved).
 */
import { tasks, runs, schedules, configure } from "@trigger.dev/sdk";
import { pollInbox } from "../src/trigger/poll-inbox";
import { DEFAULT_POLL_CRON } from "../src/trigger/clients";

const USAGE = `Usage: node --env-file=.env --import tsx scripts/cli.ts <subcommand> [args] [--prod]

  connect    <gmail|sheets> <userId>    print the Composio consent URL
  onboard    <userId> [cron]            (re)create the client's poll schedule
  offboard   <userId>                   remove the client's poll schedule
  reschedule [cron] [--dry-run]         bulk-update all poll schedules (default cron: ${DEFAULT_POLL_CRON})`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const dryRun = argv.includes("--dry-run");
const [subcommand, ...positional] = argv.filter((a) => !a.startsWith("--"));

const secretKey = prod
  ? process.env.TRIGGER_SECRET_KEY_PROD
  : process.env.TRIGGER_SECRET_KEY_DEV;
if (!secretKey) {
  fail(
    `Missing ${prod ? "TRIGGER_SECRET_KEY_PROD" : "TRIGGER_SECRET_KEY_DEV"} — is .env loaded (node --env-file=.env)?`,
  );
}
configure({ secretKey });

const env = prod ? "PROD" : "DEV";

/** Trigger a task, wait for it to finish, and return its output (exits on failure). */
async function runTask(taskId: string, payload: Record<string, unknown>): Promise<any> {
  const handle = await tasks.trigger(taskId, payload);
  console.log(`  run: ${handle.id}`);
  const result = await runs.poll(handle.id, { pollIntervalMs: 1500 });
  if (result.status !== "COMPLETED") {
    fail(`✗ Run ${result.status} ${result.error ?? ""}`);
  }
  return result.output;
}

async function connect() {
  const [toolkit, userId] = positional;
  const TASK_ID: Record<string, string> = {
    gmail: "connect-client-gmail",
    sheets: "connect-client-sheets",
  };
  if (!userId || !TASK_ID[toolkit]) fail(USAGE);

  console.log(`→ Connecting ${toolkit} for "${userId}" in ${env}…`);
  const output = await runTask(TASK_ID[toolkit], { userId });
  console.log("\n✓ Open this URL to approve access:\n");
  console.log(`   ${output?.redirectUrl}\n`);
  console.log(`After approving, run: npm run onboard -- ${userId}`);
}

async function onboard() {
  const [userId, cron] = positional;
  if (!userId) fail(USAGE);

  console.log(`→ Onboarding "${userId}" in ${env}${cron ? ` (cron: ${cron})` : ""}…`);
  const output = await runTask("onboard-client", { userId, ...(cron ? { cron } : {}) });
  console.log("✓ Done:", JSON.stringify(output, null, 2));
  if (output?.onboarded === false) {
    console.log(
      `\n⚠  Not onboarded — need both connections ACTIVE (gmail: ${output.gmailStatus}, sheets: ${output.sheetsStatus}).` +
        "\n   Run `npm run connect -- gmail|sheets " + userId + "` first.",
    );
  }
}

async function offboard() {
  const [userId] = positional;
  if (!userId) fail(USAGE);

  console.log(`→ Offboarding "${userId}" in ${env}…`);
  const output = await runTask("offboard-client", { userId });
  console.log("✓ Done:", JSON.stringify(output, null, 2));
}

async function reschedule() {
  const cron = positional[0] ?? DEFAULT_POLL_CRON;
  console.log(
    `→ ${dryRun ? "[dry-run] " : ""}Rescheduling all "${pollInbox.id}" schedules to "${cron}" in ${env}…\n`,
  );

  let matched = 0;
  let updated = 0;
  // schedules.list() is async-iterable and walks every page.
  for await (const s of schedules.list()) {
    if (s.task !== pollInbox.id) continue;
    // Declarative schedules are defined in code and can't be updated via the API.
    if (s.type !== "IMPERATIVE") {
      console.log(`  skip ${s.id} (${s.externalId ?? "no externalId"}) — ${s.type}, not editable`);
      continue;
    }
    matched++;

    const current = s.generator?.expression;
    const who = s.externalId ?? "(no externalId)";

    if (current === cron) {
      console.log(`  = ${who}: already "${cron}" — no change`);
      continue;
    }
    if (dryRun) {
      console.log(`  ~ ${who}: "${current}" → "${cron}"  [${s.id}]`);
      continue;
    }

    await schedules.update(s.id, {
      task: s.task,
      cron,
      ...(s.externalId ? { externalId: s.externalId } : {}),
      ...(s.timezone ? { timezone: s.timezone } : {}),
    });
    updated++;
    console.log(`  ✓ ${who}: "${current}" → "${cron}"`);
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done. ${matched} poll-inbox schedule(s) matched` +
      (dryRun ? "." : `, ${updated} updated.`),
  );
}

const SUBCOMMANDS: Record<string, () => Promise<void>> = {
  connect,
  onboard,
  offboard,
  reschedule,
};

const run = SUBCOMMANDS[subcommand];
if (!run) fail(USAGE);
await run();
