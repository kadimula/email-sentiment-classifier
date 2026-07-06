import { schedules, task, logger } from "@trigger.dev/sdk";
import {
  startGmailConnection,
  getGmailConnectionStatus,
  startGoogleSheetsConnection,
  getGoogleSheetsConnectionStatus,
} from "../lib/composio";
import { pollInbox } from "./poll-inbox";

/**
 * Client lifecycle tasks. A fully onboarded client has TWO Composio
 * connections under the same userId — Gmail (read the inbox) and Google Sheets
 * (write matches) — plus one imperative poll-inbox schedule tagged with
 * externalId=userId. Run each from the dashboard, SDK, or scripts/cli.ts:
 *   1. connect-client-gmail   → Composio consent URL; open + approve
 *   2. connect-client-sheets  → same, for Google Sheets write access
 *   3. onboard-client         → registers the poll schedule once both are
 *                               ACTIVE; idempotent — re-run until it succeeds
 *   offboard-client           → removes the schedule (stops polling)
 */

/** Default poll cadence for a newly onboarded client; override via payload.cron. */
export const DEFAULT_POLL_CRON = "0 */2 * * *"; // every 2 hours

/** Start linking a client's Gmail. Returns the Composio-hosted consent URL. */
export const connectClientGmail = task({
  id: "connect-client-gmail",
  run: async (payload: { userId: string }) => {
    const { userId } = payload;
    if (!userId) throw new Error("userId is required");

    // Composio hosts the OAuth flow; we only ever get back a URL + connection id.
    const { redirectUrl, connectionId } = await startGmailConnection(userId);
    if (!redirectUrl) throw new Error("Composio returned no redirect URL");

    logger.info("Open this URL to approve Gmail access", { userId, redirectUrl });
    // Returned → visible in the run's Output panel, where you can copy the link.
    return {
      userId,
      connectionId,
      redirectUrl,
      next: "Open redirectUrl and approve Gmail, then run connect-client-sheets with the same userId.",
    };
  },
});

/**
 * Start linking a client's Google Sheets. Same hosted-consent flow as Gmail, but
 * a separate Composio toolkit/connection — the poll task writes matched emails
 * into the target sheet on the client's behalf, so this grant is required before
 * onboarding.
 */
export const connectClientSheets = task({
  id: "connect-client-sheets",
  run: async (payload: { userId: string }) => {
    const { userId } = payload;
    if (!userId) throw new Error("userId is required");

    const { redirectUrl, connectionId } = await startGoogleSheetsConnection(userId);
    if (!redirectUrl) throw new Error("Composio returned no redirect URL");

    logger.info("Open this URL to approve Google Sheets access", { userId, redirectUrl });
    return {
      userId,
      connectionId,
      redirectUrl,
      next: "Open redirectUrl and approve Google Sheets, then run onboard-client with the same userId.",
    };
  },
});

/**
 * Register a client for recurring inbox polling. This is what "the roster" is:
 * one Trigger.dev schedule per user, attached to poll-inbox and tagged with
 * externalId=userId so each firing knows whose inbox to read.
 */
export const onboardClient = task({
  id: "onboard-client",
  run: async (payload: { userId: string; cron?: string }) => {
    const { userId, cron = DEFAULT_POLL_CRON } = payload;
    if (!userId) throw new Error("userId is required");

    // Only schedule polling once BOTH Gmail (read) and Sheets (write) are linked
    // — the poll task reads the inbox and writes matches to a sheet, so a missing
    // Sheets grant would make every run fail at the write step.
    const [gmail, sheets] = await Promise.all([
      getGmailConnectionStatus(userId),
      getGoogleSheetsConnectionStatus(userId),
    ]);
    const gmailStatus = gmail ?? "NOT_CONNECTED";
    const sheetsStatus = sheets ?? "NOT_CONNECTED";
    if (gmailStatus !== "ACTIVE" || sheetsStatus !== "ACTIVE") {
      logger.warn(
        "Not onboarding — need both Gmail and Sheets ACTIVE. Run connect-client-gmail / connect-client-sheets first.",
        { userId, gmailStatus, sheetsStatus }
      );
      return { userId, onboarded: false, gmailStatus, sheetsStatus };
    }

    // deduplicationKey makes this idempotent: re-running updates the existing
    // schedule instead of creating a duplicate.
    const schedule = await schedules.create({
      task: pollInbox.id,
      cron,
      externalId: userId,
      deduplicationKey: `poll-inbox:${userId}`,
    });

    logger.info("Onboarded — poll schedule registered", {
      userId,
      scheduleId: schedule.id,
      cron,
    });
    return { userId, onboarded: true, scheduleId: schedule.id, cron };
  },
});

/** Stop polling a client: remove their poll-inbox schedule(s). */
export const offboardClient = task({
  id: "offboard-client",
  run: async (payload: { userId: string }) => {
    const { userId } = payload;
    if (!userId) throw new Error("userId is required");

    // schedules.list() is async-iterable, so this walks every page.
    let removed = 0;
    for await (const s of schedules.list()) {
      if (s.task === pollInbox.id && s.externalId === userId) {
        await schedules.del(s.id);
        removed++;
      }
    }

    logger.info("Offboarded — poll schedules removed", { userId, removed });
    return { userId, removed };
  },
});
