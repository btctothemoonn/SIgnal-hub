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

function completedWatchCandles(count = 30, latestCloseAt = nowMs - 1) {
  return Array.from({ length: count }, (_, index) => {
    const closeTime = latestCloseAt - (count - 1 - index) * 300_000;
    const price = 100 + index;
    return [closeTime - 299_999, String(price), String(price * 1.001),
      String(price * 0.999), String(price), index >= count - 3 ? "30" : "10",
      closeTime, String(price * 10)];
  });
}

function watchMetrics(futuresRows, options = {}) {
  return deriveOpportunityMetrics({
    seed: seed(), futures5m: futuresRows, futures1m: [], spot5m: null,
    premium: null, openInterest: [], globalLongShortRatio: null,
    topTraderLongShortRatio: null, takerBuySellRatio: null,
    observedAt: new Date(nowMs).toISOString(), ...options,
  });
}

const closedWatchCandles = completedWatchCandles();
const incompleteWatchCandle = [nowMs, "129", "999", "1", "999", "0.001", nowMs + 299_999, "0.1"];
const watchInputs = [...closedWatchCandles, incompleteWatchCandle];
const watchInputsBefore = structuredClone(watchInputs);
const closedOnly = watchMetrics(closedWatchCandles);
const withIncomplete = watchMetrics(watchInputs);
assert.ok(withIncomplete.watchlist, "watchlist context is derived from completed candles");
assert.deepEqual(withIncomplete.watchlist, closedOnly.watchlist,
  "an incomplete tiny-volume candle cannot cool the watchlist context or change price structure");
assert.equal(withIncomplete.watchlist.volumeRatio5m, 3,
  "three completed five-minute volumes are compared with the preceding 24 completed volumes");
assert.equal(withIncomplete.watchlist.candleClosedAt, new Date(nowMs - 1).toISOString());
assert.ok(Math.abs(withIncomplete.watchlist.pct5m - ((129 / 128 - 1) * 100)) < 1e-9);
assert.ok(Math.abs(withIncomplete.watchlist.pct15m - ((129 / 126 - 1) * 100)) < 1e-9);
assert.ok(Math.abs(withIncomplete.watchlist.pct1h - ((129 / 117 - 1) * 100)) < 1e-9);
assert.equal(withIncomplete.watchlist.breakout20, true);
assert.equal(withIncomplete.watchlist.supportBreak, false);
assert.equal(withIncomplete.watchlist.lowerStructure, false);
assert.equal(withIncomplete.watchlist.distanceFromHighPct, null,
  "a short sample cannot claim a distance from the near-24-hour high");
assert.equal(withIncomplete.watchlist.distanceFromLowPct, null);
assert.deepEqual(watchInputs, watchInputsBefore, "deriving context does not mutate input arrays");
assert.notEqual(withIncomplete.pct5m, closedOnly.pct5m,
  "legacy opportunity metrics retain their existing intrabar semantics");

const seededWatch = watchMetrics(watchInputs, {
  seed: seed("TESTUSDT", { squeezeMetrics: { priceChange15m: 99, volRatio: 99, breakout20: false } }),
});
assert.deepEqual(seededWatch.watchlist, withIncomplete.watchlist,
  "old squeeze-trigger data never overrides completed-candle context");
assert.equal(seededWatch.pct15m, 99, "existing squeeze metrics stay backward compatible");
assert.equal(seededWatch.volumeRatio5m, 99);

const invalidTimeRows = [
  [nowMs - 299_999, "1", "1", "1", "1", "0.001", "invalid", "1"],
  ["invalid", "1", "1", "1", "1", "0.001", nowMs - 1, "1"],
  [nowMs + 1, "1", "1", "1", "1", "0.001", nowMs - 1, "1"],
];
assert.deepEqual(watchMetrics([...closedWatchCandles, ...invalidTimeRows]).watchlist, closedOnly.watchlist,
  "invalid and future candle times cannot enter the context");
assert.equal(watchMetrics([incompleteWatchCandle, ...invalidTimeRows]).watchlist, undefined,
  "without any valid completed candle there is no timestamped watchlist context");
assert.equal(watchMetrics(closedWatchCandles, { observedAt: "invalid" }).watchlist, undefined);
assert.equal(watchMetrics(completedWatchCandles(30, nowMs)).watchlist.candleClosedAt, new Date(nowMs).toISOString(),
  "a candle closing exactly at the observation time is complete");

const shortWatch = watchMetrics(completedWatchCandles(1)).watchlist;
assert.equal(shortWatch.pct5m, null);
assert.equal(shortWatch.pct15m, null);
assert.equal(shortWatch.pct1h, null);
assert.equal(shortWatch.volumeRatio5m, null);
assert.equal(shortWatch.breakout20, false);
assert.equal(shortWatch.supportBreak, false);
assert.equal(shortWatch.lowerStructure, false);
assert.equal(watchMetrics(completedWatchCandles(26)).watchlist.volumeRatio5m, null,
  "volume context requires all three recent and 24 baseline samples");
const missingVolume = structuredClone(closedWatchCandles);
missingVolume[15][5] = null;
assert.equal(watchMetrics(missingVolume).watchlist.volumeRatio5m, null,
  "a partial volume sample must not be treated as a complete baseline");
const missingClose = structuredClone(closedWatchCandles);
missingClose.at(-1)[4] = null;
assert.equal(watchMetrics(missingClose).watchlist.pct5m, null,
  "missing prices do not fall back to the alert-trigger price");

const oldCloseAt = nowMs - 45 * 60_000;
assert.equal(watchMetrics(completedWatchCandles(30, oldCloseAt)).watchlist.candleClosedAt,
  new Date(oldCloseAt).toISOString(), "old completed candles keep their real age for freshness checks");
const spotCompleted = completedWatchCandles(30);
const spotWatch = watchMetrics(watchInputs, { spot5m: [...spotCompleted, incompleteWatchCandle] }).watchlist;
assert.ok(Math.abs(spotWatch.spotChange15m - ((129 / 126 - 1) * 100)) < 1e-9,
  "spot confirmation also uses completed candles");
assert.equal(withIncomplete.watchlist.spotChange15m, null);
assert.equal(watchMetrics(watchInputs, { spot5m: [incompleteWatchCandle] }).watchlist.spotChange15m, null);
assert.equal(watchMetrics(watchInputs, { spot5m: completedWatchCandles(30, nowMs - 300_001) }).watchlist.spotChange15m,
  null, "an older spot interval cannot confirm the latest futures interval");
const stringTimeSpot = spotCompleted.map((row) => row.map((value, index) => index === 0 || index === 6 ? String(value) : value));
assert.equal(watchMetrics(watchInputs, { spot5m: stringTimeSpot }).watchlist.spotChange15m,
  spotWatch.spotChange15m, "equivalent numeric timestamp encodings refer to the same candle interval");
const gappedCandles = closedWatchCandles.filter((_, index) => index !== closedWatchCandles.length - 2);
assert.equal(watchMetrics(gappedCandles).watchlist.pct5m, null,
  "a missing interval must not relabel a ten-minute move as a five-minute move");
assert.equal(watchMetrics(gappedCandles).watchlist.pct15m, null);
assert.equal(watchMetrics(gappedCandles).watchlist.pct1h, null);
assert.equal(watchMetrics(gappedCandles).watchlist.volumeRatio5m, null);
const decliningCandles = closedWatchCandles.map((row, index) => {
  const price = 130 - index;
  return [row[0], String(price), String(price * 1.001), String(price * 0.999), String(price), row[5], row[6], row[7]];
});
const decliningWatch = watchMetrics(decliningCandles).watchlist;
assert.ok(decliningWatch.pct1h < 0);
assert.equal(decliningWatch.supportBreak, true);
assert.equal(decliningWatch.lowerStructure, true);
assert.equal(decliningWatch.breakout20, false);

const nearlyDailyCandles = completedWatchCandles(276);
const nearlyDailyWatch = watchMetrics(nearlyDailyCandles).watchlist;
assert.ok(Math.abs(nearlyDailyWatch.distanceFromHighPct - ((375 / 375.375 - 1) * 100)) < 1e-9);
assert.ok(Math.abs(nearlyDailyWatch.distanceFromLowPct - ((375 / 99.9 - 1) * 100)) < 1e-9);
const insufficientDaily = watchMetrics(completedWatchCandles(275)).watchlist;
assert.equal(insufficientDaily.distanceFromHighPct, null);
assert.equal(insufficientDaily.distanceFromLowPct, null);
const fullDaily = completedWatchCandles(288);
const dailyGap = fullDaily.filter((_, index) => index !== 20);
assert.equal(watchMetrics(dailyGap).watchlist.distanceFromHighPct, null,
  "enough rows with a missing interval still do not form a complete history");
assert.equal(watchMetrics(dailyGap).watchlist.distanceFromLowPct, null);
for (const invalid of [null, "invalid", "0", "-1"]) {
  const missingHigh = structuredClone(nearlyDailyCandles);
  missingHigh[15][2] = invalid;
  assert.equal(watchMetrics(missingHigh).watchlist.distanceFromHighPct, null,
    "the entire high window must contain valid positive prices");
  const missingLow = structuredClone(nearlyDailyCandles);
  missingLow[15][3] = invalid;
  assert.equal(watchMetrics(missingLow).watchlist.distanceFromLowPct, null);
  const invalidLatest = structuredClone(nearlyDailyCandles);
  invalidLatest.at(-1)[4] = invalid;
  const invalidLatestWatch = watchMetrics(invalidLatest).watchlist;
  assert.equal(invalidLatestWatch.distanceFromHighPct, null);
  assert.equal(invalidLatestWatch.distanceFromLowPct, null);
}

console.log("ok - watchlist context uses completed candles without replacing opportunity metrics");

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
