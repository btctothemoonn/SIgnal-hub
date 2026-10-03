import { scoreCapitalDrivenLong } from "./market-opportunity-core.ts";

export const pushNowMs = Date.parse("2026-10-02T02:00:00.000Z");
export const pushNow = new Date(pushNowMs).toISOString();
export const pushCandleWindow = { openAt: pushNow, closeAt: new Date(pushNowMs + 299999).toISOString(), intervalMs: 300000, contiguous: true };
export function opportunityMetrics(overrides = {}) {
  return {
    symbol: "TESTUSDT", observedAt: pushNow, stale: false,
    pushEvidence: { sourceTimes: { futures5m: pushNow, futures1m: pushNow, funding: pushNow, oiGrowth15m: pushNow }, candles: [pushCandleWindow, { ...pushCandleWindow, intervalMs: 60000, closeAt: new Date(pushNowMs + 59999).toISOString() }] },
    pct1m: 1.2, pct5m: 3.2, pct15m: 6.4, pct1h: 11.5, pct24h: 18,
    volumeRatio1m: 2.2, volumeRatio5m: 2.8, oiGrowth15m: 8.2, oiNotional: 8_000_000,
    funding: 0.0001, basis: -0.0002, globalLongShortRatio: 1.02,
    topTraderLongShortRatio: 1.04, takerBuySellRatio: 1.34,
    spotAvailable: true, spotChange15m: 5.8, spotVolumeRatio5m: 2.1,
    perpSpotDivergencePct: 0.6, distanceFromHighPct: -1.2, distanceFromLowPct: 16,
    priorRunUpPct: 24, supportBreak: false, lowerStructure: false, breakout20: true,
    quoteVolume: 80_000_000, marketCapUsd: 120_000_000, fdvUsd: 140_000_000,
    alertCounts: { pump: 3, crash: 0, squeeze: 0, total: 3 }, ...overrides,
  };
}
export function opportunityDecision(metricOverrides = {}, decisionOverrides = {}) {
  return { ...scoreCapitalDrivenLong(opportunityMetrics(metricOverrides)), ...decisionOverrides };
}
export function squeezeMetrics(overrides = {}) {
  return {
    funding: -0.0012, basis: -0.002, oiGrowth15m: 16, oiNotional: 8_000_000,
    priceChange15m: 2.4, volRatio: 2.8, breakout20: true,
    globalLongShortRatio: 0.72, topTraderLongShortRatio: 0.81, takerBuySellRatio: 1.35,
    ...overrides,
  };
}
