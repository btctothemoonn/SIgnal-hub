import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getAlphaSummaryPrewarmAudiences,
  getAlphaSummaryPrewarmIntervalMs,
  getAlphaSummaryPrewarmScopes,
  isAlphaSummaryPrewarmEnabled,
  prewarmAlphaSummaryCaches,
} from "../src/lib/alpha-summary-prewarm.ts";

let running = false;
let stopRequested = false;

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

async function loadEnv() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));
}

async function runPrewarm(reason) {
  if (running) {
    log("alpha_summary.prewarm.skip", { reason, cause: "already_running" });
    return;
  }

  if (!isAlphaSummaryPrewarmEnabled(process.env)) {
    log("alpha_summary.prewarm.disabled", { reason });
    return;
  }

  running = true;
  const startedAt = Date.now();
  const scopes = getAlphaSummaryPrewarmScopes(process.env);
  const audiences = getAlphaSummaryPrewarmAudiences(process.env);
  try {
    log("alpha_summary.prewarm.start", { reason, scopes, audiences });
    const results = await prewarmAlphaSummaryCaches({
      env: process.env,
      now: new Date(),
      scopes,
      audiences,
    });
    log("alpha_summary.prewarm.done", {
      reason,
      durationMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    log("alpha_summary.prewarm.error", {
      reason,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopRequested = true;
      log("alpha_summary.worker.stop", { signal });
      setTimeout(() => process.exit(0), 200).unref();
    });
  }
}

await loadEnv();
installShutdownHandlers();

const once = process.argv.includes("--once");
await runPrewarm("startup");

if (once) {
  process.exit(0);
}

const intervalMs = getAlphaSummaryPrewarmIntervalMs(process.env);
log("alpha_summary.worker.ready", {
  intervalMs,
  scopes: getAlphaSummaryPrewarmScopes(process.env),
  audiences: getAlphaSummaryPrewarmAudiences(process.env),
});

while (!stopRequested) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  if (!stopRequested) {
    await runPrewarm("interval");
  }
}
