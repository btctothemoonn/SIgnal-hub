export const MARKET_BRIEF_INTERVAL_MS = 10 * 60_000;
export const MARKET_BRIEF_STALE_AFTER_MS = 20 * 60_000;

export type MarketBriefScope = "3h" | "24h";
export type MarketBriefItem = {
  symbol: string; pump: number; crash: number; squeeze: number; total: number;
  latestAt: string; latestPrice: number | null; latestChangePct: number | null;
  maxLevel: number; direction: "up" | "down" | "squeeze"; reason: string;
  tracking?: {
    state: "new" | "strengthening" | "continuing" | "waiting";
    trend?: "strong_up" | "strong_down" | "neutral";
    confirmation?: "confirmed" | "consolidating" | "waiting";
    expiresAt?: string;
    observedAt: string; evidence: string[]; nextWatch: string; dropIf: string;
    signalKey: string; strength?: number; bands?: number[]; narrativeFacts?: string[];
  };
};
export type MarketBriefSnapshot = {
  scope: MarketBriefScope; windowStart: string; windowEnd: string;
  generatedAt: string | null; checkedAt: string | null; model: string | null;
  status: "ready" | "empty" | "pending" | "error"; stale: boolean;
  headline: string;
  totals: { symbols: number; pump: number; crash: number; squeeze: number; total: number };
  items: MarketBriefItem[]; risks: string[];
  schemaVersion?: number;
  narrationFingerprint?: string;
  narrationNextAt?: string;
  changes?: { added: string[]; downgraded: string[] };
};
