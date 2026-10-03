export const MARKET_BRIEF_INTERVAL_MS = 10 * 60_000;
export const MARKET_BRIEF_STALE_AFTER_MS = 20 * 60_000;

export type MarketBriefScope = "3h" | "24h";
export type MarketBriefFigures = {
  fast?: number; slow?: number; vol?: number;
  hour?: number; dist?: number; oi?: number;
};
export const MARKET_BRIEF_FIGURE_LABELS: Record<keyof MarketBriefFigures, string> = {
  fast: "短周期涨跌",
  slow: "较长周期涨跌",
  vol: "短周期成交量比",
  hour: "已收盘1小时涨跌",
  dist: "距近24小时高/低点",
  oi: "15分钟未平仓合约变化",
};

const FIGURE_PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Placeholder names referenced by a template, in order, de-duplicated. */
export function marketBriefTemplateKeys(template: string): string[] {
  return [...new Set([...template.matchAll(FIGURE_PLACEHOLDER)].map((match) => match[1]))];
}

/**
 * Substitute live figures into a template. Percentages are signed to two
 * decimals, distances are absolute, and ratios use the Chinese unit for multiples.
 * Returns null when the template references a figure that is unavailable, so
 * callers never publish a half-substituted sentence.
 */
export function renderMarketBriefTemplate(
  template: string,
  figures: MarketBriefFigures | undefined,
): string | null {
  const available = figures ?? {};
  let missing = false;
  const rendered = template.replace(FIGURE_PLACEHOLDER, (_match, key: string) => {
    if (!Object.hasOwn(MARKET_BRIEF_FIGURE_LABELS, key) || !Object.hasOwn(available, key)) {
      missing = true;
      return "";
    }
    const value = (available as Record<string, number | undefined>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      missing = true;
      return "";
    }
    if (key === "vol") return `${value.toFixed(2)}倍`;
    if (key === "dist") return `${Math.abs(value).toFixed(2)}%`;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  });
  return missing || /[{}]/.test(rendered) ? null : rendered;
}
export type MarketBriefItem = {
  symbol: string; pump: number; crash: number; squeeze: number; total: number;
  latestAt: string; latestPrice: number | null; latestChangePct: number | null;
  maxLevel: number; direction: "up" | "down" | "squeeze"; reason: string;
  // AI prose carries {key} placeholders instead of literal measurements, so
  // reusable sentences stay fresh and can never drift from live figures.
  reasonTemplate?: string;
  figures?: MarketBriefFigures;
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
