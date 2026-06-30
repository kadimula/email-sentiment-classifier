# test_trigger

Minimal [Trigger.dev](https://trigger.dev) v4 project — a single "hello world" background task.

## Layout

```
trigger.config.ts        # project ref + config (maxDuration required in v4)
src/trigger/hello-world.ts  # the task: id "hello-world", payload { name?: string }
```

- Project ref: `proj_uphevngxyzoefqcwqzzb`
- SDK/CLI: `@trigger.dev/sdk` + `trigger.dev` v4 (import from `@trigger.dev/sdk`, NOT `/v3`)

## Commands

```bash
npm install
npx trigger.dev@latest dev      # local dev server, hot-reloads src/trigger/
npx trigger.dev@latest deploy   # ship to prod (remote build, new immutable version)
npx tsc --noEmit                # typecheck
```

## Triggering

```ts
import { tasks } from "@trigger.dev/sdk";
await tasks.trigger("hello-world", { name: "Kishore" });
// needs TRIGGER_SECRET_KEY (tr_dev_… locally, tr_prod_… in prod)
```

Or use the dashboard Test tab.

## Notes

- Env vars for prod must be set in the dashboard (Environment Variables → Production); local `.env` is dev-only and not uploaded.
- Each `deploy` creates a new version; in-flight runs finish on their original version.
