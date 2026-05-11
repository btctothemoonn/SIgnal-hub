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

rmSync(dbPath, { force: true });

console.log("ok - stocks performance data");
