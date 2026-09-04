import assert from "node:assert/strict";

const {
  deriveOpportunityMetrics,
  enrichOpportunitySeeds,
} = await import("./market-opportunity-enrichment.ts");

const nowMs = Date.parse("2026-09-04T03:00:00.000Z");

function kline(index, close, volume = 10, intervalMs = 300_000) {
  const openTime = 1_780_000_000_000 + index * intervalMs;
  return [
    openTime,
    String(close),
    String(close * 1.001),
    String(close * 0.999),
    String(close),
    String(volume),
    openTime + intervalMs - 1,
    String(volume * close),
  ];
}

function futures5m() {
  const rows = Array.from({ length: 288 }, (_, index) => kline(index, 90, 10));
  rows[275] = kline(275, 93, 10);
  for (let index = 276; index < 284; index += 1) {
    rows[index] = kline(index, 94 + (index - 276) * 0.7, 10);
  }
  rows[284] = kline(284, 100, 30);
  rows[285] = kline(285, 102, 30);
  rows[286] = kline(286, 104, 30);
  rows[287] = kline(287, 106, 30);
  return rows;
}

function futures1m() {
  const rows = Array.from({ length: 30 }, (_, index) =>
    kline(index, 104, 10, 60_000));
  rows[29] = kline(29, 106, 25, 60_000);
  return rows;
}

function spot5m() {
  const rows = Array.from({ length: 288 }, (_, index) => kline(index, 92, 10));
  rows[284] = kline(284, 100, 25);
  rows[285] = kline(285, 101.5, 25);
  rows[286] = kline(286, 103, 25);
  rows[287] = kline(287, 105, 25);
  return rows;
}

function seed(symbol = "TESTUSDT", overrides = {}) {
  return {
    symbol,
    price: 106,
    pct24h: 18,
    quoteVolume: 80_000_000,
    marketCapUsd: 120_000_000,
    fdvUsd: 140_000_000,
    latestEventAt: "2026-09-04T02:59:00.000Z",
    maxLevel: 2,
    maxAbsChangePct: 8,
    maxVolumeRatio: 3,
    active: true,
    alertCounts: { pump: 3, crash: 0, squeeze: 0, total: 3 },
    squeezeMetrics: null,
    preliminaryScore: 75,
    ...overrides,
  };
}

const derived = deriveOpportunityMetrics({
  seed: seed(),
  futures5m: futures5m(),
  futures1m: futures1m(),
  spot5m: spot5m(),
  premium: { markPrice: "106", indexPrice: "106.2", lastFundingRate: "-0.0007" },
  openInterest: [
    { sumOpenInterest: "70000" },
    { sumOpenInterest: "73500" },
    { sumOpenInterest: "77000" },
  ],
  globalLongShortRatio: 0.82,
  topTraderLongShortRatio: 0.88,
  takerBuySellRatio: 1.3,
  observedAt: new Date(nowMs).toISOString(),
});
assert.equal(Math.round(derived.pct15m ?? 0), 6);
assert.equal(Math.round(derived.pct1h ?? 0), 14);
assert.equal(Math.round(derived.pct1m ?? 0), 2);
assert.equal(derived.breakout20, true);
assert.ok((derived.priorRunUpPct ?? 0) > 15);
assert.equal(Math.round(derived.spotChange15m ?? 0), 5);
assert.equal(Math.round(derived.perpSpotDivergencePct ?? 0), 1);
assert.equal(Math.round(derived.oiGrowth15m ?? 0), 10);
assert.equal(Math.round(derived.oiNotional ?? 0), 8_162_000);

let cacheClientCalls = 0;
const cachedMetrics = { ...derived, observedAt: new Date(nowMs - 60_000).toISOString() };
const cached = await enrichOpportunitySeeds({
  seeds: [seed()],
  getCached: () => ({
    symbol: "TESTUSDT",
    metrics: cachedMetrics,
    fetchedAt: new Date(nowMs - 60_000).toISOString(),
    stale: false,
    error: null,
    updatedAt: new Date(nowMs - 60_000).toISOString(),
  }),
  client: new Proxy({}, {
    get() {
      cacheClientCalls += 1;
      return async () => { throw new Error("network must not run for fresh cache"); };
    },
  }),
  nowMs,
});
assert.equal(cached[0].source, "cache");
assert.equal(cacheClientCalls, 0);

const baseClient = {
  getKlines: async (_symbol, interval) => interval === "1m" ? futures1m() : futures5m(),
  getPremiumIndex: async () => [
    { symbol: "TESTUSDT", markPrice: "106", indexPrice: "106.2", lastFundingRate: "-0.0007" },
  ],
  getOpenInterestHistory: async () => [
    { sumOpenInterest: "70000" },
    { sumOpenInterest: "77000" },
  ],
  getGlobalLongShortRatio: async () => 0.82,
  getTopTraderPositionRatio: async () => 0.88,
  getTakerBuySellRatio: async () => 1.3,
  getSpotContext: async () => null,
};
const noSpot = await enrichOpportunitySeeds({
  seeds: [seed()],
  getCached: () => null,
  client: baseClient,
  nowMs,
});
assert.equal(noSpot[0].source, "network");
assert.equal(noSpot[0].metrics.spotAvailable, false);
assert.equal(noSpot[0].stale, false);

const reusedCalls = { premium: 0, oi: 0, global: 0, top: 0, taker: 0 };
const reused = await enrichOpportunitySeeds({
  seeds: [seed("REUSEUSDT", {
    squeezeMetrics: {
      funding: -0.0012,
      basis: -0.002,
      oiGrowth15m: 16,
      oiNotional: 8_000_000,
      priceChange15m: 2.4,
      volRatio: 2.8,
      breakout20: true,
      globalLongShortRatio: 0.72,
      topTraderLongShortRatio: 0.81,
      takerBuySellRatio: 1.35,
    },
  })],
  getCached: () => null,
  client: {
    ...baseClient,
    getPremiumIndex: async () => { reusedCalls.premium += 1; return []; },
    getOpenInterestHistory: async () => { reusedCalls.oi += 1; return []; },
    getGlobalLongShortRatio: async () => { reusedCalls.global += 1; return null; },
    getTopTraderPositionRatio: async () => { reusedCalls.top += 1; return null; },
    getTakerBuySellRatio: async () => { reusedCalls.taker += 1; return null; },
  },
  nowMs,
});
assert.equal(reused[0].metrics.funding, -0.0012);
assert.deepEqual(reusedCalls, { premium: 0, oi: 0, global: 0, top: 0, taker: 0 });

const limitedSymbols = new Set();
await enrichOpportunitySeeds({
  seeds: Array.from({ length: 13 }, (_, index) => seed(`T${index}USDT`)),
  getCached: () => null,
  client: {
    ...baseClient,
    getKlines: async (symbol, interval) => {
      limitedSymbols.add(symbol);
      return interval === "1m" ? futures1m() : futures5m();
    },
  },
  nowMs,
});
assert.equal(limitedSymbols.size, 12, "network enrichment must be bounded to twelve symbols");
assert.ok(!limitedSymbols.has("T12USDT"));

const staleFallback = await enrichOpportunitySeeds({
  seeds: [seed()],
  getCached: () => ({
    symbol: "TESTUSDT",
    metrics: cachedMetrics,
    fetchedAt: new Date(nowMs - 10 * 60_000).toISOString(),
    stale: false,
    error: null,
    updatedAt: new Date(nowMs - 10 * 60_000).toISOString(),
  }),
  client: {
    ...baseClient,
    getKlines: async () => { throw new Error("Binance timeout"); },
  },
  nowMs,
});
assert.equal(staleFallback[0].source, "stale-cache");
assert.equal(staleFallback[0].stale, true);
assert.equal(staleFallback[0].metrics.stale, true);
assert.match(staleFallback[0].error ?? "", /timeout/i);

console.log("ok - market opportunity enrichment is bounded and cache first");
