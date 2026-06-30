import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Replace with your project ref from the trigger.dev dashboard
  project: "proj_uphevngxyzoefqcwqzzb",
  dirs: ["./src/trigger"],
  maxDuration: 60, // max seconds a run can execute before timing out
});
