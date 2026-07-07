import { schedules, logger } from "@trigger.dev/sdk";
import {
  appendRowsToSheet,
  fetchRecentEmails,
  getGmailConnectionStatus,
  type EmailSummary,
} from "../lib/composio";
import { classifySentiment, type Sentiment } from "../lib/sentiment";

// Column order is the sheet's implicit schema — keep it stable.
async function writeMatchesToSheet(
  userId: string,
  spreadsheetId: string,
  matched: EmailSummary[],
): Promise<number> {
  const sentiments: Sentiment[] = await Promise.all(matched.map(classifySentiment));
  const rows = matched.map((e, i) => [
    e.date,
    e.from,
    e.subject,
    e.snippet,
    e.messageId ?? "",
    e.threadId ?? "",
    sentiments[i],
  ]);
  await appendRowsToSheet(userId, { spreadsheetId, rows });
  logger.info("Wrote matches to sheet", { userId, targetSheetId: spreadsheetId, written: rows.length });
  return rows.length;
}

// Per-user Gmail poll. Imperative schedule (no cron); onboard-client attaches one
// per client with externalId = their Composio userId. Config via WATCH_SENDER and
// TARGET_SHEET_ID env vars.
export const pollInbox = schedules.task({
  id: "poll-inbox",
  run: async (payload) => {
    // Step 1: Resolve the client from the schedule's externalId.
    const userId = payload.externalId;
    if (!userId) {
      logger.error("poll-inbox fired without an externalId (userId) — skipping");
      return { skipped: true, reason: "no externalId" };
    }

    // Step 2: Skip clients whose Gmail isn't linked/active.
    const status = await getGmailConnectionStatus(userId);
    if (status !== "ACTIVE") {
      logger.warn("Skipping — Gmail not active", { userId, status });
      return { userId, skipped: true, status };
    }

    // Step 3: Read per-environment config from env vars.
    const watchSender = process.env.WATCH_SENDER?.trim();
    const targetSheetId = process.env.TARGET_SHEET_ID?.trim();

    // Step 4: Fetch recent emails and filter by the watched sender.
    const all = await fetchRecentEmails(userId, { maxResults: 10 });
    const matched = watchSender
      ? all.filter((e) => e.from.toLowerCase().includes(watchSender.toLowerCase()))
      : all;

    // Step 5: Log what we polled and matched.
    logger.info("Polled inbox", {
      userId,
      total: all.length,
      matched: matched.length,
      watchSender: watchSender ?? "(all senders)",
    });
    for (const e of matched) {
      logger.info(`✉️  ${e.subject}`, { from: e.from, date: e.date, snippet: e.snippet });
    }

    // Step 6: Classify and append matches to the target sheet.
    let written = 0;
    if (!targetSheetId) {
      logger.warn("TARGET_SHEET_ID not set — matches won't be written to a sheet", { userId });
    } else if (matched.length > 0) {
      written = await writeMatchesToSheet(userId, targetSheetId, matched);
    }

    // Step 7: Return a summary of the run.
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
