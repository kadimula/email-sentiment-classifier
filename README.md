# Multi-tenant Gmail agent (Trigger.dev + Composio)

A [Trigger.dev](https://trigger.dev) email agent that watches your clients'
Gmail inboxes. Each client links their own Gmail and Google Sheets once; a
per-client schedule then polls their inbox, keeps mail from the sender you're
watching (`WATCH_SENDER`), classifies each match's tone with one LLM call, and
appends a row per match to a Google Sheet (`TARGET_SHEET_ID`).

**Gmail and Sheets are handled entirely through [Composio](https://composio.dev).**
Composio hosts the Google OAuth consent screens, stores and auto-refreshes each
client's tokens, and exposes Gmail/Sheets as callable tools. This app never
sees a refresh token or a Google client secret — it only ever holds a Composio
`userId` per client. There is no web server and no database: the "roster" is
the set of Trigger.dev schedules (one per client, tagged `externalId=userId`).

## Layout

```
trigger.config.ts            # project ref (from env) + Trigger.dev config
src/lib/composio.ts          # all Gmail + Sheets auth + tooling, via Composio
src/lib/sentiment.ts         # per-email sentiment (Claude, via the Anthropic SDK)
src/trigger/clients.ts       # lifecycle tasks: connect Gmail/Sheets, onboard, offboard
src/trigger/poll-inbox.ts    # the per-client poll-inbox schedule task
scripts/cli.ts               # CLI: connect | onboard | offboard | reschedule
```

## Setup

1. Install deps: `npm install`
2. Copy env: `cp .env.example .env`, then fill it in. At minimum you need
   `COMPOSIO_API_KEY` and `TRIGGER_PROJECT_REF`; see `.env.example` for the rest
   and what each is for.
3. Run the task dev server (registers tasks + executes runs): `npm run dev`

> The Trigger.dev SDK and CLI are exact-pinned at the same version
> (see `package.json`) — a mismatch aborts `dev`. Always use the npm scripts,
> never `npx trigger.dev@latest`.

## Connecting a client (Gmail + Sheets)

A client needs two Composio connections under the same `userId` (a stable
identifier — their id in your system, or their email): **Gmail** (read their
inbox) and **Google Sheets** (write matched emails). With `npm run dev` running:

```bash
npm run connect -- gmail  <userId>   # → prints the Gmail consent URL; open + approve
npm run connect -- sheets <userId>   # → same, for Google Sheets write access
npm run onboard -- <userId>          # registers the poll schedule; re-run until onboarded
```

`onboard` refuses unless *both* connections are ACTIVE and reports which one is
still pending — it's idempotent (a stable `deduplicationKey`), so re-running it
updates the existing schedule in place. Optional: pass a cron
(`npm run onboard -- <userId> "*/5 * * * *"`) to override the every-2-hours
default; add `--prod` to any command to target production.

The same tasks can be run from the Trigger.dev dashboard's Test panel instead —
payload `{ "userId": "client-123" }`.

### Other operations

```bash
npm run offboard   -- <userId>            # stop polling a client
npm run reschedule -- [cron] [--dry-run]  # bulk-update every existing schedule's cron
```

`reschedule` exists because the cron lives server-side in each schedule:
editing `DEFAULT_POLL_CRON` in `src/trigger/clients.ts` only affects *newly*
onboarded clients until you reschedule (or re-onboard) the existing ones.

## What a poll writes

One row per matched email, appended below the sheet's existing data (add a
header row by hand once):

| date | from | subject | snippet | messageId | threadId | sentiment |

`sentiment` is `happy`, `neutral`, or `angry`, classified by Claude
(`claude-opus-4-8` by default; override via `ANTHROPIC_MODEL`). Any
classification failure degrades to `neutral` rather than blocking the row.

## Deploying

Set `TRIGGER_PROJECT_REF` and your `TRIGGER_SECRET_KEY_*` in `.env`, then
`npm run deploy`. Remember env vars (`WATCH_SENDER`, `TARGET_SHEET_ID`,
`COMPOSIO_API_KEY`, `ANTHROPIC_API_KEY`) are per-environment — set them in
the Trigger.dev dashboard for the deployed environment.

## API keys

All keys live in `.env` (gitignored). See `.env.example` for the full list and
where to obtain each one.
