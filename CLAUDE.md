# common_business_automations — agent notes

Multi-tenant Gmail→Google Sheets poller on Trigger.dev + Composio. Composio
owns all Google OAuth (this app never sees tokens, only a Composio `userId`
per client). There is deliberately **no web server and no database**: the
roster of clients IS the set of Trigger.dev schedules (one imperative
`poll-inbox` schedule per client, `externalId=userId`), and behavior config is
Trigger.dev env vars (`WATCH_SENDER`, `TARGET_SHEET_ID`). See README.md for
the human-facing walkthrough.

## Load-bearing strings — do not change

- Task ids: `poll-inbox`, `connect-client-gmail`, `connect-client-sheets`,
  `onboard-client`, `offboard-client` (registered schedules reference them).
- Schedule dedup key format: `poll-inbox:<userId>` (idempotent onboarding).
- Sheet column order: date, from, subject, snippet, messageId, threadId,
  sentiment (the sheet's implicit schema).
- Sentiment vocabulary: `happy | neutral | angry` (downstream filters key off
  these exact strings).

## Pins & gotchas

- `@trigger.dev/sdk` and `trigger.dev` are **exact-pinned to the same version**
  — a mismatch aborts `trigger dev`. Never use `npx trigger.dev@latest`; use
  the npm scripts.
- Composio `tools.execute` requires **pinned toolkit versions** ("latest" is
  rejected) — pinned in `src/lib/composio.ts`, overridable via env.
- The cron lives **server-side in each schedule**: editing `DEFAULT_POLL_CRON`
  changes nothing for existing clients until `npm run reschedule` or a
  re-onboard (`/refresh` skill).
- Composio's raw `GMAIL_FETCH_EMAILS` response is ~70KB **per email**; it never
  leaves `composio.ts` (trimmed to `EmailSummary`). Don't log it whole.
- Sentiment runs on Claude via the official Anthropic SDK (`claude-opus-4-8`
  default; `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` env vars). Failures degrade
  to `neutral` — never let sentiment block the sheet write.
- In DEV, triggered runs execute only while `npm run dev` is connected.

## Commands

| Command | What |
|---|---|
| `npm run dev` / `npm run deploy` | Trigger.dev dev worker / deploy (pinned CLI) |
| `npm run typecheck` | `tsc --noEmit` over src/ + scripts/ |
| `npm run connect -- gmail\|sheets <userId>` | print Composio consent URL |
| `npm run onboard -- <userId> [cron] [--prod]` | (re)create the client's poll schedule |
| `npm run offboard -- <userId>` | remove the client's poll schedule |
| `npm run reschedule -- [cron] [--dry-run]` | bulk-update existing schedules' cron |

## Files

- `src/lib/composio.ts` — Composio adapter: auth configs, connections, email
  fetch (returns `EmailSummary[]`), sheet append.
- `src/lib/sentiment.ts` — `classifySentiment` (lazy client singleton).
- `src/trigger/clients.ts` — lifecycle tasks + `DEFAULT_POLL_CRON`.
- `src/trigger/poll-inbox.ts` — the per-client poll task.
- `scripts/cli.ts` — all four CLI subcommands (thin wrappers over the tasks).

An architecture diagram can be regenerated on demand with the `/viz` skill.
