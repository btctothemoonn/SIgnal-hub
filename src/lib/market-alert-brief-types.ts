export const MARKET_BRIEF_INTERVAL_MS = 3 * 60 * 60_000;
export const MARKET_BRIEF_STALE_AFTER_MS = MARKET_BRIEF_INTERVAL_MS + 15 * 60_000;

export type MarketBriefScope = "3h" | "24h";
export type MarketBriefItem = {
  symbol: string; pump: number; crash: number; squeeze: number; total: number;
  latestAt: string; latestPrice: number | null; latestChangePct: number | null;
  maxLevel: number; direction: "up" | "down" | "squeeze"; reason: string;
};
export type MarketBriefSnapshot = {
  scope: MarketBriefScope; windowStart: string; windowEnd: string;
  generatedAt: string | null; checkedAt: string | null; model: string | null;
  status: "ready" | "empty" | "pending" | "error"; stale: boolean;
  headline: string;
  totals: { symbols: number; pump: number; crash: number; squeeze: number; total: number };
  items: MarketBriefItem[]; risks: string[];
};
