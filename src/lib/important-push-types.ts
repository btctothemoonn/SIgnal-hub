import type { SqueezeMetrics } from "./market-alerts-core.ts";
import type { MarketOpportunityDecision, MarketOpportunityModel } from "./market-opportunity-core.ts";
import type { PushCandleWindow } from "./market-push-freshness.ts";

export type EnvLike = Record<string, string | undefined>;
export type MarketPushStage = "confirmed" | "squeeze_acceleration";
export type PushEvent = {
  id: string;
  source: "market" | "news" | "test";
  episodeId: string;
  stage: MarketPushStage | "exceptional_news" | "test";
  priority: 0 | 1;
  title: string;
  body: string;
  target: string;
  occurredAt: string;
  expiresAt: string;
  sourcePublishedAt: string | null;
  ruleVersion: string;
  evidence: string[];
};
export type MarketPushObservation = {
  symbol: string;
  direction: "LONG" | "SHORT";
  producer: "opportunity" | "squeeze";
  model: MarketOpportunityModel;
  scanId: string;
  observedAt: string;
  fetchedAt: string;
  classification: "qualified" | "complete_unqualified" | "invalidated" | "recovered" | "recovery_observation" | "incomplete";
  stage: MarketPushStage;
  evidence: string[];
  opportunityDecision?: MarketOpportunityDecision;
  squeezeMetrics?: SqueezeMetrics;
  minOiNotional?: number;
  sourceTimes?: Record<string, string | null>;
  candleWindow?: PushCandleWindow;
  recoveryEvidence?: { funding: number; oiGrowth15m: number; sampleId: string; recovered: boolean; observedAt: string; fetchedAt: string };
};
export type PushEpisodeParticipant = {
  producer: MarketPushObservation["producer"];
  model: MarketOpportunityModel;
  lastScanId: string;
  unqualifiedScans: number;
  ended: boolean;
  recoveryScans?: number;
  lastRecoverySampleId?: string;
};
export type PushEpisodeState = {
  episodeId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  participants: Record<string, PushEpisodeParticipant>;
  highestStage: MarketPushStage;
  startedAt: string;
  endedAt: string | null;
};
export type SequencedPushEvent = { sequence: number; event: PushEvent };
