import assert from "node:assert/strict";

let cacheModule = null;
try {
  cacheModule = await import("./binance-hynix-premium-browser-cache.ts");
} catch {
  // The first TDD run proves this module is required.
}

assert.ok(cacheModule, "compact Hynix premium browser cache module should exist");

const {
  compactBinanceHynixPremiumSnapshot,
  restoreBinanceHynixPremiumSnapshot,
} = cacheModule;

function buildPoint(index) {
  const openTime = 1_780_000_000_000 + index * 60_000;
  return {
    openTime,
    closeTime: openTime + 59_999,
    capturedAt: new Date(openTime + 42_000).toISOString(),
    baseSymbol: "SKHYUSDT",
    benchmarkSymbol: "SKHYNIXUSDT",
    basePrice: 120 + index / 100,
    baseOpenPrice: 119 + index / 100,
    baseHighPrice: 121 + index / 100,
    baseLowPrice: 118 + index / 100,
    baseClosePrice: 120 + index / 100,
    benchmarkPrice: 900 + index / 10,
    benchmarkOpenPrice: 899 + index / 10,
    benchmarkHighPrice: 902 + index / 10,
    benchmarkLowPrice: 897 + index / 10,
    benchmarkClosePrice: 900 + index / 10,
    premiumPct: 33 + index / 1000,
    premiumOpenPct: 32 + index / 1000,
    premiumHighPct: 34 + index / 1000,
    premiumLowPct: 31 + index / 1000,
    premiumClosePct: 33 + index / 1000,
    volume: 1000 + index,
  };
}

function buildSnapshot(pointCount = 2) {
  const points = Array.from({ length: pointCount }, (_, index) =>
    buildPoint(index),
  );
  return {
    generatedAt: "2026-09-05T02:00:00.000Z",
    source: "live",
    provider: "binance-futures",
    interval: "1m",
    symbols: {
      base: "SKHYUSDT",
      benchmark: "SKHYNIXUSDT",
    },
    websocket: {
      url: "wss://fstream.binance.com/stream",
      streams: ["skhyusdt@kline_1m", "skhynixusdt@kline_1m"],
    },
    points,
    latest: points.at(-1) ?? null,
    errors: [],
  };
}

const snapshot = buildSnapshot();
const compact = compactBinanceHynixPremiumSnapshot(snapshot);

assert.equal(compact.v, 1);
assert.deepEqual(restoreBinanceHynixPremiumSnapshot(compact), snapshot);
assert.deepEqual(restoreBinanceHynixPremiumSnapshot(snapshot), snapshot);
assert.equal(restoreBinanceHynixPremiumSnapshot({ nope: true }), null);

const largeSnapshot = buildSnapshot(1000);
const fullLength = JSON.stringify(largeSnapshot).length;
const compactLength = JSON.stringify(
  compactBinanceHynixPremiumSnapshot(largeSnapshot),
).length;
assert.ok(
  compactLength < fullLength * 0.55,
  `compact cache should be less than 55% of full JSON (${compactLength}/${fullLength})`,
);

console.log("ok - binance hynix premium browser cache");
