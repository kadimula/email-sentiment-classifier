import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tasks, auth } from "@trigger.dev/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// One secret key per trigger.dev environment. The key prefix (tr_dev_ / tr_prod_)
// determines which environment the run lands in.
const KEYS = {
  dev: process.env.TRIGGER_SECRET_KEY_DEV,
  prod: process.env.TRIGGER_SECRET_KEY_PROD,
};

for (const [env, key] of Object.entries(KEYS)) {
  if (!key) {
    console.warn(
      `⚠️  TRIGGER_SECRET_KEY_${env.toUpperCase()} is not set — ${env} runs will fail.`
    );
  }
}

const server = createServer(async (req, res) => {
  // Serve the page
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(join(__dirname, "public", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Trigger the task
  if (req.method === "POST" && req.url === "/trigger") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { name, env = "prod" } = body ? JSON.parse(body) : {};
        const secretKey = KEYS[env];
        if (!secretKey) throw new Error(`No secret key configured for "${env}"`);
        // "hello-world" matches the task id in src/trigger/hello-world.ts.
        // withAuth picks the dev/prod key for this single request.
        const handle = await auth.withAuth({ secretKey }, () =>
          tasks.trigger("hello-world", { name })
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...handle, env }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`▶  Open http://localhost:${PORT}`);
});
