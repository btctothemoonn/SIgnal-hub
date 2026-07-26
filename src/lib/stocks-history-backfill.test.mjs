import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  getStocksHistoryBackfillStatus,
  getStocksHistoryCoverage,
  recordStocksHistoricalDailyPoints,
  updateStocksHistoryBackfillStatus,
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

assert.deepEqual(
  parseEodhdHistoricalDailyPoints("nvda", [
    { date: "2026-06-15", adjusted_close: 100 },
    { date: "2026-01-15", adjusted_close: 90 },
  ]).map(({ marketDate, capturedAt }) => ({ marketDate, capturedAt })),
  [
    { marketDate: "2026-01-15", capturedAt: "2026-01-15T21:00:00.000Z" },
    { marketDate: "2026-06-15", capturedAt: "2026-06-15T20:00:00.000Z" },
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

const statelessStorage = {
  getCoverage: ({ tickers }) =>
    Object.fromEntries(
      tickers.map((ticker) => [
        ticker,
        {
          ticker,
          earliestMarketDate: null,
          latestMarketDate: null,
          pointCount: 0,
        },
      ]),
    ),
  getBackfillStatus: () => null,
  recordDailyPoints: ({ points }) => ({ recorded: points.length }),
  updateBackfillStatus: () => {},
};

const eodhdSymbolUrls = [];
const eodhdSymbolResults = await backfillStocksHistory({
  tickers: ["NVDA", "000660.KS"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  env: {
    STOCKS_EODHD_API_KEY: "test-key",
    STOCKS_HISTORY_REQUEST_DELAY_MS: "0",
  },
  storage: statelessStorage,
  fetchImpl: async (url) => {
    if (url.includes("query1.finance.yahoo.com")) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    eodhdSymbolUrls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => [{ date: "2026-05-06", adjusted_close: 100 }],
    };
  },
});
assert.deepEqual(
  eodhdSymbolResults.map(({ ticker, status, provider }) => ({
    ticker,
    status,
    provider,
  })),
  [
    { ticker: "NVDA", status: "success", provider: "eodhd" },
    { ticker: "000660.KS", status: "success", provider: "eodhd" },
  ],
);
assert.deepEqual(eodhdSymbolUrls, [
  "https://eodhd.com/api/eod/NVDA.US?api_token=test-key&fmt=json&period=d&from=2026-05-06&to=2026-05-08",
  "https://eodhd.com/api/eod/000660.KO?api_token=test-key&fmt=json&period=d&from=2026-05-06&to=2026-05-08",
]);

let stalledYahooSignal;
let timeoutFallbackSignal;
let timeoutGuard;
const timeoutFallbackPromise = backfillStocksHistory({
  tickers: ["NVDA"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  env: {
    STOCKS_EODHD_API_KEY: "timeout-key",
    STOCKS_HISTORY_REQUEST_DELAY_MS: "0",
    STOCKS_HISTORY_REQUEST_TIMEOUT_MS: "20",
  },
  storage: statelessStorage,
  fetchImpl: async (url, init) => {
    if (url.includes("query1.finance.yahoo.com")) {
      stalledYahooSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        stalledYahooSignal?.addEventListener(
          "abort",
          () => reject(stalledYahooSignal.reason),
          { once: true },
        );
      });
    }
    timeoutFallbackSignal = init?.signal;
    return {
      ok: true,
      status: 200,
      json: async () => [{ date: "2026-05-06", adjusted_close: 100 }],
    };
  },
});
const timeoutFallbackResults = await Promise.race([
  timeoutFallbackPromise,
  new Promise((_, reject) => {
    timeoutGuard = setTimeout(
      () => reject(new Error("Yahoo history timeout did not fall back")),
      500,
    );
  }),
]).finally(() => clearTimeout(timeoutGuard));
assert.deepEqual(
  timeoutFallbackResults.map(({ status, provider }) => ({ status, provider })),
  [{ status: "success", provider: "eodhd" }],
);
assert.equal(stalledYahooSignal?.aborted, true);
assert.equal(timeoutFallbackSignal?.aborted, false);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(timeoutFallbackSignal?.aborted, false);

const eodhdTimeoutSignals = [];
let eodhdTimeoutGuard;
const eodhdTimeoutPromise = backfillStocksHistory({
  tickers: ["NVDA"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  env: {
    STOCKS_EODHD_API_KEYS: "stalled-key, recovery-key",
    STOCKS_HISTORY_REQUEST_DELAY_MS: "0",
    STOCKS_HISTORY_REQUEST_TIMEOUT_MS: "20",
  },
  storage: statelessStorage,
  fetchImpl: async (url, init) => {
    if (url.includes("query1.finance.yahoo.com")) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    eodhdTimeoutSignals.push(init?.signal);
    if (url.includes("api_token=stalled-key")) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      });
    }
    return {
      ok: true,
      status: 200,
      json: async () => [{ date: "2026-05-06", adjusted_close: 100 }],
    };
  },
});
const eodhdTimeoutResults = await Promise.race([
  eodhdTimeoutPromise,
  new Promise((_, reject) => {
    eodhdTimeoutGuard = setTimeout(
      () => reject(new Error("EODHD history timeout did not rotate keys")),
      500,
    );
  }),
]).finally(() => clearTimeout(eodhdTimeoutGuard));
assert.deepEqual(
  eodhdTimeoutResults.map(({ status, provider }) => ({ status, provider })),
  [{ status: "success", provider: "eodhd" }],
);
assert.equal(eodhdTimeoutSignals[0]?.aborted, true);
assert.equal(eodhdTimeoutSignals[1]?.aborted, false);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(eodhdTimeoutSignals[1]?.aborted, false);

const rotatedKeyUrls = [];
const rotatedKeyResults = await backfillStocksHistory({
  tickers: ["NVDA"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  env: {
    STOCKS_EODHD_API_KEYS: "exhausted-key, backup-key",
    STOCKS_HISTORY_REQUEST_DELAY_MS: "0",
  },
  storage: statelessStorage,
  fetchImpl: async (url) => {
    if (url.includes("query1.finance.yahoo.com")) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    rotatedKeyUrls.push(url);
    if (url.includes("api_token=exhausted-key")) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [{ date: "2026-05-06", adjusted_close: 100 }],
    };
  },
});
assert.deepEqual(
  rotatedKeyResults.map(({ status, provider, error }) => ({
    status,
    provider,
    error,
  })),
  [{ status: "success", provider: "eodhd", error: null }],
);
assert.deepEqual(rotatedKeyUrls, [
  "https://eodhd.com/api/eod/NVDA.US?api_token=exhausted-key&fmt=json&period=d&from=2026-05-06&to=2026-05-08",
  "https://eodhd.com/api/eod/NVDA.US?api_token=backup-key&fmt=json&period=d&from=2026-05-06&to=2026-05-08",
]);

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

const storageFailureDbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-history-storage-failure-test-${process.pid}.sqlite`,
);
rmSync(storageFailureDbPath, { force: true });

const storageFailureResults = await backfillStocksHistory({
  tickers: ["NVDA", "AMD"],
  startDate: "2026-05-06",
  endDate: "2026-05-08",
  dbPath: storageFailureDbPath,
  env: { STOCKS_HISTORY_REQUEST_DELAY_MS: "0" },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      chart: {
        result: [{
          timestamp: [1778068800],
          indicators: { quote: [{ close: [100] }] },
        }],
      },
    }),
  }),
  storage: {
    getCoverage: getStocksHistoryCoverage,
    getBackfillStatus: getStocksHistoryBackfillStatus,
    recordDailyPoints: ({ points, ...input }) => {
      if (points[0]?.ticker === "NVDA") {
        throw new Error("NVDA storage unavailable");
      }
      return recordStocksHistoricalDailyPoints({ points, ...input });
    },
    updateBackfillStatus: updateStocksHistoryBackfillStatus,
  },
});
assert.deepEqual(
  storageFailureResults.map(({ ticker, status, provider }) => ({
    ticker,
    status,
    provider,
  })),
  [
    { ticker: "NVDA", status: "failed", provider: null },
    { ticker: "AMD", status: "success", provider: "yahoo" },
  ],
);
assert.match(storageFailureResults[0].error ?? "", /NVDA storage unavailable/);
rmSync(storageFailureDbPath, { force: true });

const repairDbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-history-repair-test-${process.pid}.sqlite`,
);
rmSync(repairDbPath, { force: true });

let repairPhase = "initial";
const repairCalls = [];
const repairFetch = async (url) => {
  repairCalls.push(url);
  if (repairPhase === "initial") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [1778097600, 1782849600],
            indicators: { quote: [{ close: [90, 100] }] },
          }],
        },
      }),
    };
  }
  if (repairPhase === "failed-tail") {
    return { ok: false, status: 503, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      chart: {
        result: [{
          timestamp: [1782849600],
          indicators: { quote: [{ close: [100] }] },
        }],
      },
    }),
  };
};

const repairOptions = {
  tickers: ["NVDA"],
  startDate: "2026-05-06",
  endDate: "2026-06-30",
  dbPath: repairDbPath,
  env: { STOCKS_EODHD_API_KEY: "test-key", STOCKS_HISTORY_REQUEST_DELAY_MS: "0" },
  fetchImpl: repairFetch,
};
assert.equal((await backfillStocksHistory(repairOptions))[0].status, "success");

repairPhase = "failed-tail";
assert.equal(
  (await backfillStocksHistory({ ...repairOptions, endDate: "2026-07-15" }))[0]
    .status,
  "failed",
);

repairPhase = "repair";
repairCalls.length = 0;
await backfillStocksHistory({ ...repairOptions, endDate: "2026-07-16" });
const repairUrl = new URL(repairCalls[0]);
assert.equal(
  repairUrl.searchParams.get("period1"),
  String(Date.parse("2026-06-16T00:00:00.000Z") / 1000),
);
rmSync(repairDbPath, { force: true });

console.log("ok - stocks history backfill");
