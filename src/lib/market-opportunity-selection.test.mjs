import assert from "node:assert/strict";

const {
  buildMarketOpportunityFingerprint,
  transitionMarketOpportunityCandidates,
} = await import("./market-opportunity-selection.ts");

const start = Date.parse("2026-09-04T02:00:00.000Z");

function decision(symbol, score, overrides = {}) {
  const observedAt = new Date(overrides.observedAtMs ?? start).toISOString();
  return {
    symbol,
    model: "capital_long",
    direction: "LONG",
    stage: score >= 80 ? "拉盘做多确认" : "疑似资金推动",
    decision: score >= 80 ? "关注做多" : "等待确认",
    score,
    confidence: score,
    evidence: ["5m 动量转强", "OI 随价格扩张"],
    confirmations: ["等待回踩不破"],
    invalidations: ["跌破启动结构"],
    risks: [],
    mandatoryComplete: true,
    hardInvalidated: false,
    dataCoverage: 100,
    metrics: {
      symbol,
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
      ...overrides.metrics,
    },
    observedAt,
    expiresAt: new Date((overrides.observedAtMs ?? start) + 12 * 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function selectedState(symbol, score, rank, overrides = {}) {
  const value = decision(symbol, score, overrides.decision);
  return {
    symbol,
    decision: value,
    entryStreak: 2,
    exitStreak: 0,
    enteredAt: new Date(start - 10 * 60_000).toISOString(),
    lastQualifiedAt: new Date(start - 60_000).toISOString(),
    lastConfirmedAt: new Date(start - 60_000).toISOString(),
    selected: true,
    rank,
    updatedAt: new Date(start - 60_000).toISOString(),
    ...overrides,
  };
}

let transition = transitionMarketOpportunityCandidates(
  [],
  [decision("AAAUSDT", 82)],
  start,
);
assert.equal(transition.selected.length, 0, "one qualifying scan must not enter Top 5");
transition = transitionMarketOpportunityCandidates(
  transition.states,
  [decision("AAAUSDT", 83, { observedAtMs: start + 60_000 })],
  start + 60_000,
);
assert.deepEqual(transition.selected.map((item) => item.symbol), ["AAAUSDT"]);

transition = transitionMarketOpportunityCandidates(
  transition.states,
  [decision("AAAUSDT", 55)],
  start + 120_000,
);
assert.equal(transition.selected.length, 1);
transition = transitionMarketOpportunityCandidates(
  transition.states,
  [decision("AAAUSDT", 54)],
  start + 180_000,
);
assert.equal(transition.selected.length, 1);
transition = transitionMarketOpportunityCandidates(
  transition.states,
  [decision("AAAUSDT", 53)],
  start + 240_000,
);
assert.equal(transition.selected.length, 0, "three sub-60 scans must remove the candidate");

const invalidated = transitionMarketOpportunityCandidates(
  [selectedState("AAAUSDT", 88, 1)],
  [decision("AAAUSDT", 88, { hardInvalidated: true })],
  start,
);
assert.equal(invalidated.selected.length, 0, "hard invalidation must remove immediately");

const seededFive = [
  selectedState("AUSDT", 96, 1),
  selectedState("BUSDT", 92, 2),
  selectedState("CUSDT", 89, 3),
  selectedState("DUSDT", 87, 4),
  selectedState("EUSDT", 84, 5),
  {
    ...selectedState("NEWUSDT", 88, null),
    selected: false,
    entryStreak: 1,
    enteredAt: null,
  },
];
const noGap = transitionMarketOpportunityCandidates(
  seededFive,
  seededFive.map((state) => decision(state.symbol, state.symbol === "NEWUSDT" ? 88 : state.decision.score)),
  start,
);
assert.ok(!noGap.selected.some((item) => item.symbol === "NEWUSDT"));
const withGap = transitionMarketOpportunityCandidates(
  seededFive,
  seededFive.map((state) => decision(state.symbol, state.symbol === "NEWUSDT" ? 90 : state.decision.score)),
  start,
);
assert.ok(withGap.selected.some((item) => item.symbol === "NEWUSDT"));
assert.equal(withGap.selected.length, 5);

const duplicated = transitionMarketOpportunityCandidates(
  [],
  [decision("DUPUSDT", 81), decision("DUPUSDT", 91, { model: "short_squeeze", stage: "轧空启动" })],
  start,
);
assert.equal(duplicated.states.filter((item) => item.symbol === "DUPUSDT").length, 1);
assert.equal(duplicated.states[0].decision.model, "short_squeeze");

const staleConfirmation = transitionMarketOpportunityCandidates(
  [selectedState("OLDUSDT", 86, 1, {
    lastConfirmedAt: new Date(start - 2 * 60 * 60_000 - 1).toISOString(),
  })],
  [decision("OLDUSDT", 76, {
    decision: "等待确认",
    stage: "疑似资金推动",
    metrics: { stale: true },
  })],
  start,
);
assert.equal(staleConfirmation.selected[0].decision, "等待确认");
assert.ok(staleConfirmation.selected[0].risks.some((item) => item.includes("确认已超过 2 小时")));

const expired = transitionMarketOpportunityCandidates(
  [selectedState("EXPIREDUSDT", 90, 1, {
    enteredAt: new Date(start - 12 * 60 * 60_000 - 1).toISOString(),
  })],
  [decision("EXPIREDUSDT", 92)],
  start,
);
assert.equal(expired.selected.length, 0, "a candidate cannot occupy a slot beyond twelve hours");

const fingerprintA = buildMarketOpportunityFingerprint([
  decision("AAAUSDT", 84, {
    metrics: { oiGrowth15m: 8.2, funding: 0.0001, takerBuySellRatio: 1.34, pct15m: 6.4 },
  }),
]);
const fingerprintB = buildMarketOpportunityFingerprint([
  decision("AAAUSDT", 87, {
    metrics: { oiGrowth15m: 9.1, funding: 0.00012, takerBuySellRatio: 1.31, pct15m: 7.1 },
  }),
]);
const fingerprintChanged = buildMarketOpportunityFingerprint([
  decision("AAAUSDT", 87, {
    direction: "SHORT",
    decision: "关注做空",
    stage: "做空结构确认",
  }),
]);
assert.equal(fingerprintA, fingerprintB, "small metric noise in the same bands must reuse AI output");
assert.notEqual(fingerprintA, fingerprintChanged);

console.log("ok - market opportunity Top 5 remains stable across scans");
