import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
} from "../src/lib/alpha-research-pool.ts";
import {
  getStocksPrewarmIntervalMs,
  isStocksCachePrewarmEnabled,
  prewarmStocksCaches,
} from "../src/lib/stocks-prewarm.ts";
import { backfillStocksHistory } from "../src/lib/stocks-history-backfill.ts";

const KINDS = ["market", "financial", "catalysts"];
let running = false;
let historyRunning = false;
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

async function runHistoryBackfill(reason) {
  if (historyRunning) {
    log("stocks_history.backfill.skip", {
      reason,
      cause: "already_running",
    });
    return;
  }
  if (!historyEnabled) {
    log("stocks_history.backfill.skip", { reason, cause: "disabled" });
    return;
  }

  historyRunning = true;
  const startedAt = Date.now();
  try {
    log("stocks_history.backfill.start", { reason });
    const rawResults = await backfillStocksHistory({
      tickers: ALPHA_RESEARCH_STOCK_UNIVERSE,
      startDate: ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
      env: process.env,
    });
    const results = rawResults.map((item) => ({
      ...item,
      status: item.status === "failed" ? "error" : item.status,
    }));
    const summary = {
      success: results.filter((item) => item.status === "success").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "error").length,
      recorded: results.reduce((sum, item) => sum + item.recorded, 0),
    };
    log("stocks_history.backfill.done", {
      reason,
      durationMs: Date.now() - startedAt,
      ...summary,
    });
  } catch (error) {
    log("stocks_history.backfill.error", {
      reason,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    historyRunning = false;
  }
}

function getIntervals() {
  return Object.fromEntries(
    KINDS.map((kind) => [kind, getStocksPrewarmIntervalMs(kind, process.env)]),
  );
}

function nextDelayMs(nextDue, nextHistoryDue) {
  const now = Date.now();
  const dueTimes = Object.values(nextDue);
  if (nextHistoryDue !== null) dueTimes.push(nextHistoryDue);
  const nextAt = Math.min(...dueTimes);
  return Math.max(1000, Math.min(nextAt - now, 30_000));
}

await loadEnv();
installShutdownHandlers();

const historyEnabled =
  process.env.STOCKS_HISTORY_BACKFILL_ENABLED?.trim().toLowerCase() !== "false";
const historyIntervalMs = Math.max(
  60 * 60 * 1000,
  Number(process.env.STOCKS_HISTORY_BACKFILL_INTERVAL_MS) || 24 * 60 * 60 * 1000,
);

const once = process.argv.includes("--once");
await runPrewarm("startup", KINDS);
await runHistoryBackfill("startup");

if (once) process.exit(0);

const intervals = getIntervals();
const nextDue = Object.fromEntries(
  KINDS.map((kind) => [kind, Date.now() + intervals[kind]]),
);
let nextHistoryDue = historyEnabled ? Date.now() + historyIntervalMs : null;
log("stocks_cache.worker.ready", { intervals });

while (!stopRequested) {
  await new Promise((resolveSleep) =>
    setTimeout(resolveSleep, nextDelayMs(nextDue, nextHistoryDue)),
  );
  const now = Date.now();
  const dueKinds = KINDS.filter((kind) => nextDue[kind] <= now);
  const historyDue = nextHistoryDue !== null && nextHistoryDue <= now;
  if (stopRequested) continue;
  if (dueKinds.length > 0) {
    await runPrewarm("interval", dueKinds);
    for (const kind of dueKinds) {
      nextDue[kind] = Date.now() + intervals[kind];
    }
  }
  if (historyDue) {
    nextHistoryDue = Date.now() + historyIntervalMs;
    void runHistoryBackfill("interval");
  }
}
