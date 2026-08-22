import assert from "node:assert/strict";
import {
  BinanceNetworkError,
  buildHoldingSummary,
  buildSignedBinanceQuery,
  createBinanceSignature,
  filterSpotBalancesByUsdtValue,
  getBinanceHoldingSnapshot,
  normalizeFuturesPositions,
  normalizeSpotBalances,
  resetBinanceHoldingRuntimeHints,
  resolveBinanceConfig,
} from "./binance-holdings.ts";

assert.equal(
  createBinanceSignature("timestamp=1700000000000&recvWindow=5000", "secret"),
  "52713c242e41357b33f1eeba15ca7207838d2487182ac9873a8d305ae59b0d8b",
);

assert.equal(
  buildSignedBinanceQuery({
    params: { recvWindow: 5000, timestamp: 1700000000000 },
    secret: "secret",
  }),
  "recvWindow=5000&timestamp=1700000000000&signature=f98849c4b4d023c32a8377514e4918140ac3f2cfa817c944db3400bef0f7fa0a",
);

assert.deepEqual(
  normalizeSpotBalances([
    { asset: "BTC", free: "0.25", locked: "0.05" },
    { asset: "USDT", free: "1250.5", locked: "0" },
    { asset: "ETH", free: "0", locked: "0" },
  ]),
  [
    {
      asset: "USDT",
      free: 1250.5,
      locked: 0,
      total: 1250.5,
    },
    {
      asset: "BTC",
      free: 0.25,
      locked: 0.05,
      total: 0.3,
    },
  ],
);

assert.deepEqual(
  filterSpotBalancesByUsdtValue({
    balances: normalizeSpotBalances([
      { asset: "USDT", free: "600", locked: "0" },
      { asset: "BTC", free: "0.01", locked: "0" },
      { asset: "ETH", free: "0.1", locked: "0" },
      { asset: "ABC", free: "100", locked: "0" },
    ]),
    tickers: [
      { symbol: "BTCUSDT", price: "60000" },
      { symbol: "ETHUSDT", price: "3000" },
    ],
  }),
  [
    {
      asset: "BTC",
      free: 0.01,
      locked: 0,
      total: 0.01,
      usdtPrice: 60000,
      usdtValue: 600,
    },
    {
      asset: "USDT",
      free: 600,
      locked: 0,
      total: 600,
      usdtPrice: 1,
      usdtValue: 600,
    },
  ],
);

assert.deepEqual(
  normalizeFuturesPositions([
    {
      symbol: "BTCUSDT",
      positionAmt: "0.12",
      entryPrice: "65000",
      markPrice: "66000",
      unRealizedProfit: "120",
      liquidationPrice: "52000",
      leverage: "10",
      marginType: "isolated",
      notional: "7920",
    },
    {
      symbol: "ETHUSDT",
      positionAmt: "-2",
      entryPrice: "3500",
      markPrice: "3400",
      unRealizedProfit: "200",
      liquidationPrice: "4100",
      leverage: "5",
      marginType: "cross",
      notional: "-6800",
    },
    {
      symbol: "BNBUSDT",
      positionAmt: "0",
      entryPrice: "0",
      markPrice: "600",
      unRealizedProfit: "0",
      liquidationPrice: "0",
      leverage: "3",
      marginType: "cross",
      notional: "0",
    },
  ]),
  [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      amount: 0.12,
      entryPrice: 65000,
      markPrice: 66000,
      unrealizedPnl: 120,
      liquidationPrice: 52000,
      leverage: 10,
      marginType: "isolated",
      notional: 7920,
    },
    {
      symbol: "ETHUSDT",
      side: "SHORT",
      amount: -2,
      entryPrice: 3500,
      markPrice: 3400,
      unrealizedPnl: 200,
      liquidationPrice: 4100,
      leverage: 5,
      marginType: "cross",
      notional: -6800,
    },
  ],
);

assert.deepEqual(
  buildHoldingSummary({
    spotBalances: normalizeSpotBalances([
      { asset: "BTC", free: "0.25", locked: "0.05" },
      { asset: "USDT", free: "1250.5", locked: "0" },
    ]),
    futuresPositions: normalizeFuturesPositions([
      {
        symbol: "BTCUSDT",
        positionAmt: "0.12",
        entryPrice: "65000",
        markPrice: "66000",
        unRealizedProfit: "120",
        liquidationPrice: "52000",
        leverage: "10",
        marginType: "isolated",
        notional: "7920",
      },
      {
        symbol: "ETHUSDT",
        positionAmt: "-2",
        entryPrice: "3500",
        markPrice: "3400",
        unRealizedProfit: "200",
        liquidationPrice: "4100",
        leverage: "5",
        marginType: "cross",
        notional: "-6800",
      },
    ]),
    futuresAccount: {
      totalWalletBalance: "2500.25",
      totalUnrealizedProfit: "320",
      totalMarginBalance: "2820.25",
      availableBalance: "1800",
    },
  }),
  {
    spotAssetCount: 2,
    futuresPositionCount: 2,
    futuresWalletBalance: 2500.25,
    futuresUnrealizedPnl: 320,
    futuresMarginBalance: 2820.25,
    futuresAvailableBalance: 1800,
    futuresLongNotional: 7920,
    futuresShortNotional: 6800,
    futuresGrossNotional: 14720,
    futuresNetNotional: 1120,
  },
);

assert.deepEqual(
  resolveBinanceConfig({
    env: {
      BINANCE_SPOT_BASE_URL: "https://spot.example",
      BINANCE_FUTURES_BASE_URL: "https://futures.example",
      BINANCE_PORTFOLIO_BASE_URL: "https://portfolio.example",
      BINANCE_RECV_WINDOW: "7000",
      BINANCE_PROXY_URL: "http://127.0.0.1:7890",
    },
    storedCredentials: {
      apiKey: "stored-key",
      apiSecret: "stored-secret",
    },
  }),
  {
    apiKey: "stored-key",
    apiSecret: "stored-secret",
    spotBaseUrl: "https://spot.example",
    futuresBaseUrl: "https://futures.example",
    portfolioBaseUrl: "https://portfolio.example",
    recvWindow: 7000,
    proxyUrl: "http://127.0.0.1:7890",
  },
);

assert.deepEqual(
  resolveBinanceConfig({
    env: {
      BINANCE_API_KEY: "env-key",
      BINANCE_API_SECRET: "env-secret",
    },
    storedCredentials: {
      apiKey: "stored-key",
      apiSecret: "stored-secret",
    },
  }),
  {
    apiKey: "env-key",
    apiSecret: "env-secret",
    spotBaseUrl: "https://api.binance.com",
    futuresBaseUrl: "https://fapi.binance.com",
    portfolioBaseUrl: "https://papi.binance.com",
    recvWindow: 5000,
    proxyUrl: null,
  },
);

await assert.rejects(
  () =>
    getBinanceHoldingSnapshot({
      env: {
        BINANCE_API_KEY: "env-key",
        BINANCE_API_SECRET: "env-secret",
      },
      fetcher: async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect blocked"), {
            code: "EACCES",
          }),
        });
      },
      now: () => 1700000000000,
    }),
  (error) => {
    assert.ok(error instanceof BinanceNetworkError);
    assert.equal(error.endpoint, "/api/v3/account");
    assert.match(error.message, /无法连接 Binance/);
    assert.match(error.message, /EACCES/);
    return true;
  },
);

{
  resetBinanceHoldingRuntimeHints();
  const snapshot = await getBinanceHoldingSnapshot({
    env: {
      BINANCE_API_KEY: "env-key",
      BINANCE_API_SECRET: "env-secret",
    },
    fetcher: async (url) => {
      const endpoint = String(url);
      if (endpoint.includes("/api/v3/account")) {
        return new Response(
          JSON.stringify({
            balances: [
              { asset: "USDT", free: "600", locked: "0" },
              { asset: "BTC", free: "0", locked: "0" },
            ],
          }),
          { status: 200 },
        );
      }

      if (endpoint.includes("/api/v3/ticker/price")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          code: -2015,
          msg: "Invalid API-key, IP, or permissions for action.",
        }),
        { status: 401, statusText: "Unauthorized" },
      );
    },
    now: () => 1700000000000,
  });

  assert.deepEqual(snapshot.spotBalances, [
    {
      asset: "USDT",
      free: 600,
      locked: 0,
      total: 600,
      usdtPrice: 1,
      usdtValue: 600,
    },
  ]);
  assert.deepEqual(snapshot.futuresPositions, []);
  assert.equal(snapshot.summary.futuresWalletBalance, 0);
  assert.equal(snapshot.summary.futuresPositionCount, 0);
  assert.deepEqual(snapshot.warnings, [
    {
      scope: "futures",
      endpoint: "/fapi/v3/account",
      status: 401,
      message:
        "这组 Binance API 尚未开启合约读取权限。请在 Binance API 管理中开启合约或统一账户相关权限后再查看合约持仓。",
    },
  ]);
}

{
  resetBinanceHoldingRuntimeHints();
  const requestedPaths = [];
  const snapshot = await getBinanceHoldingSnapshot({
    env: {
      BINANCE_API_KEY: "env-key",
      BINANCE_API_SECRET: "env-secret",
    },
    fetcher: async (url) => {
      const endpoint = new URL(String(url)).pathname;
      requestedPaths.push(endpoint);

      if (endpoint === "/api/v3/account") {
        return new Response(
          JSON.stringify({
            balances: [{ asset: "USDT", free: "600", locked: "0" }],
          }),
          { status: 200 },
        );
      }

      if (endpoint === "/api/v3/ticker/price") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (endpoint.startsWith("/fapi/")) {
        return new Response(
          JSON.stringify({
            code: -2015,
            msg: "Invalid API-key, IP, or permissions for action.",
          }),
          { status: 401, statusText: "Unauthorized" },
        );
      }

      if (endpoint === "/papi/v1/account") {
        return new Response(
          JSON.stringify({
            accountEquity: "5025.5",
            totalAvailableBalance: "3000.25",
            totalMarginOpenLoss: "-20.5",
          }),
          { status: 200 },
        );
      }

      if (endpoint === "/papi/v1/um/positionRisk") {
        return new Response(
          JSON.stringify([
            {
              symbol: "BTCUSDT",
              positionAmt: "0.1",
              entryPrice: "65000",
              markPrice: "66000",
              unRealizedProfit: "100",
              liquidationPrice: "50000",
              leverage: "10",
              notional: "6600",
            },
          ]),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ msg: "not found" }), {
        status: 404,
      });
    },
    now: () => 1700000000000,
  });

  assert.equal(snapshot.accountMode, "portfolioMargin");
  assert.deepEqual(requestedPaths, [
    "/api/v3/time",
    "/api/v3/account",
    "/api/v3/ticker/price",
    "/fapi/v3/account",
    "/fapi/v3/positionRisk",
    "/papi/v1/account",
    "/papi/v1/um/positionRisk",
  ]);
  assert.equal(snapshot.futuresPositions.length, 1);
  assert.equal(snapshot.summary.futuresWalletBalance, 5025.5);
  assert.equal(snapshot.summary.futuresMarginBalance, 5025.5);
  assert.equal(snapshot.summary.futuresAvailableBalance, 3000.25);
  assert.equal(snapshot.summary.futuresUnrealizedPnl, 100);
  assert.deepEqual(snapshot.warnings, []);
}

{
  resetBinanceHoldingRuntimeHints();
  const requestedPaths = [];
  const buildSnapshot = () =>
    getBinanceHoldingSnapshot({
      env: {
        BINANCE_API_KEY: "env-key",
        BINANCE_API_SECRET: "env-secret",
      },
      fetcher: async (url) => {
        const endpoint = new URL(String(url)).pathname;
        requestedPaths.push(endpoint);

        if (endpoint === "/api/v3/time") {
          return new Response(JSON.stringify({ serverTime: 1700000000000 }), {
            status: 200,
          });
        }

        if (endpoint === "/api/v3/account") {
          return new Response(
            JSON.stringify({
              balances: [{ asset: "USDT", free: "600", locked: "0" }],
            }),
            { status: 200 },
          );
        }

        if (endpoint === "/api/v3/ticker/price") {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (endpoint.startsWith("/fapi/")) {
          return new Response(
            JSON.stringify({
              code: -2015,
              msg: "Invalid API-key, IP, or permissions for action.",
            }),
            { status: 401, statusText: "Unauthorized" },
          );
        }

        if (endpoint === "/papi/v1/account") {
          return new Response(
            JSON.stringify({
              accountEquity: "5025.5",
              totalAvailableBalance: "3000.25",
            }),
            { status: 200 },
          );
        }

        if (endpoint === "/papi/v1/um/positionRisk") {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        return new Response(JSON.stringify({ msg: "not found" }), {
          status: 404,
        });
      },
      now: () => 1700000000000,
    });

  await buildSnapshot();
  assert.deepEqual(requestedPaths, [
    "/api/v3/time",
    "/api/v3/account",
    "/api/v3/ticker/price",
    "/fapi/v3/account",
    "/fapi/v3/positionRisk",
    "/papi/v1/account",
    "/papi/v1/um/positionRisk",
  ]);

  requestedPaths.length = 0;
  const secondSnapshot = await buildSnapshot();

  assert.equal(secondSnapshot.accountMode, "portfolioMargin");
  assert.deepEqual(requestedPaths, [
    "/api/v3/time",
    "/api/v3/account",
    "/api/v3/ticker/price",
    "/papi/v1/account",
    "/papi/v1/um/positionRisk",
  ]);
  resetBinanceHoldingRuntimeHints();
}

{
  resetBinanceHoldingRuntimeHints();
  const signedTimestamps = [];
  const snapshot = await getBinanceHoldingSnapshot({
    env: {
      BINANCE_API_KEY: "env-key",
      BINANCE_API_SECRET: "env-secret",
    },
    fetcher: async (url) => {
      const requestUrl = new URL(String(url));
      const endpoint = requestUrl.pathname;

      if (requestUrl.searchParams.has("timestamp")) {
        signedTimestamps.push(Number(requestUrl.searchParams.get("timestamp")));
      }

      if (endpoint === "/api/v3/time") {
        return new Response(JSON.stringify({ serverTime: 1699999999000 }), {
          status: 200,
        });
      }

      if (endpoint === "/api/v3/account") {
        return new Response(
          JSON.stringify({
            balances: [{ asset: "USDT", free: "600", locked: "0" }],
          }),
          { status: 200 },
        );
      }

      if (endpoint === "/api/v3/ticker/price") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (endpoint === "/fapi/v3/account") {
        return new Response(
          JSON.stringify({
            totalWalletBalance: "1000",
            totalUnrealizedProfit: "0",
            totalMarginBalance: "1000",
            availableBalance: "800",
          }),
          { status: 200 },
        );
      }

      if (endpoint === "/fapi/v3/positionRisk") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(JSON.stringify({ msg: "not found" }), {
        status: 404,
      });
    },
    now: () => 1700000000000,
  });

  assert.equal(snapshot.accountMode, "standard");
  assert.deepEqual(signedTimestamps, [
    1699999999000,
    1699999999000,
    1699999999000,
  ]);
}

console.log("ok - binance holdings normalize and sign data");
