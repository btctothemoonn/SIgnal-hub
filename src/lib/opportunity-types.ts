export const OPPORTUNITY_MARKETS = ["us", "cn", "crypto"] as const;
export type OpportunityMarket = (typeof OPPORTUNITY_MARKETS)[number];
export type OpportunityEventType =
  | "earnings"
  | "order"
  | "policy"
  | "product"
  | "capital"
  | "supply-chain"
  | "other";
export type OpportunityStatus = "new" | "tracking" | "confirmed" | "expired";
export type OpportunitySourceType = "telegram" | "x" | "patreon" | "douyin" | "news";
export type OpportunityMarketReaction =
  | { available: true; absoluteMovePercent: number }
  | { available: false; absoluteMovePercent: null };

export type OpportunitySourceItem = {
  id: string;
  sourceType: OpportunitySourceType;
  sourceName: string;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  publishedAt: string;
  text: string;
  translation: string | null;
  originalUrl: string;
};

export type OpportunityCandidate = {
  canonicalKey: string;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: OpportunitySourceItem[];
};

export type OpportunityScore = {
  ruleScore: number;
  components: Record<string, number>;
  penalties: string[];
};

export type OpportunityScoreContextAudit = {
  evaluatedAt: string | null;
  priorityAsset: boolean;
  marketReaction: OpportunityMarketReaction;
};

export type OpportunityScoreAudit = {
  context: OpportunityScoreContextAudit;
  components: Record<string, number>;
  penalties: string[];
};

export type OpportunityClaimEvidence = {
  thesis: string[];
  reasons: string[][];
  risks: string[][];
  invalidation: string[][];
};

export type OpportunityMarketFilter = OpportunityMarket | "all";
export type OpportunitySort = "score" | "latest";
export type OpportunityListStatus = "active" | "history";
export type OpportunityTier = "confirmed" | "watch";
export type OpportunityEvidenceView = {
  id: string;
  sourceType: OpportunitySourceType;
  sourceName: string;
  publishedAt: string;
  textExcerpt: string;
  originalUrl: string;
};
export type OpportunityCard = {
  id: number;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  status: OpportunityStatus;
  tier: OpportunityTier;
  finalScore: number;
  confidence: string;
  thesis: string;
  reasons: string[];
  risks: string[];
  invalidation: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  validUntil: string | null;
  selectedAt: string | null;
  followed: boolean;
  dismissed: boolean;
  aiPending: boolean;
  marketReaction: OpportunityMarketReaction;
  scoreAudit: OpportunityScoreAudit;
  claimEvidence: OpportunityClaimEvidence;
  evidence: OpportunityEvidenceView[];
};
export type OpportunitySnapshot = {
  generatedAt: string;
  lastWorkerSuccessAt: string | null;
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  items: OpportunityCard[];
  error: string | null;
};
