import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
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
  preserveSuccessfulFinancialEntries,
  prewarmStocksCaches,
  resolveStocksMarketProvider,
  writeStocksSnapshotCache,
} = await import(moduleUrl);
const prewarmSource = readFileSync(moduleUrl, "utf8");
assert.match(prewarmSource, /enrichStocksFinancialSnapshotWithInsights/);

const priorComparison = {
  ticker: "NBIS",
  fiscalYear: 2026,
  quarter: "Q2",
  fiscalDateEnding: "2026-06-30",
  reportDate: "2026-08-12",
  reportTiming: "before-market",
  currency: "USD",
  accountingBasis: "FMP standardized",
  provider: "fmp",
  generatedAt: "2026-08-14T00:00:00.000Z",
  revenue: {
    estimate: 573_937_500,
    estimateSource: {
      provider: "fmp",
      method: "direct",
      accountingBasis: "FMP standardized",
    },
    actual: 582_300_000,
    actualSource: {
      provider: "fmp",
      method: "direct",
      accountingBasis: "FMP standardized",
    },
    previousYearActual: 105_100_000,
    estimateYoYPct: 446.087,
    actualYoYPct: 454.044,
    surprise: 8_362_500,
    surprisePct: 1.457,
  },
  netIncome: {
    estimate: -273_800_000,
    actual: -190_400_000,
    previousYearActual: -143_600_000,
    estimateYoYPct: -90.669,
    actualYoYPct: -32.591,
    surprise: 83_400_000,
    surprisePct: 30.46,
  },
};
const previousFinancial = {
  generatedAt: "2026-08-14T00:00:00.000Z",
  source: "live",
  provider: "fmp",
  errors: [],
  financials: {
    NBIS: {
      ticker: "NBIS",
      source: "live",
      updatedAt: "2026-08-14T00:00:00.000Z",
      revenue: "$582.30M",
      revenueYoY: "454.0%",
      eps: "n/a",
      grossMargin: "n/a",
      freeCashFlow: "n/a",
      nextEarningsDate: "2026-08-12",
      guidance: "No forward estimate",
      periodLabel: "Q2 2026",
      latestEarnings: priorComparison,
      earningsHistory: [priorComparison],
      earningsInsight: {
        conclusion: "cached conclusion",
        driver: "cached driver",
        risk: "cached risk",
        source: "ai",
        model: "MiniMax-M2.7",
        generatedAt: "2026-08-14T00:00:00.000Z",
      },
    },
    CBRS: {
      ticker: "CBRS",
      source: "live",
      updatedAt: "2026-08-14T00:00:00.000Z",
      revenue: "$209.90M",
      revenueYoY: "n/a",
      eps: "n/a",
      grossMargin: "n/a",
      freeCashFlow: "n/a",
      nextEarningsDate: "2026-08-12",
      guidance: "No forward estimate",
      periodLabel: "Q2 2026",
    },
  },
};
const partialFinancial = {
  generatedAt: "2026-08-14T01:00:00.000Z",
  source: "live",
  provider: "fmp",
  errors: ["NBIS: FMP analyst-estimates HTTP 402"],
  financials: {
    NBIS: {
      ...previousFinancial.financials.NBIS,
      updatedAt: "2026-08-14T01:00:00.000Z",
      latestEarnings: {
        ...priorComparison,
        generatedAt: "2026-08-14T01:00:00.000Z",
        revenue: {
          ...priorComparison.revenue,
          estimate: 560_000_000,
          estimateSource: {
            provider: "finnhub",
            method: "eps-times-diluted-shares",
            accountingBasis: "Derived from EPS times diluted shares",
          },
          estimateYoYPct: null,
          surprise: null,
          surprisePct: null,
        },
      },
      earningsInsight: {
        conclusion: "temporary rules fallback",
        driver: "missing estimates",
        risk: "missing estimates",
        source: "rules",
        model: null,
        generatedAt: "2026-08-14T01:00:00.000Z",
      },
    },
  },
};
const legacyPreviousFinancial = structuredClone(previousFinancial);
delete legacyPreviousFinancial.financials.NBIS.latestEarnings.revenue
  .estimateSource.accountingBasis;
delete legacyPreviousFinancial.financials.NBIS.earningsHistory[0].revenue
  .estimateSource.accountingBasis;
const preservedFinancial = preserveSuccessfulFinancialEntries(
  previousFinancial,
  partialFinancial,
);
assert.ok(preservedFinancial.financials.CBRS);
assert.equal(
  preservedFinancial.financials.NBIS.latestEarnings.revenue.estimate,
  573_937_500,
);
assert.deepEqual(
  preservedFinancial.financials.NBIS.latestEarnings.revenue.estimateSource,
  {
    provider: "fmp",
    method: "direct",
    accountingBasis: "FMP standardized",
  },
);
assert.equal(
  preservedFinancial.financials.NBIS.earningsInsight.conclusion,
  "cached conclusion",
);

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

  await writeStocksSnapshotCache({
    kind: "financial",
    env,
    snapshot: legacyPreviousFinancial,
  });
  const migratedFinancial = await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: true,
    loader: async () => partialFinancial,
  });
  assert.equal(
    migratedFinancial.financials.NBIS.latestEarnings.revenue.estimate,
    573_937_500,
  );
  assert.equal(
    migratedFinancial.financials.NBIS.latestEarnings.revenue.estimateSource
      .accountingBasis,
    "FMP standardized",
  );
  assert.equal(
    JSON.parse(readFileSync(getStocksSnapshotCachePath("financial", env), "utf8"))
      .financials.NBIS.latestEarnings.revenue.estimateSource.accountingBasis,
    "FMP standardized",
  );

  const legacyUnknownFinancial = structuredClone(legacyPreviousFinancial);
  legacyUnknownFinancial.financials.NBIS.latestEarnings.revenue.estimateSource.provider =
    "finnhub";
  await writeStocksSnapshotCache({
    kind: "financial",
    env,
    snapshot: legacyUnknownFinancial,
  });
  const migratedUnknownFinancial = await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: true,
    loader: async () => partialFinancial,
  });
  assert.equal(
    migratedUnknownFinancial.financials.NBIS.latestEarnings.revenue
      .estimateSource.accountingBasis,
    "Legacy/unknown accounting basis",
  );

  const nextMissingFinancial = structuredClone(partialFinancial);
  nextMissingFinancial.financials.NBIS.latestEarnings = null;
  await writeStocksSnapshotCache({
    kind: "financial",
    env,
    snapshot: legacyPreviousFinancial,
  });
  const migratedNextMissing = await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: true,
    loader: async () => nextMissingFinancial,
  });
  assert.equal(
    migratedNextMissing.financials.NBIS.latestEarnings.revenue.estimateSource
      .accountingBasis,
    "FMP standardized",
  );
  assert.equal(
    JSON.parse(readFileSync(getStocksSnapshotCachePath("financial", env), "utf8"))
      .financials.NBIS.latestEarnings.revenue.estimateSource.accountingBasis,
    "FMP standardized",
  );

  const historyMissingFinancial = structuredClone(partialFinancial);
  historyMissingFinancial.financials.NBIS.latestEarnings = structuredClone(
    previousFinancial.financials.NBIS.latestEarnings,
  );
  historyMissingFinancial.financials.NBIS.earningsHistory = [];
  await writeStocksSnapshotCache({
    kind: "financial",
    env,
    snapshot: legacyPreviousFinancial,
  });
  const migratedHistoryMissing = await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: true,
    loader: async () => historyMissingFinancial,
  });
  assert.equal(
    migratedHistoryMissing.financials.NBIS.earningsHistory[0].revenue
      .estimateSource.accountingBasis,
    "FMP standardized",
  );
  assert.equal(
    JSON.parse(readFileSync(getStocksSnapshotCachePath("financial", env), "utf8"))
      .financials.NBIS.earningsHistory[0].revenue.estimateSource.accountingBasis,
    "FMP standardized",
  );

  const mismatchedFinancial = structuredClone(partialFinancial);
  mismatchedFinancial.financials.NBIS.latestEarnings = structuredClone(
    legacyPreviousFinancial.financials.NBIS.latestEarnings,
  );
  mismatchedFinancial.financials.NBIS.latestEarnings.fiscalYear = 2027;
  const migratedMismatched = preserveSuccessfulFinancialEntries(
    legacyPreviousFinancial,
    mismatchedFinancial,
  );
  assert.equal(
    migratedMismatched.financials.NBIS.latestEarnings.revenue.estimateSource
      .accountingBasis,
    "FMP standardized",
  );

  const freshLegacyFinancial = structuredClone(legacyPreviousFinancial);
  freshLegacyFinancial.generatedAt = new Date().toISOString();
  await writeStocksSnapshotCache({
    kind: "financial",
    env,
    snapshot: freshLegacyFinancial,
  });
  const freshRevenueBefore = structuredClone(
    freshLegacyFinancial.financials.NBIS.latestEarnings.revenue,
  );
  delete freshRevenueBefore.estimateSource;
  delete freshRevenueBefore.actualSource;
  let freshLoaderCalls = 0;
  const freshHit = await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: false,
    loader: async () => {
      freshLoaderCalls += 1;
      return partialFinancial;
    },
  });
  assert.equal(freshLoaderCalls, 0);
  assert.equal(
    freshHit.financials.NBIS.latestEarnings.revenue.estimate,
    573_937_500,
  );
  assert.equal(
    freshHit.financials.NBIS.latestEarnings.revenue.estimateSource.method,
    "direct",
  );
  assert.equal(
    freshHit.financials.NBIS.latestEarnings.revenue.estimateSource
      .accountingBasis,
    "FMP standardized",
  );
  const freshRevenueAfter = structuredClone(
    freshHit.financials.NBIS.latestEarnings.revenue,
  );
  delete freshRevenueAfter.estimateSource;
  delete freshRevenueAfter.actualSource;
  assert.deepEqual(freshRevenueAfter, freshRevenueBefore);
  const freshCachePath = getStocksSnapshotCachePath("financial", env);
  assert.equal(
    JSON.parse(readFileSync(freshCachePath, "utf8"))
      .financials.NBIS.latestEarnings.revenue.estimateSource.accountingBasis,
    "FMP standardized",
  );
  const migratedMtimeMs = statSync(freshCachePath).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 25));
  await getCachedStocksSnapshot({
    kind: "financial",
    env,
    force: false,
    loader: async () => {
      freshLoaderCalls += 1;
      return partialFinancial;
    },
  });
  assert.equal(statSync(freshCachePath).mtimeMs, migratedMtimeMs);

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
