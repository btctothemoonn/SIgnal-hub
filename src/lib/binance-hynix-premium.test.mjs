import assert from "node:assert/strict";
import {
  binanceHynixPremiumWebSocketUrl,
  buildBinanceHynixPremiumSnapshot,
  fetchBinanceHynixPremiumSnapshot,
  parseBinanceFuturesWebSocketMessage,
  parseBinanceKlinePayload,
} from "./binance-hynix-premium.ts";

const skhyKlines = parseBinanceKlinePayload(
  {
    code: "000000",
    data: [
      [1760000000000, "1", "1.11", "0.99", "1.05", "100", 1760000299999],
      [1760000300000, "1.05", "1.2", "1.02", "1.1", "120", 1760000599999],
    ],
  },
  "SKHYUSDT",
);

assert.equal(skhyKlines.length, 2);
assert.equal(skhyKlines[0].symbol, "SKHYUSDT");
assert.equal(skhyKlines[0].interval, "5m");
assert.equal(skhyKlines[0].closePrice, 1.05);
assert.equal(skhyKlines[0].openTime, 1760000000000);

const wrappedKlineInfos = parseBinanceKlinePayload(
  {
    data: {
      klineInfos: [
        [1760000600000, "1", "1.3", "1", "1.25", "60", 1760000899999],
      ],
    },
  },
  "SKHYUSDT",
);
assert.equal(wrappedKlineInfos[0].closePrice, 1.25);

const snapshot = buildBinanceHynixPremiumSnapshot({
  generatedAt: "2026-07-28T08:00:00.000Z",
  baseSymbol: "SKHYUSDT",
  benchmarkSymbol: "SKHYNIXUSDT",
  baseKlines: skhyKlines,
  benchmarkKlines: parseBinanceKlinePayload(
    [
      [1760000000000, "10", "10.2", "9.8", "10", "90", 1760000299999],
      [1760000300000, "10", "11", "9.9", "10", "110", 1760000599999],
    ],
    "SKHYNIXUSDT",
  ),
  errors: [],
});

assert.equal(snapshot.source, "live");
assert.equal(snapshot.provider, "binance-futures");
assert.equal(snapshot.interval, "5m");
assert.equal(snapshot.points.length, 2);
assert.equal(snapshot.latest?.basePrice, 1.1);
assert.equal(snapshot.latest?.benchmarkPrice, 10);
assert.equal(snapshot.latest?.premiumPct, 10);
assert.equal(
  binanceHynixPremiumWebSocketUrl({
    baseSymbol: "SKHYUSDT",
    benchmarkSymbol: "SKHYNIXUSDT",
  }),
  "wss://fstream.binance.com/public/stream?streams=skhyusdt@markPrice/skhynixusdt@markPrice/skhyusdt@kline_5m/skhynixusdt@kline_5m",
);

const requestedUrls = [];
const fetched = await fetchBinanceHynixPremiumSnapshot({
  fetchImpl: async (url) => {
    requestedUrls.push(String(url));
    const parsedUrl = new URL(String(url));
    const symbol = parsedUrl.searchParams.get("symbol");
    if (parsedUrl.pathname.endsWith("/premiumIndex")) {
      return Response.json({
        symbol,
        markPrice: symbol === "SKHYUSDT" ? "1.3" : "10",
        indexPrice: symbol === "SKHYUSDT" ? "1.29" : "10.01",
        time: 1760000300000,
      });
    }
    const close = symbol === "SKHYUSDT" ? "1.2" : "10";
    return Response.json([
      [1760000000000, "1", close, "1", close, "10", 1760000299999],
    ]);
  },
  env: {
    BINANCE_HYNIX_PREMIUM_REST_BASE_URL: "https://fapi.binance.com",
  },
  limit: 24,
});

assert.equal(fetched.source, "live");
assert.equal(fetched.provider, "binance-futures");
assert.equal(fetched.latest?.premiumPct, 30);
assert.equal(requestedUrls.length, 4);
assert.ok(
  requestedUrls.every((url) =>
    url.includes("https://fapi.binance.com/fapi/v1/"),
  ),
);
assert.equal(
  requestedUrls.filter((url) => url.includes("/fapi/v1/klines")).length,
  2,
);
assert.equal(
  requestedUrls.filter((url) => url.includes("/fapi/v1/premiumIndex")).length,
  2,
);
assert.ok(
  requestedUrls
    .filter((url) => url.includes("/fapi/v1/klines"))
    .every((url) => url.includes("interval=5m")),
);
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYUSDT")));
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYNIXUSDT")));

const parsedKlineMessage = parseBinanceFuturesWebSocketMessage({
  stream: "skhyusdt@kline_5m",
  data: {
    e: "kline",
    E: 1760000310000,
    s: "SKHYUSDT",
    k: {
      t: 1760000300000,
      T: 1760000599999,
      s: "SKHYUSDT",
      i: "5m",
      o: "1.2",
      h: "1.4",
      l: "1.1",
      c: "1.3",
      v: "20",
      x: false,
    },
  },
});
assert.equal(parsedKlineMessage?.type, "kline");
assert.equal(parsedKlineMessage?.point.closePrice, 1.3);
assert.equal(parsedKlineMessage?.closed, false);

const parsedMarkMessage = parseBinanceFuturesWebSocketMessage(
  JSON.stringify({
    stream: "skhynixusdt@markPrice",
    data: {
      e: "markPriceUpdate",
      E: 1760000310000,
      s: "SKHYNIXUSDT",
      p: "10.2",
      i: "10.1",
    },
  }),
);
assert.equal(parsedMarkMessage?.type, "markPrice");
assert.equal(parsedMarkMessage?.symbol, "SKHYNIXUSDT");
assert.equal(parsedMarkMessage?.markPrice, 10.2);

console.log("ok - binance hynix premium");
