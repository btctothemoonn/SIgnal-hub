import assert from "node:assert/strict";
import {
  buildBinanceHynixPremiumSnapshot,
  fetchBinanceHynixPremiumSnapshot,
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
assert.equal(snapshot.provider, "binance-alpha");
assert.equal(snapshot.interval, "5m");
assert.equal(snapshot.points.length, 2);
assert.equal(snapshot.latest?.basePrice, 1.1);
assert.equal(snapshot.latest?.benchmarkPrice, 10);
assert.equal(snapshot.latest?.premiumPct, 10);

const requestedUrls = [];
const fetched = await fetchBinanceHynixPremiumSnapshot({
  fetchImpl: async (url) => {
    requestedUrls.push(String(url));
    const symbol = new URL(String(url)).searchParams.get("symbol");
    const close = symbol === "SKHYUSDT" ? "1.2" : "10";
    return Response.json({
      code: "000000",
      data: [[1760000000000, "1", close, "1", close, "10", 1760000299999]],
    });
  },
  env: {
    BINANCE_HYNIX_PREMIUM_BASE_URL: "https://www.binance.com",
  },
  limit: 24,
});

assert.equal(fetched.source, "live");
assert.equal(fetched.points[0].premiumPct, 20);
assert.equal(requestedUrls.length, 2);
assert.ok(
  requestedUrls.every((url) =>
    url.includes("/bapi/defi/v1/public/alpha-trade/klines"),
  ),
);
assert.ok(requestedUrls.every((url) => url.includes("interval=5m")));
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYUSDT")));
assert.ok(requestedUrls.some((url) => url.includes("symbol=SKHYNIXUSDT")));

console.log("ok - binance hynix premium");
