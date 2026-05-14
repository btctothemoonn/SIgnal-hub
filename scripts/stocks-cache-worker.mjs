import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getStocksPrewarmIntervalMs,
  isStocksCachePrewarmEnabled,
  prewarmStocksCaches,
} from "../src/lib/stocks-prewarm.ts";

const KINDS = ["market", "financial", "catalysts"];
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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function loadEnv() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopRequested = true;
      log("stocks_cache.worker.stop", { signal });
      setTimeout(() => process.exit(0), 200).unref();
    });
  }
}

async function runPrewarm(reason, kinds) {
  if (running) {
    log("stocks_cache.prewarm.skip", { reason, kinds, cause: "already_running" });
    return;
  }
  if (!isStocksCachePrewarmEnabled(process.env)) {
    log("stocks_cache.prewarm.disabled", { reason, kinds });
    return;
  }

  running = true;
  const startedAt = Date.now();
  try {
    log("stocks_cache.prewarm.start", { reason, kinds });
    const results = await prewarmStocksCaches({ env: process.env, kinds });
    log("stocks_cache.prewarm.done", {
      reason,
      kinds,
      durationMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    log("stocks_cache.prewarm.error", {
      reason,
      kinds,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

function getIntervals() {
  return Object.fromEntries(
    KINDS.map((kind) => [kind, getStocksPrewarmIntervalMs(kind, process.env)]),
  );
}

function nextDelayMs(nextDue) {
  const now = Date.now();
  const nextAt = Math.min(...Object.values(nextDue));
  return Math.max(1000, Math.min(nextAt - now, 30_000));
}

await loadEnv();
installShutdownHandlers();

const once = process.argv.includes("--once");
await runPrewarm("startup", KINDS);

if (once) process.exit(0);

const intervals = getIntervals();
const nextDue = Object.fromEntries(
  KINDS.map((kind) => [kind, Date.now() + intervals[kind]]),
);
log("stocks_cache.worker.ready", { intervals });

while (!stopRequested) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, nextDelayMs(nextDue)));
  const now = Date.now();
  const dueKinds = KINDS.filter((kind) => nextDue[kind] <= now);
  if (dueKinds.length === 0 || stopRequested) continue;
  await runPrewarm("interval", dueKinds);
  for (const kind of dueKinds) {
    nextDue[kind] = Date.now() + intervals[kind];
  }
}
