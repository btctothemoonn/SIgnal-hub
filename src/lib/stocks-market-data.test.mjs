import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALPHA_RESEARCH_STOCKS,
  getAlphaResearchStockByTicker,
} from "./alpha-research-pool.ts";
import {
  buildMockStocksMarketSnapshot,
  fetchAlphaVantageStocksMarketSnapshot,
  fetchFmpStocksMarketSnapshot,
  fetchFinnhubStocksMarketSnapshot,
  fetchMassiveStocksMarketSnapshot,
  getStocksMarketSnapshot,
  mergeStocksMarketSnapshot,
  parseAlphaVantageGlobalQuote,
  parseFinnhubQuote,
  parseFinnhubStockCandles,
  parseFmpHistoricalCandles,
  parseFmpQuoteRows,
  parseMassiveSnapshotRows,
  parseYahooChartCandles,
  parseYahooQuoteRows,
} from "./stocks-market-data.ts";

const quotePayload = {
  quoteResponse: {
    result: [
      {
        symbol: "NVDA",
        regularMarketPrice: 105,
        regularMarketPreviousClose: 100,
        regularMarketChangePercent: 5,
        preMarketChangePercent: 1.25,
        marketState: "PRE",
        regularMarketTime: 1778146200,
      },
      {
        symbol: "AMD",
        regularMarketPrice: 51,
        regularMarketPreviousClose: 50,
        regularMarketChangePercent: 2,
        postMarketChangePercent: -0.5,
        marketState: "POST",
        regularMarketTime: 1778146200,
      },
    ],
  },
};

const chartPayload = {
  chart: {
    result: [
      {
        timestamp: [
          1777536000,
          1777622400,
          1777708800,
          1777795200,
          1777881600,
        ],
        indicators: {
          quote: [
            {
              open: [96, 98, 100, 102, 104],
              high: [99, 101, 104, 106, 108],
              low: [95, 97, 99, 101, 103],
              close: [98, 100, 102, 104, 105],
              volume: [100, 150, 200, 250, 300],
            },
          ],
        },
      },
    ],
  },
};

const rows = parseYahooQuoteRows(quotePayload);
assert.equal(rows.length, 2);
assert.equal(rows[0].ticker, "NVDA");
assert.equal(rows[0].dayChangePct, 5);
assert.equal(rows[0].prePostChangePct, 1.25);
assert.equal(rows[0].marketSession, "pre-market");
assert.equal(rows[1].marketSession, "after-hours");

const massiveRows = parseMassiveSnapshotRows({
  tickers: [
    {
      ticker: "NVDA",
      lastTrade: { p: 118.25 },
      prevDay: { c: 115 },
      todaysChangePerc: 2.83,
      updated: 1778146200000000000,
    },
  ],
});
assert.equal(massiveRows[0].ticker, "NVDA");
assert.equal(massiveRows[0].lastPrice, 118.25);
assert.equal(massiveRows[0].dayChangePct, 2.83);

const alphaVantageQuote = parseAlphaVantageGlobalQuote("NVDA", {
  "Global Quote": {
    "01. symbol": "NVDA",
    "05. price": "123.45",
    "08. previous close": "120.00",
    "10. change percent": "2.875%",
  },
});
assert.equal(alphaVantageQuote?.ticker, "NVDA");
assert.equal(alphaVantageQuote?.lastPrice, 123.45);
assert.equal(alphaVantageQuote?.dayChangePct, 2.88);
assert.equal(alphaVantageQuote?.source, "live");
assert.equal(alphaVantageQuote?.prePostAvailable, false);

const finnhubQuote = parseFinnhubQuote("NVDA", {
  c: 126.5,
  pc: 120,
  dp: 5.4167,
  t: 1778146200,
});
assert.equal(finnhubQuote?.ticker, "NVDA");
assert.equal(finnhubQuote?.lastPrice, 126.5);
assert.equal(finnhubQuote?.dayChangePct, 5.42);
assert.equal(finnhubQuote?.source, "live");
assert.equal(finnhubQuote?.prePostAvailable, false);

const candles = parseYahooChartCandles("NVDA", chartPayload);
assert.equal(candles.length, 3);
assert.deepEqual(
  candles.map((candle) => candle.close),
  [102, 104, 105],
);
assert.equal(candles[2].volumeLabel, "1.2x");

const fmpQuoteRows = parseFmpQuoteRows([
  {
    symbol: "NVDA",
    price: 112.5,
    previousClose: 108,
    changesPercentage: 4.17,
    afterHoursChangePercent: -0.35,
  },
]);
assert.equal(fmpQuoteRows[0].ticker, "NVDA");
assert.equal(fmpQuoteRows[0].lastPrice, 112.5);
assert.equal(fmpQuoteRows[0].dayChangePct, 4.17);
assert.equal(fmpQuoteRows[0].prePostChangePct, -0.35);
assert.equal(fmpQuoteRows[0].marketSession, "after-hours");

const fmpCandles = parseFmpHistoricalCandles("NVDA", [
  { date: "2026-05-04", open: 100, high: 104, low: 99, close: 103, volume: 100 },
  { date: "2026-05-05", open: 104, high: 106, low: 102, close: 105, volume: 200 },
  { date: "2026-05-06", open: 105, high: 110, low: 104, close: 109, volume: 300 },
]);
assert.equal(fmpCandles.length, 3);
assert.deepEqual(
  fmpCandles.map((candle) => candle.close),
  [103, 105, 109],
);

const finnhubCandles = parseFinnhubStockCandles("NVDA", {
  s: "ok",
  t: [1777536000, 1777622400, 1777708800, 1777795200],
  o: [98, 100, 102, 104],
  h: [101, 103, 105, 108],
  l: [97, 99, 101, 103],
  c: [100, 102, 104, 106],
  v: [100, 200, 300, 400],
});
assert.equal(finnhubCandles.length, 3);
assert.deepEqual(
  finnhubCandles.map((candle) => candle.close),
  [102, 104, 106],
);

const finnhubFetchUrls = [];
const finnhubSnapshot = await fetchFinnhubStocksMarketSnapshot({
  tickers: ["NVDA"],
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_FINNHUB_MARKET_REQUEST_DELAY_MS: "0",
    STOCKS_FINNHUB_MARKET_CHART_MAX_TICKERS: "1",
  },
  fetchImpl: async (url) => {
    finnhubFetchUrls.push(String(url));
    if (String(url).includes("/quote")) {
      return Response.json({
        c: 126.5,
        pc: 120,
        dp: 5.4167,
        t: 1778146200,
      });
    }
    return Response.json({
      s: "ok",
      t: [1777536000, 1777622400, 1777708800],
      o: [98, 100, 102],
      h: [101, 103, 105],
      l: [97, 99, 101],
      c: [100, 102, 104],
      v: [100, 200, 300],
    });
  },
});
assert.equal(finnhubSnapshot.provider, "finnhub");
assert.equal(finnhubSnapshot.quotes.NVDA.lastPrice, 126.5);
assert.equal(finnhubSnapshot.quotes.NVDA.candles3d.length, 3);
assert.equal(finnhubSnapshot.freshness, "realtime");
assert.deepEqual(
  finnhubSnapshot.trace.map((item) => `${item.provider}:${item.status}`),
  ["finnhub:success"],
);
assert.ok(finnhubFetchUrls[0].includes("/quote"));
assert.ok(finnhubFetchUrls[1].includes("/stock/candle"));

const finnhubQuoteOnlyUrls = [];
const finnhubQuoteOnlySnapshot = await fetchFinnhubStocksMarketSnapshot({
  tickers: ["NVDA"],
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_FINNHUB_MARKET_REQUEST_DELAY_MS: "0",
  },
  fetchImpl: async (url) => {
    finnhubQuoteOnlyUrls.push(String(url));
    return Response.json({
      c: 126.5,
      pc: 120,
      dp: 5.4167,
      t: 1778146200,
    });
  },
});
assert.equal(finnhubQuoteOnlySnapshot.quotes.NVDA.candles3d.length, 0);
assert.equal(
  finnhubQuoteOnlyUrls.some((url) => url.includes("/stock/candle")),
  false,
);

const completeFinnhubQuoteUrls = [];
const completeFinnhubSnapshot = await getStocksMarketSnapshot({
  stocks: ["NVDA", "AMD"]
    .map((ticker) => getAlphaResearchStockByTicker(ticker))
    .filter(Boolean),
  provider: "finnhub",
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_FINNHUB_MARKET_REQUEST_DELAY_MS: "0",
    STOCKS_FINNHUB_MARKET_CHART_MAX_TICKERS: "0",
  },
  fetchImpl: async (url) => {
    const requestUrl = String(url);
    completeFinnhubQuoteUrls.push(requestUrl);
    if (requestUrl.includes("finnhub.io") && requestUrl.includes("/quote")) {
      const symbol = new URL(requestUrl).searchParams.get("symbol");
      return Response.json({
        c: symbol === "AMD" ? 52 : 126.5,
        pc: symbol === "AMD" ? 50 : 120,
        dp: symbol === "AMD" ? 4 : 5.4167,
        t: 1778146200,
      });
    }
    throw new Error(`unexpected request ${requestUrl}`);
  },
});
assert.equal(completeFinnhubSnapshot.provider, "finnhub");
assert.equal(completeFinnhubSnapshot.fallbackUsed, false);
assert.equal(Object.keys(completeFinnhubSnapshot.quotes).length, 2);
assert.equal(
  completeFinnhubQuoteUrls.some((url) => url.includes("query1.finance.yahoo.com")),
  false,
);

const partialFinnhubSnapshot = await getStocksMarketSnapshot({
  stocks: ["NVDA", "AMD"]
    .map((ticker) => getAlphaResearchStockByTicker(ticker))
    .filter(Boolean),
  provider: "finnhub",
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_FINNHUB_MARKET_REQUEST_DELAY_MS: "0",
  },
  fetchImpl: async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("finnhub.io") && requestUrl.includes("/quote")) {
      const symbol = new URL(requestUrl).searchParams.get("symbol");
      if (symbol === "AMD") {
        return new Response("rate limit", { status: 429 });
      }
      return Response.json({
        c: 126.5,
        pc: 120,
        dp: 5.4167,
        t: 1778146200,
      });
    }
    if (requestUrl.includes("finnhub.io") && requestUrl.includes("/stock/candle")) {
      return new Response("forbidden", { status: 403 });
    }
    if (requestUrl.includes("/v7/finance/quote")) {
      return Response.json({
        quoteResponse: {
          result: [
            {
              symbol: "NVDA",
              regularMarketPrice: 125,
              regularMarketPreviousClose: 120,
              regularMarketChangePercent: 4.17,
              marketState: "REGULAR",
            },
            {
              symbol: "AMD",
              regularMarketPrice: 52,
              regularMarketPreviousClose: 50,
              regularMarketChangePercent: 4,
              marketState: "REGULAR",
            },
          ],
        },
      });
    }
    return Response.json(chartPayload);
  },
});
assert.equal(partialFinnhubSnapshot.provider, "finnhub");
assert.equal(partialFinnhubSnapshot.fallbackUsed, true);
assert.equal(Object.keys(partialFinnhubSnapshot.quotes).length, 2);
assert.deepEqual(
  partialFinnhubSnapshot.trace.map((item) => `${item.provider}:${item.status}`),
  ["finnhub:success", "yahoo:success"],
);
assert.equal(partialFinnhubSnapshot.quotes.NVDA.provider, "finnhub");
assert.equal(partialFinnhubSnapshot.quotes.NVDA.fallbackUsed, false);
assert.equal(partialFinnhubSnapshot.quotes.NVDA.candles3d.length, 3);
assert.equal(partialFinnhubSnapshot.quotes.AMD.provider, "yahoo");
assert.equal(partialFinnhubSnapshot.quotes.AMD.fallbackUsed, true);
assert.equal(partialFinnhubSnapshot.quotes.AMD.dataQualityLabel, "回落到 Yahoo / 实时");

const fmpFetchUrls = [];
const fmpSnapshot = await fetchFmpStocksMarketSnapshot({
  tickers: ["NVDA", "AMD"],
  env: { STOCKS_FMP_API_KEY: "fmp-key" },
  fetchImpl: async (url) => {
    fmpFetchUrls.push(String(url));
    if (String(url).includes("batch-quote")) {
      return Response.json([
        { symbol: "NVDA", price: 112.5, previousClose: 108, changesPercentage: 4.17 },
        { symbol: "AMD", price: 52, previousClose: 50, changesPercentage: 4 },
      ]);
    }
    const symbol = new URL(String(url)).searchParams.get("symbol");
    return Response.json([
      { date: "2026-05-04", open: 100, high: 104, low: 99, close: 103, volume: 100 },
      { date: "2026-05-05", open: 104, high: 106, low: 102, close: 105, volume: 200 },
      { date: "2026-05-06", open: symbol === "AMD" ? 50 : 105, high: 110, low: 104, close: 109, volume: 300 },
    ]);
  },
});
assert.equal(fmpSnapshot.provider, "fmp");
assert.equal(fmpSnapshot.quotes.NVDA.lastPrice, 112.5);
assert.equal(fmpSnapshot.quotes.AMD.candles3d.length, 3);
assert.ok(fmpFetchUrls[0].includes("batch-quote"));

const massiveFetchUrls = [];
const massiveSnapshot = await fetchMassiveStocksMarketSnapshot({
  tickers: ["NVDA", "AMD"],
  env: {
    STOCKS_POLYGON_API_KEY: "massive-key",
    STOCKS_POLYGON_BASE_URL: "https://api.massive.com",
  },
  fetchImpl: async (url) => {
    massiveFetchUrls.push(String(url));
    return Response.json({
      tickers: [
        {
          ticker: "NVDA",
          lastTrade: { p: 118.25 },
          prevDay: { c: 115 },
          todaysChangePerc: 2.83,
        },
        {
          ticker: "AMD",
          day: { c: 52 },
          prevDay: { c: 50 },
        },
      ],
    });
  },
});
assert.equal(massiveSnapshot.provider, "massive");
assert.equal(massiveSnapshot.quotes.NVDA.lastPrice, 118.25);
assert.equal(massiveSnapshot.quotes.AMD.dayChangePct, 4);
assert.equal(massiveSnapshot.freshness, "realtime");
assert.equal(massiveSnapshot.fallbackUsed, false);
assert.deepEqual(
  massiveSnapshot.trace.map((item) => `${item.provider}:${item.status}`),
  ["massive:success"],
);
assert.equal(massiveSnapshot.quotes.NVDA.provider, "massive");
assert.equal(massiveSnapshot.quotes.NVDA.freshness, "realtime");
assert.equal(massiveSnapshot.quotes.NVDA.fallbackUsed, false);
assert.ok(massiveFetchUrls[0].startsWith("https://api.massive.com/"));
assert.ok(massiveFetchUrls[0].includes("tickers=NVDA%2CAMD"));

const alphaVantageFetchUrls = [];
const alphaVantageSnapshot = await fetchAlphaVantageStocksMarketSnapshot({
  tickers: ["NVDA", "AMD"],
  env: {
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
    STOCKS_ALPHA_VANTAGE_MARKET_MAX_TICKERS: "1",
    STOCKS_ALPHA_VANTAGE_MARKET_REQUEST_DELAY_MS: "0",
    STOCKS_MARKET_CACHE_MS: "0",
  },
  fetchImpl: async (url) => {
    alphaVantageFetchUrls.push(String(url));
    return Response.json({
      "Global Quote": {
        "01. symbol": "NVDA",
        "05. price": "123.45",
        "08. previous close": "120.00",
        "10. change percent": "2.875%",
      },
    });
  },
});
assert.equal(alphaVantageSnapshot.provider, "alpha-vantage");
assert.equal(alphaVantageSnapshot.quotes.NVDA.lastPrice, 123.45);
assert.equal(alphaVantageFetchUrls.length, 1);
assert.ok(alphaVantageFetchUrls[0].includes("function=GLOBAL_QUOTE"));
assert.ok(alphaVantageFetchUrls[0].includes("symbol=NVDA"));

const alphaVantageCachePath = join(
  tmpdir(),
  `signal-hub-stocks-market-${Date.now()}-${Math.random()}.json`,
);
let alphaVantageCachedFetchCount = 0;
try {
  await fetchAlphaVantageStocksMarketSnapshot({
    tickers: ["NVDA"],
    env: {
      STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
      STOCKS_ALPHA_VANTAGE_MARKET_MAX_TICKERS: "1",
      STOCKS_ALPHA_VANTAGE_MARKET_REQUEST_DELAY_MS: "0",
      STOCKS_MARKET_CACHE_MS: "60000",
      STOCKS_MARKET_CACHE_PATH: alphaVantageCachePath,
    },
    fetchImpl: async () => {
      alphaVantageCachedFetchCount += 1;
      return Response.json({
        "Global Quote": {
          "01. symbol": "NVDA",
          "05. price": "125.00",
          "08. previous close": "120.00",
          "10. change percent": "4.1667%",
        },
      });
    },
  });
  const cachedSnapshot = await fetchAlphaVantageStocksMarketSnapshot({
    tickers: ["NVDA"],
    env: {
      STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
      STOCKS_ALPHA_VANTAGE_MARKET_MAX_TICKERS: "1",
      STOCKS_ALPHA_VANTAGE_MARKET_REQUEST_DELAY_MS: "0",
      STOCKS_MARKET_CACHE_MS: "60000",
      STOCKS_MARKET_CACHE_PATH: alphaVantageCachePath,
    },
    fetchImpl: async () => {
      throw new Error("cache was not used");
    },
  });
  assert.equal(alphaVantageCachedFetchCount, 1);
  assert.equal(cachedSnapshot.quotes.NVDA.lastPrice, 125);
} finally {
  rmSync(alphaVantageCachePath, { force: true });
}

const fallbackSnapshot = await getStocksMarketSnapshot({
  stocks: [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
  provider: "finnhub",
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
  },
  fetchImpl: async (url) => {
    if (String(url).includes("finnhub.io")) {
      return new Response("rate limit", { status: 429 });
    }
    if (String(url).includes("/v7/finance/quote")) {
      return Response.json({
        quoteResponse: {
          result: [
            {
              symbol: "NVDA",
              regularMarketPrice: 105,
              regularMarketPreviousClose: 100,
              regularMarketChangePercent: 5,
              marketState: "REGULAR",
            },
          ],
        },
      });
    }
    return Response.json(chartPayload);
  },
});
assert.equal(fallbackSnapshot.provider, "yahoo");
assert.equal(fallbackSnapshot.quotes.NVDA.lastPrice, 105);
assert.equal(fallbackSnapshot.freshness, "realtime");
assert.equal(fallbackSnapshot.fallbackUsed, true);
assert.deepEqual(
  fallbackSnapshot.trace.map((item) => `${item.provider}:${item.status}`),
  ["finnhub:failed", "yahoo:success"],
);
assert.equal(fallbackSnapshot.quotes.NVDA.provider, "yahoo");
assert.equal(fallbackSnapshot.quotes.NVDA.freshness, "realtime");
assert.equal(fallbackSnapshot.quotes.NVDA.fallbackUsed, true);
assert.ok(fallbackSnapshot.errors.some((error) => error.includes("Finnhub market data returned no usable quotes")));

const mockSnapshot = buildMockStocksMarketSnapshot(
  [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
);
assert.equal(mockSnapshot.source, "mock");
assert.equal(mockSnapshot.freshness, "mock");
assert.equal(mockSnapshot.fallbackUsed, false);
assert.equal(mockSnapshot.trace[0].provider, "mock");
assert.equal(mockSnapshot.quotes.NVDA.candles3d.length, 3);

const merged = mergeStocksMarketSnapshot(ALPHA_RESEARCH_STOCKS, {
  generatedAt: "2026-05-07T04:00:00.000Z",
  source: "live",
  provider: "yahoo",
  errors: [],
  quotes: {
    NVDA: {
      ...rows[0],
      sevenDayChangePct: 7.14,
      relativeStrengthLabel: "强势",
      candles3d: candles,
      source: "live",
      provider: "yahoo",
      freshness: "realtime",
      fallbackUsed: true,
      trace: [
        { provider: "fmp", status: "failed", message: "FMP quote HTTP 429" },
        { provider: "yahoo", status: "success", message: "Yahoo returned 1 quote", quoteCount: 1 },
      ],
      updatedAt: "2026-05-07T04:10:00.000Z",
    },
  },
});

const nvda = merged.find((stock) => stock.ticker === "NVDA");
const tsm = merged.find((stock) => stock.ticker === "TSM");
assert.equal(nvda?.market.lastPrice, 105);
assert.equal(nvda?.market.prePostChangePct, 1.25);
assert.equal(nvda?.market.marketSession, "pre-market");
assert.equal(nvda?.market.sevenDayChangePct, 7.14);
assert.equal(nvda?.market.source, "live");
assert.equal(nvda?.market.updatedAt, "2026-05-07T04:10:00.000Z");
assert.equal(nvda?.market.candlesSource, "live");
assert.equal(nvda?.market.freshness, "realtime");
assert.equal(nvda?.market.fallbackUsed, true);
assert.equal(nvda?.market.dataQualityLabel, "回落到 Yahoo / 实时");
assert.equal(nvda?.market.providerTrace?.length, 2);
assert.equal(nvda?.candles3d[2].close, 105);
assert.equal(tsm?.market.lastPrice, getAlphaResearchStockByTicker("TSM")?.market.lastPrice);
assert.notEqual(tsm?.market.source, "live");

console.log("ok - stocks market data");
