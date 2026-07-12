import { createHash } from "node:crypto";
import type {
  OpportunityCandidate,
  OpportunityScore,
  OpportunitySourceItem,
  OpportunityStatus,
} from "./opportunity-types.ts";

function normalizeOpportunityText(text: string) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}$]+/gu, " ").trim();
}

function opportunityTokens(text: string) {
  return new Set(normalizeOpportunityText(text).split(/\s+/).filter((token) => token.length >= 2));
}

export function textJaccardSimilarity(left: string, right: string) {
  const a = opportunityTokens(left);
  const b = opportunityTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

export function clusterOpportunityItems(items: OpportunitySourceItem[]) {
  const clusters: OpportunityCandidate[] = [];
  for (const item of [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))) {
    const assets = [...new Set(item.assetKeys.map((value) => value.toUpperCase()))].sort();
    const current = clusters.find((candidate) =>
      candidate.market === item.market &&
      candidate.eventType === item.eventType &&
      candidate.assetKeys.join(",") === assets.join(",") &&
      Math.abs(Date.parse(item.publishedAt) - Date.parse(candidate.firstSeenAt)) <= 6 * 60 * 60 * 1000 &&
      candidate.evidence.every((entry) => textJaccardSimilarity(entry.translation || entry.text, item.translation || item.text) >= 0.45),
    );
    if (!current) {
      const fingerprint = createHash("sha256").update(normalizeOpportunityText(item.translation || item.text)).digest("hex").slice(0, 12);
      clusters.push({
        canonicalKey: `${item.market}:${item.eventType}:${assets.join(",")}:${formatOpportunityDateKey(new Date(item.publishedAt), "Asia/Shanghai")}:${fingerprint}`,
        market: item.market,
        assetKeys: assets,
        eventType: item.eventType,
        firstSeenAt: item.publishedAt,
        lastSeenAt: item.publishedAt,
        evidence: [item],
      });
      continue;
    }
    if (!current.evidence.some((entry) => entry.id === item.id)) current.evidence.push(item);
    if (item.publishedAt < current.firstSeenAt) current.firstSeenAt = item.publishedAt;
    if (item.publishedAt > current.lastSeenAt) current.lastSeenAt = item.publishedAt;
  }
  return clusters;
}

type OpportunityScoreContext = {
  priorityAssetKeys: Set<string>;
  marketReaction: { available: boolean; absoluteMovePercent: number };
  now: Date;
};

export function scoreOpportunityCandidate(candidate: OpportunityCandidate, context: OpportunityScoreContext): OpportunityScore {
  const independentSources = new Set(candidate.evidence.map((item) => `${item.sourceType}:${item.sourceName}`)).size;
  const sourceQuality = Math.min(20, independentSources * 10);
  const specificity = candidate.assetKeys.length > 0 ? 15 : 0;
  const catalyst = candidate.eventType === "other" ? 6 : 20;
  const corroboration = Math.min(15, Math.max(0, independentSources - 1) * 8);
  const ageMs = context.now.getTime() - Date.parse(candidate.lastSeenAt);
  const freshness = ageMs <= 6 * 60 * 60 * 1000 ? 10 : ageMs <= 24 * 60 * 60 * 1000 ? 6 : 0;
  const priority = candidate.assetKeys.some((key) => context.priorityAssetKeys.has(key)) ? 10 : 0;
  const reaction = !context.marketReaction.available
    ? 5
    : context.marketReaction.absoluteMovePercent <= 3
      ? 10
      : context.marketReaction.absoluteMovePercent <= 7
        ? 4
        : 0;
  const components = { sourceQuality, specificity, catalyst, corroboration, freshness, priority, reaction };
  return { ruleScore: Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)), components, penalties: [] };
}

export function selectDailyOpportunities<T extends { finalScore: number; dismissed: boolean }>(items: T[], limit = 10) {
  return items
    .filter((item) => !item.dismissed && item.finalScore >= 75)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, Math.min(10, Math.max(0, limit)));
}

export function deriveOpportunityStatus(
  value: { validUntil?: string | null; invalidatedAt?: string | null; independentSourceCount?: number; finalScore?: number; confidence?: string },
  now = new Date(),
): OpportunityStatus {
  if (value.invalidatedAt || (value.validUntil && Date.parse(value.validUntil) <= now.getTime())) return "expired";
  if ((value.independentSourceCount ?? 0) >= 3 && (value.finalScore ?? 0) >= 85 && value.confidence === "high") return "confirmed";
  return (value.independentSourceCount ?? 0) >= 2 ? "tracking" : "new";
}

export function formatOpportunityDateKey(date: Date, timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
