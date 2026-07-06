---
name: refresh
description: Onboard (or re-onboard) a client to the Gmail poll agent — triggers the `onboard-client` Trigger.dev task, which (re)creates that user's poll-inbox schedule and picks up any changed cron. Use when the user types /refresh or asks to onboard/refresh a client or update their poll schedule.
---

# /refresh — onboard / refresh a client's poll schedule

Triggers the `onboard-client` task (defined in `src/trigger/clients.ts`). Because
that task calls `schedules.create` with a stable `deduplicationKey` of
`poll-inbox:<userId>`, running it is **idempotent**: a first run creates the
per-user `poll-inbox` schedule; a re-run **updates** the existing one in place —
which is how you apply a changed `DEFAULT_POLL_CRON` (or an explicit cron) to a
schedule that already exists in Trigger.dev's backend.

## Prerequisites (check, don't assume)

- The user's **Gmail and Google Sheets** connections must both be **ACTIVE** in
  Composio (Gmail to read, Sheets to write matches). If either isn't,
  `onboard-client` returns `{ onboarded: false }` with `gmailStatus`/`sheetsStatus`
  and no schedule is created — the script prints which one is pending and tells
  you to run `connect-client-gmail` and/or `connect-client-sheets` first.
- `.env` must contain `TRIGGER_SECRET_KEY_DEV` (and `TRIGGER_SECRET_KEY_PROD` for
  `--prod`). The script maps the right one into `TRIGGER_SECRET_KEY`.
- For DEV, the run only **executes** if a `trigger dev` worker is connected
  (`npm run dev`). If it isn't running, the run stays queued — start it, or the
  poll won't fire.

## Steps

1. **Get the `userId`.** Use the argument the user passed to `/refresh` (e.g.
   `/refresh kishora1997@gmail.com`). If none was given, ask which client to
   onboard — do **not** guess an address.

2. **Run the onboard script** from the project root
   (`common_business_automations/`):

   ```bash
   npm run onboard -- <userId>
   ```

   Optional:
   - explicit cron: `npm run onboard -- <userId> "*/1 * * * *"`
   - production env: `npm run onboard -- <userId> --prod`

3. **Report the result** to the user:
   - `onboarded: true` with a `scheduleId` and `cron` → success; tell them the
     schedule is live and at what cadence. In DEV it fires only while
     `npm run dev` runs.
   - `onboarded: false` → Gmail and/or Sheets isn't ACTIVE (check the
     `gmailStatus`/`sheetsStatus` in the output); tell them to run
     `connect-client-gmail` and/or `connect-client-sheets` for that userId
     (dashboard Test panel), approve the consent URL(s), then `/refresh` again
     (onboard-client re-checks status itself — no separate confirm step needed).
   - Run `FAILED`/error → surface the error message; common causes are a missing
     secret key or no `trigger dev` worker connected.

## Notes

- This does **not** deploy code. If the user changed task *code* (not just a
  schedule), a running `trigger dev` hot-reloads it; for prod they need
  `npm run deploy`.
- The cron lives server-side in the schedule, not in the source file — editing
  `DEFAULT_POLL_CRON` alone changes nothing until `onboard-client` runs again,
  which is exactly what this skill does.
