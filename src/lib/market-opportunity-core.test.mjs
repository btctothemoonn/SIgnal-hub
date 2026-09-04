import assert from "node:assert/strict";

const {
  chooseMarketOpportunityDecision,
  scoreCapitalDrivenLong,
  scoreDistributionShort,
  scoreSqueezeLong,
} = await import("./market-opportunity-core.ts");

const observedAt = "2026-09-04T01:00:00.000Z";

function metrics(overrides = {}) {
  return {
    symbol: "TESTUSDT",
    observedAt,
    stale: false,
    pct1m: 1.2,
    pct5m: 3.2,
    pct15m: 6.4,
    pct1h: 11.5,
    pct24h: 18,
    volumeRatio1m: 2.2,
    volumeRatio5m: 2.8,
    oiGrowth15m: 8.2,
    oiNotional: 8_000_000,
    funding: 0.0001,
    basis: -0.0002,
    globalLongShortRatio: 1.02,
    topTraderLongShortRatio: 1.04,
    takerBuySellRatio: 1.34,
    spotAvailable: true,
    spotChange15m: 5.8,
    spotVolumeRatio5m: 2.1,
    perpSpotDivergencePct: 0.6,
    distanceFromHighPct: -1.2,
    distanceFromLowPct: 16,
    priorRunUpPct: 24,
    supportBreak: false,
    lowerStructure: false,
    breakout20: true,
    quoteVolume: 80_000_000,
    marketCapUsd: 120_000_000,
    fdvUsd: 140_000_000,
    alertCounts: { pump: 3, crash: 0, squeeze: 0, total: 3 },
    ...overrides,
  };
}

const confirmedLong = scoreCapitalDrivenLong(metrics());
assert.ok(confirmedLong.score >= 80, "aligned price, volume, OI, taker, and spot must confirm momentum");
assert.equal(confirmedLong.stage, "拉盘做多确认");
assert.equal(confirmedLong.decision, "关注做多");
assert.equal(confirmedLong.mandatoryComplete, true);

const missingOi = scoreCapitalDrivenLong(metrics({ oiGrowth15m: null }));
assert.equal(missingOi.mandatoryComplete, false);
assert.equal(missingOi.decision, "等待确认");
assert.ok(missingOi.score < 80, "missing critical OI must cap actionable confidence");
assert.ok(missingOi.confirmations.some((item) => item.includes("OI")));

const staleLong = scoreCapitalDrivenLong(metrics({ stale: true }));
assert.equal(staleLong.decision, "等待确认");
assert.ok(staleLong.risks.some((item) => item.includes("过期")));

const distribution = scoreDistributionShort(
  metrics({
    pct1m: -0.8,
    pct5m: -2.5,
    pct15m: -5.2,
    pct1h: 4,
    priorRunUpPct: 35,
    distanceFromHighPct: -8,
    supportBreak: false,
    lowerStructure: true,
    takerBuySellRatio: 0.72,
    oiGrowth15m: -14,
    alertCounts: { pump: 2, crash: 1, squeeze: 0, total: 3 },
  }),
);
assert.equal(distribution.stage, "疑似高位派发");
assert.equal(distribution.decision, "等待确认");
assert.ok(distribution.risks.some((item) => item.includes("OI")));

const confirmedShort = scoreDistributionShort(
  metrics({
    pct1m: -1.4,
    pct5m: -4.2,
    pct15m: -8.4,
    pct1h: -3,
    priorRunUpPct: 42,
    distanceFromHighPct: -12,
    supportBreak: true,
    lowerStructure: true,
    takerBuySellRatio: 0.68,
    oiGrowth15m: 5,
    volumeRatio5m: 3.2,
    alertCounts: { pump: 3, crash: 2, squeeze: 0, total: 5 },
  }),
);
assert.ok(confirmedShort.score >= 80);
assert.equal(confirmedShort.stage, "做空结构确认");
assert.equal(confirmedShort.decision, "关注做空");

const singleRedCandle = scoreDistributionShort(
  metrics({
    pct1m: -5,
    pct5m: -5,
    pct15m: 7,
    pct1h: 25,
    priorRunUpPct: 40,
    distanceFromHighPct: -2,
    supportBreak: false,
    lowerStructure: false,
    takerBuySellRatio: 0.9,
    oiGrowth15m: -3,
  }),
);
assert.notEqual(singleRedCandle.decision, "关注做空");

const squeeze = scoreSqueezeLong(
  metrics({
    funding: -0.0012,
    basis: -0.002,
    oiGrowth15m: 16,
    globalLongShortRatio: 0.72,
    topTraderLongShortRatio: 0.81,
    takerBuySellRatio: 1.35,
    breakout20: true,
    alertCounts: { pump: 1, crash: 0, squeeze: 2, total: 3 },
  }),
);
assert.ok(squeeze.score >= 80);
assert.equal(squeeze.stage, "轧空启动");
assert.equal(squeeze.direction, "LONG");
assert.equal(squeeze.decision, "关注做多");

const squeezeSetup = scoreSqueezeLong(
  metrics({
    pct15m: 0.4,
    funding: -0.0007,
    basis: -0.001,
    oiGrowth15m: 5,
    globalLongShortRatio: 0.82,
    topTraderLongShortRatio: 0.88,
    takerBuySellRatio: 1.02,
    volumeRatio5m: 1.1,
    breakout20: false,
    alertCounts: { pump: 0, crash: 0, squeeze: 1, total: 1 },
  }),
);
assert.equal(squeezeSetup.stage, "轧空蓄势");
assert.equal(squeezeSetup.decision, "等待确认");

const chase = scoreCapitalDrivenLong(
  metrics({
    pct5m: 12,
    pct15m: 18,
    pct1h: 45,
    distanceFromHighPct: 0,
    funding: 0.003,
    perpSpotDivergencePct: 5.5,
  }),
);
assert.equal(chase.stage, "杠杆拉盘，谨防回撤");
assert.equal(chase.decision, "禁止追单");

const hardInvalidatedLong = scoreCapitalDrivenLong(
  metrics({ pct5m: -6, pct15m: -8, takerBuySellRatio: 0.7, supportBreak: true }),
);
assert.equal(hardInvalidatedLong.hardInvalidated, true);
assert.equal(hardInvalidatedLong.decision, "等待确认");

const chosen = chooseMarketOpportunityDecision([
  { ...confirmedLong, score: 86, stage: "疑似资金推动", decision: "等待确认" },
  { ...squeeze, score: 82 },
]);
assert.equal(chosen?.model, "short_squeeze", "confirmed squeeze beats higher unconfirmed momentum");

console.log("ok - market opportunity scoring guards actionable decisions");
