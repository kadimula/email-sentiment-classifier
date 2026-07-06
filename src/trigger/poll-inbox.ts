import { schedules, logger } from "@trigger.dev/sdk";
import {
  appendRowsToSheet,
  fetchRecentEmails,
  getGmailConnectionStatus,
} from "../lib/composio";
import { classifySentiment, type Sentiment } from "../lib/sentiment";

/**
 * Per-user Gmail poll. Imperative schedule: it has no `cron` of its own, so it
 * only fires for the schedules onboard-client attaches (one per client, with
 * `externalId` = their Composio userId). Config is Trigger.dev env vars:
 *   WATCH_SENDER     – substring/address to filter the "from" on (blank = all)
 *   TARGET_SHEET_ID  – Google Sheet matches are appended to
 */
export const pollInbox = schedules.task({
  id: "poll-inbox",
  run: async (payload) => {
    const userId = payload.externalId;
    if (!userId) {
      // Should never happen: onboard-client always sets externalId. A bare
      // firing means someone attached a schedule without one.
      logger.error("poll-inbox fired without an externalId (userId) — skipping");
      return { skipped: true, reason: "no externalId" };
    }

    // Skip anyone who hasn't finished linking (or has revoked) their Gmail.
    const status = await getGmailConnectionStatus(userId);
    if (status !== "ACTIVE") {
      logger.warn("Skipping — Gmail not active", { userId, status });
      return { userId, skipped: true, status };
    }

    // Config lives in Trigger.dev env vars, not in code — set per environment
    // from the dashboard so onboarding a client is data, not a redeploy.
    const watchSender = process.env.WATCH_SENDER?.trim();
    const targetSheetId = process.env.TARGET_SHEET_ID?.trim();

    const all = await fetchRecentEmails(userId, { maxResults: 10 });

    // Keep only mail from the sender we're watching.
    const matched = watchSender
      ? all.filter((e) => e.from.toLowerCase().includes(watchSender.toLowerCase()))
      : all;

    logger.info("Polled inbox", {
      userId,
      total: all.length,
      matched: matched.length,
      watchSender: watchSender ?? "(all senders)",
    });
    for (const e of matched) {
      logger.info(`✉️  ${e.subject}`, { from: e.from, date: e.date, snippet: e.snippet });
    }

    // Write each matched email as a row in the target sheet. We append (never
    // overwrite), so every poll adds new rows below the existing data. Column
    // order here is the sheet's implicit schema — keep it stable, and add a
    // matching header row to the sheet by hand once.
    let written = 0;
    if (!targetSheetId) {
      logger.warn("TARGET_SHEET_ID not set — matches won't be written to a sheet", { userId });
    } else if (matched.length > 0) {
      // One Claude call per matched email (max 10 per poll), run concurrently.
      const sentiments: Sentiment[] = await Promise.all(
        matched.map((e) => classifySentiment(e)),
      );
      const rows = matched.map((e, i) => [
        e.date,
        e.from,
        e.subject,
        e.snippet,
        e.messageId ?? "",
        e.threadId ?? "",
        sentiments[i],
      ]);
      await appendRowsToSheet(userId, { spreadsheetId: targetSheetId, rows });
      written = rows.length;
      logger.info("Wrote matches to sheet", { userId, targetSheetId, written });
    }

    return {
      userId,
      total: all.length,
      matched: matched.length,
      written,
      targetSheetId: targetSheetId ?? null,
      emails: matched,
    };
  },
});
