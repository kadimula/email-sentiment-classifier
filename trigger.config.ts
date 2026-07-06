import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Your project ref from the trigger.dev dashboard. Set TRIGGER_PROJECT_REF in
  // .env (see .env.example) so this repo ships without a hardcoded project.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_your_project_ref",
  dirs: ["./src/trigger"],
  maxDuration: 60, // max seconds a run can execute before timing out
});
