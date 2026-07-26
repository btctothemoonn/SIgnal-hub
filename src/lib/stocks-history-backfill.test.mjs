import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  getStocksHistoryCoverage,
} from "./stocks-performance-data.ts";
import {
  backfillStocksHistory,
  parseEodhdHistoricalDailyPoints,
  parseYahooHistoricalDailyPoints,
} from "./stocks-history-backfill.ts";

const yahooPoints = parseYahooHistoricalDailyPoints("nvda", {
  chart: {
    result: [{
      timestamp: [1778068800, 1778155200],
      indicators: {
        quote: [{ close: [91, 93] }],
        adjclose: [{ adjclose: [90.5, 92.5] }],
      },
    }],
  },
});
assert.deepEqual(
  yahooPoints.map(({ ticker, marketDate, price, provider }) => ({
    ticker,
    marketDate,
    price,
    provider,
  })),
  [
    { ticker: "NVDA", marketDate: "2026-05-06", price: 90.5, provider: "yahoo" },
    { ticker: "NVDA", marketDate: "2026-05-07", price: 92.5, provider: "yahoo" },
  ],
);

const eodhdPoints = parseEodhdHistoricalDailyPoints("amd", [
  { date: "2026-05-08", close: 12, adjusted_close: 11.5 },
  { date: "not-a-date", adjusted_close: 10 },
  { date: "2026-05-06", adjusted_close: "9.5" },
  { date: "2026-05-07", close: 0 },
  null,
]);
assert.deepEqual(
  eodhdPoints.map(({ ticker, marketDate, price, provider }) => ({
    ticker,
    marketDate,
    price,
    provider,
  })),
  [
    { ticker: "AMD", marketDate: "2026-05-06", price: 9.5, provider: "eodhd" },
    { ticker: "AMD", marketDate: "2026-05-08", price: 11.5, provider: "eodhd" },
  ],
);

const dbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-history-backfill-test-${process.pid}.sqlite`,
);
rmSync(dbPath, { force: true });

const calls = [];
const fetchImpl = async (url) => {
  calls.push(url);
  if (url.includes("query1.finance.yahoo.com") && url.includes("NVDA")) {
    return { ok: false, status: 429, json: async () => ({}) };
  }
  if (url.includes("eodhd.com") && url.includes("NVDA")) {
    return {
      ok: true,
      status: 200,
      json: async () => [
        { date: "2026-05-06", adjusted_close: 90.5 },
        { date: "2026-05-07", adjusted_close: 92.5 },
      ],
    };
  }
  if (url.includes("query1.finance.yahoo.com") && url.includes("AMD")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [1778068800, 1778155200],
            indicators: { quote: [{ close: [10, 11] }] },
          }],
        },
      }),
    };
  }
  throw new Error(`Unexpected request: ${url}`);
};

const options = {
  tickers: ["nvda", "AMD", "NVDA"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  dbPath,
  env: {
    STOCKS_EODHD_API_KEY: "test-key",
    STOCKS_HISTORY_REQUEST_DELAY_MS: "0",
  },
  fetchImpl,
};

const results = await backfillStocksHistory(options);
assert.deepEqual(
  results.map(({ ticker, status, provider }) => ({ ticker, status, provider })),
  [
    { ticker: "NVDA", status: "success", provider: "eodhd" },
    { ticker: "AMD", status: "success", provider: "yahoo" },
  ],
);
assert.equal(calls.length, 3);
assert.match(calls[0], /period1=1778025600/);
assert.match(calls[0], /period2=1778198400/);
assert.match(calls[1], /api_token=test-key/);

const firstCoverage = getStocksHistoryCoverage({
  dbPath,
  tickers: ["NVDA", "AMD"],
});
assert.equal(firstCoverage.NVDA.pointCount, 2);
assert.equal(firstCoverage.AMD.pointCount, 2);

await backfillStocksHistory(options);
const secondCoverage = getStocksHistoryCoverage({
  dbPath,
  tickers: ["NVDA", "AMD"],
});
assert.deepEqual(secondCoverage, firstCoverage);

rmSync(dbPath, { force: true });

console.log("ok - stocks history backfill");
