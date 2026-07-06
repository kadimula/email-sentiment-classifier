import { schedules, logger } from "@trigger.dev/sdk";
import {
  appendRowsToSheet,
  fetchRecentEmails,
  getGmailConnectionStatus,
} from "../lib/composio";
import { classifySentiment, type Sentiment } from "../lib/sentiment";

/**
 * Per-user Gmail poll — all state lives in Trigger.dev, no external database.
 *
 *   connect-client-gmail (task)   ── returns a Composio OAuth link for a userId
 *   onboard-client (task)         ── after they connect, registers a per-user
 *                                    schedule (schedules.create, externalId=userId)
 *   poll-inbox (this schedule)    ── fires once per onboarded user; the run's
 *                                    `externalId` carries that user's id
 *
 * The "roster" is simply the set of registered schedules (schedules.list()), and
 * all config is Trigger.dev environment variables:
 *   WATCH_SENDER     – substring/address to filter the "from" on (blank = all)
 *   TARGET_SHEET_ID  – Google Sheet to write matches into (next step)
 *
 * poll-inbox has no `cron` of its own, so it's an *imperative* scheduled task:
 * it only runs for the schedules that onboard-client attaches to it.
 */

/** One email, trimmed to the fields we actually care about. */
interface EmailSummary {
  from: string;
  subject: string;
  date: string;
  snippet: string;
  threadId?: string;
  messageId?: string;
}

/**
 * Pull the message array out of Composio's GMAIL_FETCH_EMAILS response and trim
 * each one to a compact, log-friendly shape. The raw response is ~70KB *per
 * email* (full MIME payload + base64 attachments), which blows past Trigger's
 * log-attribute limit and gets truncated — so never log it whole.
 */
function summarizeEmails(raw: unknown): EmailSummary[] {
  const messages = (raw as any)?.data?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((m: any) => ({
    from: m.sender ?? "(unknown)",
    subject: m.subject ?? "(no subject)",
    date: m.messageTimestamp ?? "",
    snippet: (m.preview?.body ?? m.messageText ?? "").toString().slice(0, 200),
    threadId: m.threadId,
    messageId: m.messageId,
  }));
}

/**
 * Imperative per-user schedule. onboard-client attaches one schedule per client
 * with `externalId` = their Composio userId; every firing hands us that id back.
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

    const raw = await fetchRecentEmails(userId, { maxResults: 10 });
    const all = summarizeEmails(raw);

    // Step 2 of the goal: keep only mail from the sender we're watching.
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

    // Step 3 of the goal: write each matched email as a row in the target
    // sheet. We append (never overwrite), so every poll adds new rows below the
    // existing data. Column order here is the sheet's implicit schema — keep it
    // stable, and add a matching header row to the sheet by hand once.
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
