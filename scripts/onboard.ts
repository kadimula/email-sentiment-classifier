/**
 * Fire the `onboard-client` task from the CLI, then wait for its result.
 *
 * This is the imperative "refresh" button: onboard-client (re)creates the
 * per-user poll-inbox schedule via schedules.create with a deduplicationKey, so
 * re-running it picks up any changed DEFAULT_POLL_CRON / cron and *updates* the
 * existing schedule in place instead of making a duplicate.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/onboard.ts <userId> [cron] [--prod]
 *
 * Auth: the SDK needs TRIGGER_SECRET_KEY. We map it from the env-specific key in
 * .env (TRIGGER_SECRET_KEY_DEV by default, _PROD with --prod). Triggering with
 * the dev key creates the run in your DEV environment, which the running
 * `trigger dev` worker then executes.
 */
import { tasks, runs, configure } from "@trigger.dev/sdk";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const positional = argv.filter((a) => !a.startsWith("--"));
const userId = positional[0];
const cron = positional[1]; // optional cron override; omit to use the task default

if (!userId) {
  console.error(
    "Usage: node --env-file=.env --import tsx scripts/onboard.ts <userId> [cron] [--prod]",
  );
  process.exit(1);
}

const secretKey = prod
  ? process.env.TRIGGER_SECRET_KEY_PROD
  : process.env.TRIGGER_SECRET_KEY_DEV;

if (!secretKey) {
  console.error(
    `Missing ${prod ? "TRIGGER_SECRET_KEY_PROD" : "TRIGGER_SECRET_KEY_DEV"} — is .env loaded (node --env-file=.env)?`,
  );
  process.exit(1);
}

configure({ secretKey });

const env = prod ? "PROD" : "DEV";
console.log(`→ Onboarding "${userId}" in ${env}${cron ? ` (cron: ${cron})` : ""}…`);

const handle = await tasks.trigger("onboard-client", {
  userId,
  ...(cron ? { cron } : {}),
});
console.log(`  run: ${handle.id}`);

const result = await runs.poll(handle.id, { pollIntervalMs: 1500 });

if (result.status === "COMPLETED") {
  console.log("✓ Done:", JSON.stringify(result.output, null, 2));
  // onboard-client returns { onboarded: false } when Gmail *or* Sheets isn't
  // ACTIVE yet; the output carries gmailStatus/sheetsStatus so you can tell which.
  if (result.output && (result.output as any).onboarded === false) {
    const { gmailStatus, sheetsStatus } = result.output as any;
    console.log(
      `\n⚠  Not onboarded — need both connections ACTIVE (gmail: ${gmailStatus}, sheets: ${sheetsStatus}).` +
        "\n   Run connect-client-gmail and/or connect-client-sheets first.",
    );
  }
} else {
  console.error(`✗ Run ${result.status}`, result.error ?? "");
  process.exit(1);
}
