import { Composio } from "@composio/core";

/**
 * Reusable Gmail auth + tooling layer, backed by Composio.
 *
 * This is the piece that makes "connect a client's Gmail" easy: Composio hosts
 * the OAuth connect flow, stores + auto-refreshes each client's tokens, and
 * exposes Gmail as callable tools. Nothing in this app ever sees a refresh
 * token — we only ever hold a Composio `userId` per client.
 *
 * Everything downstream (the connect/onboarding task, the Trigger.dev fan-out
 * task, the agent step) depends only on the small surface exported here, so the
 * auth provider stays swappable.
 */

const GMAIL_TOOLKIT = "gmail";
const GOOGLESHEETS_TOOLKIT = "googlesheets";

// Manual tool execution (tools.execute, as opposed to letting an LLM provider
// call the tool) requires a *pinned* toolkit version — "latest" is rejected.
// Pin one so the shape of tool responses can't shift under us mid-deploy. Bump
// via COMPOSIO_*_TOOLKIT_VERSION; see toolkit.availableVersions in the API.
// Versions are per-toolkit (not global), so each toolkit is pinned separately.
const GMAIL_TOOLKIT_VERSION =
  process.env.COMPOSIO_GMAIL_TOOLKIT_VERSION ?? "20260702_01";
const GOOGLESHEETS_TOOLKIT_VERSION =
  process.env.COMPOSIO_GOOGLESHEETS_TOOLKIT_VERSION ?? "20260623_00";

let _composio: Composio | null = null;

export function getComposio(): Composio {
  if (_composio) return _composio;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is not set");
  _composio = new Composio({
    apiKey,
    toolkitVersions: {
      [GMAIL_TOOLKIT]: GMAIL_TOOLKIT_VERSION,
      [GOOGLESHEETS_TOOLKIT]: GOOGLESHEETS_TOOLKIT_VERSION,
    },
  });
  return _composio;
}

/**
 * Find-or-create a toolkit's auth config (Composio-managed OAuth) and return its
 * id. Auto-provisioning means you never have to click through the dashboard;
 * the id is stable, so once created you can pin it via an env var to skip the
 * lookup on every cold start. Cached per toolkit so concurrent callers share one
 * in-flight lookup.
 */
const _authConfigIdPromises: Record<string, Promise<string> | undefined> = {};

function ensureAuthConfig(
  toolkit: string,
  opts: { name: string; pinnedId?: string }
): Promise<string> {
  if (opts.pinnedId) return Promise.resolve(opts.pinnedId);
  const cached = _authConfigIdPromises[toolkit];
  if (cached) return cached;

  return (_authConfigIdPromises[toolkit] = (async () => {
    const composio = getComposio();
    const existing = await composio.authConfigs.list({ toolkit });
    if (existing.items.length > 0) return existing.items[0].id;

    const created = await composio.authConfigs.create(toolkit, {
      type: "use_composio_managed_auth",
      name: opts.name,
    });
    return created.id;
  })());
}

export function ensureGmailAuthConfig(): Promise<string> {
  return ensureAuthConfig(GMAIL_TOOLKIT, {
    name: "Gmail (client inboxes)",
    pinnedId: process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID,
  });
}

export function ensureGoogleSheetsAuthConfig(): Promise<string> {
  return ensureAuthConfig(GOOGLESHEETS_TOOLKIT, {
    name: "Google Sheets (client sheets)",
    pinnedId: process.env.COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID,
  });
}

export interface ConnectLink {
  /** Composio-hosted URL to send the client to so they approve access. */
  redirectUrl?: string;
  /** The connected-account id; poll its status to know when it's ACTIVE. */
  connectionId: string;
}

/**
 * Begin linking a client's account for a given toolkit. Returns a hosted URL to
 * redirect them to — they see Google's own account chooser + consent screen,
 * then get bounced back. `userId` is your stable identifier for the client
 * (their id in your DB, their email, a tenant id — your call).
 */
async function startConnection(
  userId: string,
  authConfigId: string
): Promise<ConnectLink> {
  const composio = getComposio();
  const request = await composio.connectedAccounts.link(userId, authConfigId);
  return { redirectUrl: request.redirectUrl ?? undefined, connectionId: request.id };
}

/** Begin linking a client's Gmail. */
export async function startGmailConnection(
  userId: string
): Promise<ConnectLink> {
  return startConnection(userId, await ensureGmailAuthConfig());
}

/** Begin linking a client's Google Sheets (so the agent can write on their behalf). */
export async function startGoogleSheetsConnection(
  userId: string
): Promise<ConnectLink> {
  return startConnection(userId, await ensureGoogleSheetsAuthConfig());
}

/**
 * Whether a given client currently has an ACTIVE connection for a toolkit.
 *
 * Note: Composio lets you filter connections *by* userId but doesn't enumerate
 * userIds back, so the source of truth for "which clients exist" is the set of
 * Trigger.dev schedules (one per user, tagged with externalId=userId; see
 * onboardClient in src/trigger/clients.ts). poll-inbox calls these to skip
 * anyone who hasn't finished (or has revoked) their connection.
 */
async function getConnectionStatus(
  userId: string,
  toolkit: string
): Promise<string | null> {
  const composio = getComposio();
  const res = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
  });
  return res.items[0]?.status ?? null;
}

export function getGmailConnectionStatus(userId: string): Promise<string | null> {
  return getConnectionStatus(userId, GMAIL_TOOLKIT);
}

export function getGoogleSheetsConnectionStatus(
  userId: string
): Promise<string | null> {
  return getConnectionStatus(userId, GOOGLESHEETS_TOOLKIT);
}

/** One email, trimmed to the fields the agent actually cares about. */
export interface EmailSummary {
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
 * log-attribute limit and gets truncated — so the raw blob never leaves this
 * module.
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

/** Fetch a client's most recent emails, trimmed to EmailSummary shape. */
export async function fetchRecentEmails(
  userId: string,
  opts: { maxResults?: number } = {}
): Promise<EmailSummary[]> {
  const composio = getComposio();
  const result = await composio.tools.execute("GMAIL_FETCH_EMAILS", {
    userId,
    arguments: {
      max_results: opts.maxResults ?? 10,
    },
  });
  return summarizeEmails(result);
}

/**
 * Append rows to a Google Sheet as the client, via Composio's Sheets tool.
 *
 * Each element of `rows` is one spreadsheet row (an array of cell values). Rows
 * are added *after* the sheet's existing data (insertDataOption INSERT_ROWS),
 * so repeated polls accumulate rather than clobber earlier writes. `range`
 * scopes the target tab/columns — a bare tab name like "Sheet1" lets Sheets
 * locate the existing table and append below it. `valueInputOption`
 * USER_ENTERED makes Sheets parse dates/numbers as if typed by a person.
 *
 * NOTE: this executes against the client's *Google Sheets* connection, which is
 * a separate Composio toolkit from Gmail — the client must have linked
 * googlesheets under the same `userId` for this to succeed.
 */
export async function appendRowsToSheet(
  userId: string,
  args: {
    spreadsheetId: string;
    rows: (string | number)[][];
    range?: string;
  }
): Promise<unknown> {
  const composio = getComposio();
  return composio.tools.execute("GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", {
    userId,
    arguments: {
      spreadsheetId: args.spreadsheetId,
      range: args.range ?? "Sheet1",
      values: args.rows,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    },
  });
}
