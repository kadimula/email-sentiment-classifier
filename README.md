# Multi-tenant Gmail agent (Trigger.dev + Composio)

A [Trigger.dev](https://trigger.dev) scaffold for an email agent that watches
your clients' Gmail inboxes. Each client links their own Gmail once; a scheduled
task then fans out over every connected client and reads their recent mail. The
agent step (check sender → parse → write to a Google Sheet) slots in where the
poll task currently logs the inbox.

**Gmail is handled entirely through [Composio](https://composio.dev).** Composio
hosts the Google OAuth consent screen, stores and auto-refreshes each client's
tokens, and exposes Gmail as callable tools. This app never sees a refresh token
or a Google client secret — it only ever holds a Composio `userId` per client.
There is no `googleapis` / direct-Google dependency.

## Layout

```
trigger.config.ts            # project ref (from env) + Trigger.dev config
src/lib/composio.ts          # all Gmail + Sheets auth + tooling, via Composio
src/lib/clients.ts           # roster of connected clients (Upstash or in-memory)
src/trigger/gmail-connect.ts # onboarding tasks: connect Gmail + Sheets, onboard/offboard
src/trigger/gmail-agent.ts   # cron scheduler + per-client inbox worker
src/trigger/hello-world.ts   # demo task
src/trigger/send-email.ts    # demo task (Resend)
```

There is no web server. Onboarding and polling both run entirely as Trigger.dev
tasks; Composio hosts the OAuth consent page and callback.

## Setup

1. Install deps: `npm install`
2. Copy env: `cp .env.example .env`, then fill it in. At minimum you need
   `COMPOSIO_API_KEY` and `TRIGGER_PROJECT_REF`; see `.env.example` for the rest
   and what each is for.
3. Run the task dev server (registers tasks + runs the cron):
   `npx trigger.dev@latest dev`

## Connecting a client (Gmail + Sheets)

Onboarding is a Trigger.dev task — no web server. A client needs two Composio
connections under the same `userId`: **Gmail** (to read their inbox) and
**Google Sheets** (to write matched emails). From the Trigger.dev dashboard
(or via the SDK), run each connect task with a stable identifier for the client
as `userId` (their id in your system, or their email):

```json
{ "userId": "client-123" }
```

1. **`connect-client-gmail`** → the run's Output panel returns a Composio-hosted
   `redirectUrl`; open it and approve Gmail on Google's own consent screen.
2. **`connect-client-sheets`** → same, for Google Sheets write access.
3. **`onboard-client`** registers the poll schedule. It refuses unless *both*
   connections are ACTIVE, returning `{ onboarded: false, gmailStatus,
   sheetsStatus }` so you can see what's still pending — it's idempotent, so just
   re-run it after approving. Once onboarded, the cron scheduler polls that inbox
   and appends matches to the sheet in `TARGET_SHEET_ID`.

Or drive it from the CLI (needs `TRIGGER_SECRET_KEY_DEV` in `.env` and a running
`npm run dev` worker). These print the consent URL / onboard result directly:

```bash
npm run connect -- gmail  <userId>   # → prints Gmail consent URL
npm run connect -- sheets <userId>   # → prints Google Sheets consent URL
npm run onboard -- <userId>          # after approving both; re-run until onboarded
```

The scheduler runs every minute by default — adjust the cron in
`src/trigger/gmail-agent.ts` or from the dashboard.

## Deploying

Set `TRIGGER_PROJECT_REF` and your `TRIGGER_SECRET_KEY_*` in `.env`, then:
`npx trigger.dev@latest deploy`

## API keys

All keys live in `.env` (gitignored). See `.env.example` for the full list and
where to obtain each one.
