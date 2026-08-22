import assert from "node:assert/strict";

const binanceModule = await import("./binance-holdings.ts");
const { createBinanceFuturesHistoryClient } = binanceModule;

assert.equal(
  typeof createBinanceFuturesHistoryClient,
  "function",
  "Binance history client should provide trades and mark-price candles",
);

const requests = [];
const fetcher = async (input, init = {}) => {
  const url = new URL(String(input));
  requests.push({ url, init });

  if (url.pathname === "/api/v3/time") {
    return new Response(JSON.stringify({ serverTime: 1_700_000_000_000 }), {
      status: 200,
    });
  }
  if (url.pathname === "/fapi/v1/userTrades") {
    return new Response(
      JSON.stringify([
        {
          time: 1_699_999_000_000,
          side: "BUY",
          positionSide: "BOTH",
          qty: "1.5",
        },
      ]),
      { status: 200 },
    );
  }
  if (url.pathname === "/fapi/v1/markPriceKlines") {
    return new Response(
      JSON.stringify([
        [1_699_999_000_000, "100", "120", "90", "110", 0, 1_699_999_059_999],
      ]),
      { status: 200 },
    );
  }
  throw new Error(`Unexpected Binance request: ${url.pathname}`);
};

const client = await createBinanceFuturesHistoryClient({
  accountMode: "standard",
  env: {
    BINANCE_API_KEY: "test-key",
    BINANCE_API_SECRET: "test-secret",
  },
  fetcher,
  now: () => 1_700_000_000_000,
});

assert.deepEqual(await client.getUserTrades("BTCUSDT"), [
  {
    time: 1_699_999_000_000,
    side: "BUY",
    positionSide: "BOTH",
    qty: 1.5,
  },
]);
assert.deepEqual(
  await client.getMarkPriceCandles({
    symbol: "BTCUSDT",
    interval: "1m",
    startTime: 1_699_999_000_000,
    endTime: 1_700_000_000_000,
  }),
  [
    {
      openTime: 1_699_999_000_000,
      high: 120,
      low: 90,
      closeTime: 1_699_999_059_999,
    },
  ],
);

const tradeRequest = requests.find(
  ({ url }) => url.pathname === "/fapi/v1/userTrades",
);
assert.equal(tradeRequest.url.searchParams.get("symbol"), "BTCUSDT");
assert.equal(tradeRequest.url.searchParams.get("limit"), "1000");
assert.equal(tradeRequest.init.headers["X-MBX-APIKEY"], "test-key");
assert.ok(tradeRequest.url.searchParams.get("signature"));

const klineRequest = requests.find(
  ({ url }) => url.pathname === "/fapi/v1/markPriceKlines",
);
assert.equal(klineRequest.url.searchParams.get("interval"), "1m");
assert.equal(klineRequest.url.searchParams.get("limit"), "1500");
assert.equal(klineRequest.url.searchParams.get("startTime"), "1699999000000");

const portfolioRequests = [];
const portfolioClient = await createBinanceFuturesHistoryClient({
  accountMode: "portfolioMargin",
  env: {
    BINANCE_API_KEY: "test-key",
    BINANCE_API_SECRET: "test-secret",
  },
  fetcher: async (input) => {
    const url = new URL(String(input));
    portfolioRequests.push(url.pathname);
    if (url.pathname === "/api/v3/time") {
      return new Response(JSON.stringify({ serverTime: 1_700_000_000_000 }), {
        status: 200,
      });
    }
    if (url.pathname === "/papi/v1/um/userTrades") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`Unexpected Binance request: ${url.pathname}`);
  },
  now: () => 1_700_000_000_000,
});
await portfolioClient.getUserTrades("ETHUSDT");
assert.ok(portfolioRequests.includes("/papi/v1/um/userTrades"));

console.log("ok - Binance position history client");
