import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const moduleUrl = new URL("./stocks-prewarm.ts", import.meta.url);
const workerUrl = new URL("../../scripts/stocks-cache-worker.mjs", import.meta.url);
const startScriptUrl = new URL("../../scripts/start-signal-hub.ps1", import.meta.url);
const packageJsonUrl = new URL("../../package.json", import.meta.url);

const {
  getCachedStocksSnapshot,
  getStocksPrewarmIntervalMs,
  getStocksSnapshotHealth,
  getStocksSnapshotCachePath,
  isStocksCachePrewarmEnabled,
  prewarmStocksCaches,
  resolveStocksMarketProvider,
  writeStocksSnapshotCache,
} = await import(moduleUrl);

const runtimeDir = mkdtempSync(join(tmpdir(), "signal-hub-stocks-prewarm-"));
const env = {
  SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
  STOCKS_MARKET_CACHE_MS: String(60 * 60 * 1000),
};

try {
  assert.equal(isStocksCachePrewarmEnabled({ STOCKS_CACHE_PREWARM_ENABLED: "0" }), false);
  assert.equal(getStocksPrewarmIntervalMs("market", {}), 5 * 60 * 1000);
  assert.equal(getStocksPrewarmIntervalMs("catalysts", {}), 15 * 60 * 1000);
  assert.equal(getStocksPrewarmIntervalMs("financial", {}), 60 * 60 * 1000);
  assert.equal(
    resolveStocksMarketProvider({ STOCKS_MARKET_DATA_PROVIDER: "eodhd" }),
    "eodhd",
  );

  const cachedMarket = {
    generatedAt: "2026-05-14T01:00:00.000Z",
    source: "live",
    provider: "finnhub",
    quotes: {},
    errors: [],
  };
  const freshMarket = {
    generatedAt: "2026-05-14T01:05:00.000Z",
    source: "live",
    provider: "finnhub",
    quotes: {},
    errors: [],
  };

  await writeStocksSnapshotCache({ kind: "market", env, snapshot: cachedMarket });
  let loaderCalls = 0;
  const cacheFirst = await getCachedStocksSnapshot({
    kind: "market",
    env,
    now: Date.parse("2026-05-14T01:30:00.000Z"),
    loader: async () => {
      loaderCalls += 1;
      return freshMarket;
    },
  });

  assert.equal(cacheFirst.generatedAt, cachedMarket.generatedAt);
  assert.equal(loaderCalls, 0);

  const staleRefreshed = await getCachedStocksSnapshot({
    kind: "market",
    env,
    now: Date.parse("2026-05-14T03:00:00.000Z"),
    loader: async () => {
      loaderCalls += 1;
      return freshMarket;
    },
  });
  assert.equal(staleRefreshed.generatedAt, freshMarket.generatedAt);
  assert.equal(loaderCalls, 1);

  const staleHealth = getStocksSnapshotHealth(
    "market",
    cachedMarket,
    env,
    Date.parse("2026-05-14T03:00:00.000Z"),
  );
  assert.equal(staleHealth.stale, true);
  assert.equal(staleHealth.ageMs, 2 * 60 * 60 * 1000);

  const forced = await getCachedStocksSnapshot({
    kind: "market",
    env,
    force: true,
    loader: async () => {
      loaderCalls += 1;
      return freshMarket;
    },
  });

  assert.equal(forced.generatedAt, freshMarket.generatedAt);
  assert.equal(loaderCalls, 2);
  assert.equal(
    JSON.parse(readFileSync(getStocksSnapshotCachePath("market", env), "utf8"))
      .generatedAt,
    freshMarket.generatedAt,
  );

  const fallback = await getCachedStocksSnapshot({
    kind: "market",
    env,
    force: true,
    loader: async () => ({
      generatedAt: "2026-05-14T01:10:00.000Z",
      source: "mock",
      provider: "mock",
      quotes: {},
      errors: ["live provider failed"],
    }),
  });
  assert.equal(fallback.generatedAt, freshMarket.generatedAt);

  await writeStocksSnapshotCache({ kind: "market", env, snapshot: cachedMarket });
  const staleFailureFallback = await getCachedStocksSnapshot({
    kind: "market",
    env,
    now: Date.parse("2026-05-14T03:00:00.000Z"),
    loader: async () => {
      throw new Error("provider unavailable");
    },
  });
  assert.equal(staleFailureFallback.generatedAt, cachedMarket.generatedAt);
  assert.ok(
    staleFailureFallback.errors.some((error) =>
      error.includes("provider unavailable"),
    ),
  );

  const financial = {
    generatedAt: "2026-05-14T01:06:00.000Z",
    source: "live",
    provider: "yahoo",
    financials: {},
    errors: [],
  };
  const catalysts = {
    generatedAt: "2026-05-14T01:07:00.000Z",
    source: "live",
    provider: "subscription-research",
    catalysts: {},
    errors: [],
  };
  const results = await prewarmStocksCaches({
    env,
    stocks: [],
    loaders: {
      market: async () => freshMarket,
      financial: async () => financial,
      catalysts: async () => catalysts,
    },
  });

  assert.deepEqual(
    results.map((result) => `${result.kind}:${result.success}:${result.provider}`),
    [
      "market:true:finnhub",
      "financial:true:yahoo",
      "catalysts:true:subscription-research",
    ],
  );
  assert.equal(existsSync(getStocksSnapshotCachePath("financial", env)), true);
  assert.equal(existsSync(getStocksSnapshotCachePath("catalysts", env)), true);

  const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
  assert.equal(typeof packageJson.scripts["stocks:prewarm"], "string");
  assert.equal(typeof packageJson.scripts["stocks:prewarm:once"], "string");

  const startScript = readFileSync(startScriptUrl, "utf8");
  assert.match(startScript, /signal-hub-stocks-cache/);
  assert.match(startScript, /scripts\\stocks-cache-worker\.mjs/);

  const worker = readFileSync(workerUrl, "utf8");
  assert.match(worker, /prewarmStocksCaches/);
  assert.match(worker, /--once/);
  assert.match(worker, /backfillStocksHistory/);
  assert.match(worker, /STOCKS_HISTORY_BACKFILL_ENABLED/);
  assert.match(worker, /STOCKS_HISTORY_BACKFILL_INTERVAL_MS/);
  assert.match(worker, /stocks_history\.backfill\.done/);
  assert.match(worker, /void runHistoryBackfill\("interval"\)/);
  assert.match(
    worker,
    /if \(once\) \{\s+await runHistoryBackfill\("startup"\);\s+\} else \{\s+void runHistoryBackfill\("startup"\);\s+\}/s,
  );
} finally {
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log("ok - stocks cache prewarm contract");
