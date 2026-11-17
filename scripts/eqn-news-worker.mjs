import { runEqnNewsWorker } from "../src/lib/eqn-news-worker.ts";

// systemd provides an eqn-only environment. Do not load application or trader secret files.
const controller = new AbortController();
const shutdown = () => controller.abort();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  const result = await runEqnNewsWorker({ once: process.argv.includes("--once"), doctor: process.argv.includes("--doctor"), signal: controller.signal });
  console.log(JSON.stringify({ worker: "eqn-news", ...result }));
  if (process.argv.includes("--doctor") && result.enabled && (!result.connected || result.error)) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ worker: "eqn-news", error: "Worker failed; check runtime storage and public upstream availability" }));
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", shutdown);
  process.removeListener("SIGTERM", shutdown);
}
