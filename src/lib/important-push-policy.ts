import { createHash } from "node:crypto";
import { scoreShortSqueeze, squeezeRecoveryDecision } from "./market-alerts-core.ts";
import type { SqueezeMetrics } from "./market-alerts-core.ts";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";
import type { MarketOpportunityDecision } from "./market-opportunity-core.ts";
import type { MarketPushObservation, MarketPushStage, PushEpisodeState, PushEvent } from "./important-push-types.ts";
import { isCurrentPushCandle, type PushCandleWindow } from "./market-push-freshness.ts";

export const IMPORTANT_PUSH_RULE_VERSION = "important-push-v1";
export const MARKET_PUSH_FRESH_MS = MARKET_OPPORTUNITY_RULES.enrichmentFreshMs;
export function isFreshPushTime(value: string, nowMs: number, maxAgeMs: number) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= nowMs && nowMs - time <= maxAgeMs;
}
export function marketPushParticipantKey(observation: Pick<MarketPushObservation, "producer" | "model">) {
  return `${observation.producer}:${observation.model}`;
}
export function qualifyOpportunity(input: {
  decision: MarketOpportunityDecision;
  enrichment: { fetchedAt: string; stale: boolean; error: string | null };
  scanId: string;
}, nowMs: number): MarketPushObservation {
  const { decision, enrichment } = input;
  const provenance = decision.metrics.pushEvidence;
  const observation: MarketPushObservation = {
    symbol: decision.symbol, direction: decision.direction, producer: "opportunity",
    model: decision.model, scanId: input.scanId, observedAt: decision.observedAt,
    fetchedAt: enrichment.fetchedAt, classification: "incomplete", stage: "confirmed",
    evidence: [...decision.evidence], opportunityDecision: decision,
  };
  if (!decision.mandatoryComplete || decision.metrics.stale || enrichment.stale || enrichment.error ||
      !provenance || !Object.keys(provenance.sourceTimes).length || provenance.candles.length < 2 ||
      !Object.values(provenance.sourceTimes).every(time => typeof time === 'string' && isFreshPushTime(time, nowMs, MARKET_PUSH_FRESH_MS)) ||
      !provenance.candles.every(candle => isCurrentPushCandle(candle, nowMs, MARKET_PUSH_FRESH_MS)) ||
      !isFreshPushTime(decision.observedAt, nowMs, MARKET_PUSH_FRESH_MS) ||
      !isFreshPushTime(decision.metrics.observedAt, nowMs, MARKET_PUSH_FRESH_MS) ||
      !isFreshPushTime(enrichment.fetchedAt, nowMs, MARKET_PUSH_FRESH_MS) ||
      !(Date.parse(decision.expiresAt) > nowMs)) return observation;
  if (decision.hardInvalidated) observation.classification = "invalidated";
  else if (Number.isFinite(decision.score) && decision.score >= MARKET_OPPORTUNITY_RULES.actionableScore &&
      Number.isFinite(decision.confidence) && decision.confidence >= 80 &&
      (decision.decision === "关注做多" || decision.decision === "关注做空")) observation.classification = "qualified";
  else observation.classification = "complete_unqualified";
  return observation;
}
export function qualifySqueezeRecovery(input: {
  symbol: string; funding: number | null; oiGrowth15m: number | null;
  observedAt: string; fetchedAt: string; sampleId: string; scanId: string;
}, nowMs: number): MarketPushObservation {
  const observation: MarketPushObservation = {
    symbol: input.symbol, direction: "LONG", producer: "squeeze", model: "short_squeeze",
    scanId: input.scanId, observedAt: input.observedAt, fetchedAt: input.fetchedAt,
    classification: "incomplete", stage: "squeeze_acceleration", evidence: [],
  };
  if (typeof input.funding !== "number" || typeof input.oiGrowth15m !== "number" ||
      !Number.isFinite(input.funding) || !Number.isFinite(input.oiGrowth15m) || !input.sampleId ||
      !isFreshPushTime(input.observedAt, nowMs, MARKET_PUSH_FRESH_MS) ||
      !isFreshPushTime(input.fetchedAt, nowMs, MARKET_PUSH_FRESH_MS)) return observation;
  observation.classification = "recovery_observation";
  observation.recoveryEvidence = { funding: input.funding, oiGrowth15m: input.oiGrowth15m,
    sampleId: input.sampleId, recovered: squeezeRecoveryDecision(input) === true, observedAt: input.observedAt, fetchedAt: input.fetchedAt };
  return observation;
}
export function qualifySqueeze(input: {
  symbol: string; metrics: SqueezeMetrics; minOiNotional: number;
  observedAt: string; fetchedAt: string; scanId: string; recovered: boolean | null;
  candleWindow?: PushCandleWindow;
}, nowMs: number): MarketPushObservation {
  const observation: MarketPushObservation = {
    symbol: input.symbol, direction: "LONG", producer: "squeeze", model: "short_squeeze",
    scanId: input.scanId, observedAt: input.observedAt, fetchedAt: input.fetchedAt,
    classification: "incomplete", stage: "squeeze_acceleration", evidence: [],
    squeezeMetrics: input.metrics, minOiNotional: input.minOiNotional,
    candleWindow: input.candleWindow,
  };
  const numericFields = [input.metrics.funding, input.metrics.basis, input.metrics.oiGrowth15m,
    input.metrics.oiNotional, input.metrics.priceChange15m, input.metrics.volRatio,
    input.metrics.globalLongShortRatio, input.metrics.topTraderLongShortRatio, input.metrics.takerBuySellRatio];
  if (!numericFields.every(value => typeof value === "number" && Number.isFinite(value)) ||
      typeof input.metrics.breakout20 !== "boolean" || !Number.isFinite(input.minOiNotional) || input.minOiNotional <= 0 ||
      input.candleWindow?.intervalMs !== 300000 || !isCurrentPushCandle(input.candleWindow, nowMs, MARKET_PUSH_FRESH_MS) ||
      !isFreshPushTime(input.observedAt, nowMs, MARKET_PUSH_FRESH_MS) ||
      !isFreshPushTime(input.fetchedAt, nowMs, MARKET_PUSH_FRESH_MS)) return observation;
  const result = scoreShortSqueeze(input.metrics, { minOiNotional: input.minOiNotional });
  observation.evidence = [...result.reasons];
  observation.classification = input.recovered === true ? "recovered" : result.level === 3 ? "qualified" : "complete_unqualified";
  return observation;
}
function stageRank(stage: MarketPushStage) { return stage === "squeeze_acceleration" ? 2 : 1; }
export function transitionPushEpisode(previous: PushEpisodeState | null, observations: MarketPushObservation[], nowMs: number): {
  state: PushEpisodeState | null; event: PushEvent | null;
} {
  const identity = previous ?? observations[0];
  if (!identity) return { state: previous, event: null };
  if (observations.some(item => item.symbol !== identity.symbol || item.direction !== identity.direction)) throw new Error("push episode identity mismatch");
  const qualified = observations.filter(item => item.classification === "qualified");
  let state = previous ? structuredClone(previous) : null;
  let isNew = false;
  if ((!state || state.endedAt) && qualified.length) {
    const seed = [identity.symbol, identity.direction, previous?.episodeId ?? "", nowMs, ...qualified.map(item => `${marketPushParticipantKey(item)}:${item.scanId}`).sort()].join("|");
    const episodeId = `market:${identity.symbol}:${identity.direction}:${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
    state = { episodeId, symbol: identity.symbol, direction: identity.direction, participants: {},
      highestStage: "confirmed", startedAt: new Date(nowMs).toISOString(), endedAt: null };
    isNew = true;
  }
  if (!state || state.endedAt) return { state, event: null };
  let highest = state.highestStage;
  for (const item of observations) {
    const key = marketPushParticipantKey(item);
    const existing = state.participants[key];
    if (existing?.lastScanId === item.scanId) continue;
    // Only a participating confirmation can keep an episode open or supply end evidence.
    if (!existing && item.classification !== "qualified") continue;
    const participant = existing ?? { producer: item.producer, model: item.model, lastScanId: "", unqualifiedScans: 0, ended: false };
    participant.lastScanId = item.scanId;
    if (item.classification === "qualified") {
      participant.unqualifiedScans = 0; participant.ended = false;
      participant.recoveryScans = 0;
      if (stageRank(item.stage) > stageRank(highest)) highest = item.stage;
    } else if (item.producer === "squeeze") {
      if (item.classification === "recovered") participant.ended = true;
      const recovery = item.recoveryEvidence;
      if (item.classification === "recovery_observation" && recovery && participant.lastRecoverySampleId !== recovery.sampleId) {
        participant.lastRecoverySampleId = recovery.sampleId;
        participant.recoveryScans = recovery.recovered ? (participant.recoveryScans ?? 0) + 1 : 0;
        if (participant.recoveryScans >= 3) participant.ended = true;
      }
    } else if (item.classification === "invalidated") participant.ended = true;
    else if (item.classification === "complete_unqualified") {
      participant.unqualifiedScans += 1;
      if (participant.unqualifiedScans >= 3) participant.ended = true;
    }
    state.participants[key] = participant;
  }
  if (Object.values(state.participants).every(item => item.ended)) state.endedAt = new Date(nowMs).toISOString();
  const upgraded = stageRank(highest) > stageRank(state.highestStage);
  state.highestStage = highest;
  if ((!isNew && !upgraded) || !qualified.length) return { state, event: null };
  const evidence = [...new Set(qualified.flatMap(item => item.evidence))];
  const direction = state.direction === "LONG" ? "做多" : "做空";
  const event: PushEvent = {
    id: `${state.episodeId}:${highest}`, source: "market", episodeId: state.episodeId, stage: highest,
    priority: 0, title: `${state.symbol} ${highest === "squeeze_acceleration" ? "轧空加速预警" : `${direction}结构确认`}`,
    body: evidence.slice(0, 3).join("；") || "行情规则确认重要变化，请查看异动详情。",
    target: `/alerts?symbol=${encodeURIComponent(state.symbol)}#market-push-${encodeURIComponent(state.symbol)}`,
    occurredAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + MARKET_PUSH_FRESH_MS).toISOString(),
    sourcePublishedAt: null, ruleVersion: IMPORTANT_PUSH_RULE_VERSION, evidence,
  };
  return { state, event };
}
