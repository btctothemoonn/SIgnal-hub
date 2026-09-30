import assert from "node:assert/strict";
import test from "node:test";
import { deriveOpportunityMetrics, enrichOpportunitySeeds } from "./market-opportunity-enrichment.ts";
import { scoreSqueezeLong } from "./market-opportunity-core.ts";

const nowMs = Date.parse("2026-09-30T02:00:00Z");
const seed = {
  symbol: "TESTUSDT", price: 100, pct24h: 0, quoteVolume: 1e8,
  marketCapUsd: null, fdvUsd: null, latestEventAt: new Date(nowMs - 90 * 60_000).toISOString(),
  maxLevel: 2, maxAbsChangePct: 10, maxVolumeRatio: 3, active: false,
  alertCounts: { pump: 0, crash: 0, squeeze: 1, total: 1 }, preliminaryScore: 90,
  squeezeMetrics: { funding: -0.002, basis: -0.02, oiGrowth15m: 20, oiNotional: 1e7,
    globalLongShortRatio: 0.5, topTraderLongShortRatio: 0.5, takerBuySellRatio: 1.5,
    volRatio: 3, priceChange15m: 5, breakout20: true },
};
const rows = Array.from({ length: 288 }, (_, i) => {
  const price = 200 - i * 0.5;
  const open = nowMs - (288 - i) * 300_000;
  return [open, String(price), String(price + 0.1), String(price - 0.1), String(price), "10", open + 299_999];
});
const oiRows = [100, 110, 110, 110, 110].map((v, i) => ({
  timestamp: nowMs - (4 - i) * 300_000, sumOpenInterest: String(v), sumOpenInterestValue: String(v * 100),
}));
function metrics(overrides = {}) {
  return deriveOpportunityMetrics({ seed, futures5m: rows, futures1m: rows, spot5m: null,
    premium: { lastFundingRate: "0.001", markPrice: "56.5", indexPrice: "56.5" },
    openInterest: oiRows, globalLongShortRatio: 1.5, topTraderLongShortRatio: 1.5,
    takerBuySellRatio: 0.5, observedAt: new Date(nowMs).toISOString(), ...overrides });
}
const client = {
  getKlines: async () => rows,
  getPremiumIndex: async () => [{ symbol: seed.symbol, lastFundingRate: "0.001", markPrice: "56.5", indexPrice: "56.5" }],
  getOpenInterestHistory: async () => oiRows,
  getGlobalLongShortRatio: async () => 1.5,
  getTopTraderPositionRatio: async () => 1.5,
  getTakerBuySellRatio: async () => 0.5,
  getSpotContext: async () => null,
};

test("an old squeeze alert cannot override current declining prices and positive funding", async () => {
  const [result] = await enrichOpportunitySeeds({ seeds: [seed], client, getCached: () => null, nowMs });
  assert.equal(result.metrics.funding, 0.001);
  assert.ok(result.metrics.pct15m < 0);
  assert.equal(result.metrics.breakout20, false);
  assert.notEqual(scoreSqueezeLong(result.metrics).decision, "关注做多");
});
test("failed current funding does not silently fall back to an old negative rate", async () => {
  const [result] = await enrichOpportunitySeeds({ seeds: [seed], client: { ...client,
    getPremiumIndex: async () => { throw new Error("funding unavailable"); } }, getCached: () => null, nowMs });
  assert.equal(result.metrics.funding, null);
  assert.equal(scoreSqueezeLong(result.metrics).mandatoryComplete, false);
});
test("15m OI uses the sample exactly fifteen minutes before the latest sample", () => {
  const result = metrics({ seed: { ...seed, squeezeMetrics: null } });
  assert.equal(result.oiGrowth15m, 0);
  assert.equal(result.oiNotional, 11_000);
});
test("OI growth is unavailable when the fifteen-minute sample is missing", () => {
  const result = metrics({ seed: { ...seed, squeezeMetrics: null }, openInterest: oiRows.filter((_, i) => i !== 1) });
  assert.equal(result.oiGrowth15m, null);
});
test("old OI samples cannot confirm current market conditions", () => {
  const result = metrics({ seed: { ...seed, squeezeMetrics: null },
    openInterest: oiRows.map(row => ({ ...row, timestamp: row.timestamp - 30 * 60_000 })) });
  assert.equal(result.oiGrowth15m, null);
});
test("a legacy cached enrichment is refreshed rather than relabeled as current", async () => {
  const legacy = { ...metrics(), funding: -0.002 };
  delete legacy.enrichmentVersion;
  const [result] = await enrichOpportunitySeeds({ seeds: [seed], client, nowMs,
    getCached: () => ({ metrics: legacy, fetchedAt: new Date(nowMs - 60_000).toISOString(), stale: false, error: null }) });
  assert.equal(result.metrics.funding, 0.001);
  assert.equal(result.source, "network");
});
