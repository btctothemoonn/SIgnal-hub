import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getStocksHistoryCoverage,
  getStocksPerformanceSnapshot,
  marketDateInNewYork,
  recordStocksHistoricalDailyPoints,
  recordStocksPerformanceSnapshot,
  updateStocksHistoryBackfillStatus,
} from "./stocks-performance-data.ts";

const dbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-performance-test-${process.pid}.sqlite`,
);
const historyDbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-history-test-${process.pid}.sqlite`,
);
rmSync(dbPath, { force: true });
rmSync(historyDbPath, { force: true });

function quote(ticker, lastPrice, generatedAt) {
  return {
    ticker,
    lastPrice,
    dayChangePct: 1,
    prePostChangePct: 0,
    prePostAvailable: false,
    sevenDayChangePct: 0,
    relativeStrengthLabel: "观察",
    marketSession: "regular",
    candles3d: [],
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    dataQualityLabel: "Finnhub / 实时",
    trace: [],
    updatedAt: generatedAt,
  };
}

const firstAt = "2026-05-11T14:30:00.000Z";
const secondAt = "2026-05-11T15:30:00.000Z";
const thirdAt = "2026-05-12T14:30:00.000Z";
assert.equal(marketDateInNewYork(firstAt), "2026-05-11");

recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: firstAt,
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 100, firstAt),
      AMD: quote("AMD", 50, firstAt),
    },
  },
});

recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: secondAt,
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 110, secondAt),
      AMD: quote("AMD", 45, secondAt),
    },
  },
});

recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: thirdAt,
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 120, thirdAt),
      AMD: quote("AMD", 55, thirdAt),
    },
  },
});

const performance = getStocksPerformanceSnapshot({
  dbPath,
  tickers: ["NVDA", "AMD", "INTC"],
  marketDate: "2026-05-11",
});

assert.equal(performance.source, "local-cache");
assert.equal(performance.marketDate, "2026-05-11");
assert.equal(performance.series.length, 2);
assert.deepEqual(performance.missingTickers, ["INTC"]);

const nvda = performance.series.find((series) => series.ticker === "NVDA");
const amd = performance.series.find((series) => series.ticker === "AMD");
assert.equal(nvda?.latestChangePct, 10);
assert.deepEqual(
  nvda?.points.map((point) => point.changePct),
  [0, 10],
);
assert.equal(amd?.latestChangePct, -10);
assert.equal(nvda?.confidence, "high");
assert.equal(nvda?.provider, "finnhub");

const stalePerformance = getStocksPerformanceSnapshot({
  dbPath,
  tickers: ["NVDA", "AMD", "INTC"],
  marketDate: "2026-05-13",
});

assert.equal(stalePerformance.source, "local-cache");
assert.equal(stalePerformance.marketDate, "2026-05-12");
assert.equal(stalePerformance.series.length, 2);
assert.ok(
  stalePerformance.errors.some((error) =>
    error.includes("using latest cached market date 2026-05-12"),
  ),
);

const multiDayPerformance = getStocksPerformanceSnapshot({
  dbPath,
  tickers: ["NVDA", "AMD"],
  marketDate: "2026-05-12",
  lookbackDays: 7,
});

assert.equal(multiDayPerformance.source, "local-cache");
assert.equal(multiDayPerformance.marketDate, "2026-05-11 → 2026-05-12");
assert.deepEqual(multiDayPerformance.marketDates, ["2026-05-11", "2026-05-12"]);
assert.equal(multiDayPerformance.series.length, 2);
const multiDayNvda = multiDayPerformance.series.find(
  (series) => series.ticker === "NVDA",
);
assert.deepEqual(
  multiDayNvda?.points.map((point) => point.marketDate),
  ["2026-05-11", "2026-05-11", "2026-05-12"],
);
assert.equal(multiDayNvda?.latestChangePct, 20);

recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: "2026-05-06T14:30:00.000Z",
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 90, "2026-05-06T14:30:00.000Z"),
      AMD: quote("AMD", 40, "2026-05-06T14:30:00.000Z"),
    },
  },
});
recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: "2026-05-07T14:30:00.000Z",
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 95, "2026-05-07T14:30:00.000Z"),
      AMD: quote("AMD", 42, "2026-05-07T14:30:00.000Z"),
    },
  },
});
recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: "2026-05-08T14:30:00.000Z",
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 98, "2026-05-08T14:30:00.000Z"),
      AMD: quote("AMD", 44, "2026-05-08T14:30:00.000Z"),
    },
  },
});
recordStocksPerformanceSnapshot({
  dbPath,
  snapshot: {
    generatedAt: "2026-05-09T14:30:00.000Z",
    source: "live",
    provider: "finnhub",
    freshness: "realtime",
    fallbackUsed: false,
    trace: [],
    errors: [],
    quotes: {
      NVDA: quote("NVDA", 105, "2026-05-09T14:30:00.000Z"),
      AMD: quote("AMD", 43, "2026-05-09T14:30:00.000Z"),
    },
  },
});

const fullWindowPerformance = getStocksPerformanceSnapshot({
  dbPath,
  tickers: ["NVDA", "AMD"],
  marketDate: "2026-05-12",
  startDate: "2026-05-06",
});

assert.equal(fullWindowPerformance.marketDate, "2026-05-06 → 2026-05-12");
assert.deepEqual(fullWindowPerformance.marketDates, [
  "2026-05-06",
  "2026-05-07",
  "2026-05-08",
  "2026-05-09",
  "2026-05-11",
  "2026-05-12",
]);
assert.equal(
  fullWindowPerformance.series.find((series) => series.ticker === "NVDA")?.points[0]
    ?.marketDate,
  "2026-05-06",
);
assert.equal(
  fullWindowPerformance.series.find((series) => series.ticker === "AMD")?.points[0]
    ?.marketDate,
  "2026-05-06",
);

const downsampledPerformance = getStocksPerformanceSnapshot({
  dbPath,
  tickers: ["NVDA"],
  marketDate: "2026-05-12",
  lookbackDays: 7,
  maxPoints: 2,
});
const downsampledNvda = downsampledPerformance.series.find(
  (series) => series.ticker === "NVDA",
);
assert.deepEqual(
  downsampledNvda?.points.map((point) => point.capturedAt),
  ["2026-05-06T14:30:00.000Z", thirdAt],
);
assert.equal(downsampledNvda?.latestChangePct, 33.33);

assert.deepEqual(
  recordStocksHistoricalDailyPoints({
    dbPath: historyDbPath,
    points: [
      {
        ticker: "NVDA",
        marketDate: "2026-05-06",
        capturedAt: "2026-05-06T20:00:00.000Z",
        price: 91.2,
        provider: "yahoo",
      },
      {
        ticker: "NVDA",
        marketDate: "2026-05-07",
        capturedAt: "2026-05-07T20:00:00.000Z",
        price: 93.4,
        provider: "yahoo",
      },
    ],
  }),
  { recorded: 2 },
);

assert.deepEqual(
  recordStocksHistoricalDailyPoints({
    dbPath: historyDbPath,
    points: [
      {
        ticker: "nvda",
        marketDate: "2026-05-06",
        capturedAt: "2026-05-06T20:00:00.000Z",
        price: 92,
        provider: "eodhd",
      },
      {
        ticker: "AMD",
        marketDate: "not-a-date",
        capturedAt: "2026-05-08T20:00:00.000Z",
        price: 10,
        provider: "yahoo",
      },
      {
        ticker: "AMD",
        marketDate: "2026-05-08",
        capturedAt: "2026-05-08T20:00:00.000Z",
        price: 0,
        provider: "yahoo",
      },
      {
        ticker: "AMD",
        marketDate: "2026-05-08",
        capturedAt: "not-a-date",
        price: 10,
        provider: "yahoo",
      },
    ],
  }),
  { recorded: 1 },
);

const coverage = getStocksHistoryCoverage({
  dbPath: historyDbPath,
  tickers: ["NVDA", "AMD"],
});
assert.deepEqual(coverage.NVDA, {
  ticker: "NVDA",
  earliestMarketDate: "2026-05-06",
  latestMarketDate: "2026-05-07",
  pointCount: 2,
});
assert.deepEqual(coverage.AMD, {
  ticker: "AMD",
  earliestMarketDate: null,
  latestMarketDate: null,
  pointCount: 0,
});

updateStocksHistoryBackfillStatus({
  dbPath: historyDbPath,
  ticker: "nvda",
  requestedStartDate: "2026-05-01",
  lastAttemptAt: "2026-05-08T20:00:00.000Z",
  status: "failed",
  error: "provider unavailable",
});
updateStocksHistoryBackfillStatus({
  dbPath: historyDbPath,
  ticker: "NVDA",
  requestedStartDate: "2026-05-01",
  coveredThroughDate: "2026-05-07",
  lastAttemptAt: "2026-05-09T20:00:00.000Z",
  lastSuccessAt: "2026-05-09T20:00:00.000Z",
  provider: "yahoo",
  status: "success",
});
const historyDb = new DatabaseSync(historyDbPath);
const backfillStatus = historyDb
  .prepare("SELECT * FROM stock_history_backfill_status WHERE ticker = ?")
  .get("NVDA");
historyDb.close();
assert.equal(backfillStatus.ticker, "NVDA");
assert.equal(backfillStatus.status, "success");
assert.equal(backfillStatus.error, null);
assert.equal(backfillStatus.covered_through_date, "2026-05-07");

rmSync(dbPath, { force: true });
rmSync(historyDbPath, { force: true });

console.log("ok - stocks performance data");
