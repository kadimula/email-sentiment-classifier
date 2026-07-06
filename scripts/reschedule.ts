/**
 * Bulk-update the cron of every existing poll-inbox schedule (the "roster").
 *
 * Changing DEFAULT_POLL_CRON in src/trigger/gmail-connect.ts only affects
 * *newly* onboarded clients — schedules already registered in Trigger.dev keep
 * their old cadence until updated. This script walks schedules.list(), filters
 * to imperative poll-inbox schedules, and updates each one's cron in place
 * (task + externalId + timezone preserved), so old clients pick up the new
 * cadence without re-running the full onboard flow.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/reschedule.ts [cron] [--prod] [--dry-run]
 *
 * Defaults to every-2-hours cron ("0 " + slash-2 hours) and the DEV environment.
 * Run with --dry-run first to preview which schedules would change.
 */
import { schedules, configure } from "@trigger.dev/sdk";
import { pollInbox } from "../src/trigger/gmail-agent";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const dryRun = argv.includes("--dry-run");
const positional = argv.filter((a) => !a.startsWith("--"));
const cron = positional[0] ?? "0 */2 * * *";

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
