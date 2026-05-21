import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  getStocksPerformanceSnapshot,
  marketDateInNewYork,
  recordStocksPerformanceSnapshot,
} from "./stocks-performance-data.ts";

const dbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-performance-test-${process.pid}.sqlite`,
);
rmSync(dbPath, { force: true });

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
  [firstAt, thirdAt],
);
assert.equal(downsampledNvda?.latestChangePct, 20);

rmSync(dbPath, { force: true });

console.log("ok - stocks performance data");
