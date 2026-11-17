import { createHash } from "node:crypto";
import type { NewsItem } from "./news-terminal-types.ts";

export const EQN_CHANNELS = ["all", "main", "tradfi", "binance", "korea", "pricechange", "oi", "major", "tier2", "tier3", "alpha", "cz", "earn"] as const;
export type EqnOrigin = "ws" | "mcp" | "rss";
export type EqnRecord = NewsItem & { origin: EqnOrigin; identity: string; sourceUrl: string; detail: boolean };
export type EqnFeedQuery = { channel?: string; coin?: string; source?: string; q?: string; before?: string; limit?: number };
export const eqnObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const eqnText = (value: unknown, max = 16000): string => typeof value === "string" ? value.trim().slice(0, max) : "";
export const eqnNumber = (value: unknown): number | null => value == null || value === "" || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const eqnArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function eqnUrl(value: unknown, relative = false): string {
  const text = eqnText(value, 4096);
  if (!text) return "";
  try {
    const url = relative ? new URL(text, "https://eqn.news") : new URL(text);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function eqnTimestamp(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
  const ms = numeric === null ? Date.parse(eqnText(value)) : numeric < 1e11 ? numeric * 1000 : numeric;
  return Number.isSafeInteger(Math.floor(ms)) && ms > 0 && ms < 9e12 ? Math.floor(ms) : null;
}

export function scoreEqnNews(item: Pick<NewsItem, "title" | "kind" | "source" | "channels" | "coins">): number {
  let score = 0;
  if (item.kind === "listing" || /listing|delist|上线|上币|下架/i.test(item.title)) score += 50;
  if (/^(binance|upbit|bithumb|coinbase|okx)(?:[ _-]|$)/i.test(item.source)) score += 25;
  if (item.channels.some((ch) => ["cz", "major"].includes(ch))) score += 15;
  if (item.coins.length) score += 10;
  if (item.coins.some((coin) => coin.marketCapAtPublish !== null && coin.marketCapAtPublish > 0 && coin.marketCapAtPublish < 500_000_000)) score += 10;
  if (!item.coins.length && item.channels.includes("tradfi")) score -= 10;
  return Math.min(100, Math.max(0, score));
}

export function normalizeEqnNews(value: unknown, origin: EqnOrigin, receivedAt = Date.now()): EqnRecord | null {
  const row = eqnObject(value);
  const publishedAt = eqnTimestamp(row.time ?? row.timestamp ?? row.published_at);
  const i18n = eqnObject(row.i18n);
  const title = eqnText(row.zh ?? i18n.zh ?? row.news_title ?? row.title);
  if (publishedAt === null || !title) return null;
  const sourceObj = eqnObject(row.source);
  const source = eqnText(typeof row.source === "string" ? row.source : sourceObj.slug ?? row.source_name, 120) || "unknown";
  const sourceName = eqnText(sourceObj.display_zh ?? row.source_name ?? source, 160);
  const noValue = eqnNumber(row.no);
  const no = noValue !== null && Number.isSafeInteger(noValue) && noValue > 0 ? noValue : null;
  // WS url is the SOURCE URL; MCP url is the eqn permalink. Seconds are shared across both.
  const sourceUrl = eqnUrl(origin === "ws" ? row.url : row.source_url);
  const identityBase = sourceUrl || `${source.toLowerCase()}|${title}`;
  const identity = createHash("sha256").update(`${identityBase}|${Math.floor(publishedAt / 1000)}`).digest("hex");
  const data = eqnObject(row.data);
  const coins = eqnArray(row.coins ?? row.coins_included ?? data.symbols).slice(0, 30).map((value) => {
    const coin = eqnObject(value);
    const symbol = eqnText(typeof value === "string" ? value : coin.symbol, 32).toUpperCase();
    return { symbol, assetId: eqnText(coin.asset_id, 160) || null, marketCapAtPublish: eqnNumber(coin.mc_at_publish) };
  }).filter((coin, index, all) => /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(coin.symbol) && all.findIndex((x) => x.symbol === coin.symbol) === index);
  const item: EqnRecord = {
    id: no === null ? `ws:${identity}` : String(no), no, publishedAt, receivedAt,
    channels: eqnArray(row.channels ?? (origin === "ws" ? ["main"] : [])).map((x) => eqnText(x, 32)).filter((x) => (EQN_CHANNELS as readonly string[]).includes(x)).slice(0, 13),
    kind: eqnText(row.kind, 60) || "news", source, sourceName, title,
    original: eqnText(row.body ?? row.en ?? i18n.en ?? title, 64000) || title,
    url: origin === "ws" ? sourceUrl : eqnUrl(row.url) || (no ? `https://eqn.news/main/${no}` : sourceUrl),
    images: eqnArray(row.images).slice(0, 20).map((x) => eqnUrl(typeof x === "string" ? x : eqnObject(x).url, true)).filter(Boolean),
    coins, digest: eqnArray(eqnObject(data.announcement_digest).points).slice(0, 20).map((x) => eqnText(x, 2000)).filter(Boolean),
    score: 0, origin, identity, sourceUrl, detail: Object.hasOwn(row, "body") || Object.hasOwn(row, "telegram"),
  };
  item.score = scoreEqnNews(item);
  return item;
}

export function parseEqnFeedQuery(params: URLSearchParams): EqnFeedQuery {
  const channel = params.get("channel") || "all";
  if (!(EQN_CHANNELS as readonly string[]).includes(channel)) throw new Error("Invalid channel");
  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^[1-9]\d{0,5}$/.test(rawLimit)) throw new Error("Invalid limit");
  const coin = (params.get("coin") || "").trim().toUpperCase();
  if (coin && !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(coin)) throw new Error("Invalid coin");
  const q = (params.get("q") || "").trim();
  const source = (params.get("source") || "").trim();
  const before = params.get("before") || undefined;
  if (q.length > 200 || source.length > 120 || (before?.length ?? 0) > 500) throw new Error("Query too long");
  return { channel, coin, q, source, before, limit: Math.min(200, rawLimit ? Number(rawLimit) : 100) };
}
