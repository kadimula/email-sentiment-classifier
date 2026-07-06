/**
 * Fire a connect task from the CLI and print the Composio consent URL.
 *
 * Both Gmail and Google Sheets link the same way (Composio hosts the OAuth
 * consent page); this triggers `connect-client-<toolkit>` and surfaces the
 * `redirectUrl` from the run output so you can open it and approve access.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/connect.ts <gmail|sheets> <userId> [--prod]
 */
import { tasks, runs, configure } from "@trigger.dev/sdk";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const positional = argv.filter((a) => !a.startsWith("--"));
const toolkit = positional[0]; // "gmail" | "sheets"
const userId = positional[1];

const TASK_ID: Record<string, string> = {
  gmail: "connect-client-gmail",
  sheets: "connect-client-sheets",
};

if (!userId || !TASK_ID[toolkit]) {
  console.error(
    "Usage: node --env-file=.env --import tsx scripts/connect.ts <gmail|sheets> <userId> [--prod]",
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
console.log(`→ Connecting ${toolkit} for "${userId}" in ${env}…`);

const handle = await tasks.trigger(TASK_ID[toolkit], { userId });
console.log(`  run: ${handle.id}`);

const result = await runs.poll(handle.id, { pollIntervalMs: 1500 });

if (result.status === "COMPLETED") {
  const redirectUrl = (result.output as any)?.redirectUrl;
  console.log("\n✓ Open this URL to approve access:\n");
  console.log(`   ${redirectUrl}\n`);
  console.log("After approving, run: npm run onboard -- " + userId);
} else {
  console.error(`✗ Run ${result.status}`, result.error ?? "");
  process.exit(1);
}
