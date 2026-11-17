import { readNewsJson } from "./news-terminal-client.ts";
import type { NewsMarket } from "./news-terminal-types.ts";

export type NewsMarketSelection = {
  symbol: string;
  venue: NewsMarket["venue"];
  interval: string;
  assetId?: string | null;
};

const STORAGE_KEY = "signal-hub:news-market-cache:v1";
const memory = new Map<string, NewsMarket>();
const requests = new Map<string, Promise<NewsMarket>>();
const verifiedAt = new Map<string, number>();
const stats = new Map<string, NewsMarket>();
let hydrated = false;
let preloading = false;
const preloadQueue = new Map<string, NewsMarketSelection>();
const preloadAttempts = new Map<string, number>();
let preloadWindowAt = 0;
let preloadCount = 0;

export function newsMarketKey(selection: NewsMarketSelection) {
  return `${selection.symbol}|${selection.venue}|${selection.assetId || ""}|${selection.interval}`;
}

export function readCachedNewsMarket(selection: NewsMarketSelection): NewsMarket | null {
  if (!hydrated) {
    hydrated = true;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) for (const entry of saved.slice(-8)) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1]?.pair && Array.isArray(entry[1]?.candles)) {
          memory.set(entry[0], entry[1]);
        }
      }
    } catch { /* Browser storage is optional. */ }
  }
  return memory.get(newsMarketKey(selection)) ?? null;
}

export function cacheNewsMarket(selection: NewsMarketSelection, market: NewsMarket) {
  if (!market.pair || !market.candles.length || market.error) return;
  const key = newsMarketKey(selection);
  memory.delete(key);
  memory.set(key, market);
  while (memory.size > 32) memory.delete(memory.keys().next().value!);
}

export function persistNewsMarkets() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...memory.entries()].slice(-8)));
  } catch { /* Browser storage is optional. */ }
}

export async function fetchNewsMarket(selection: NewsMarketSelection, view: "chart" | "stats", refresh = false): Promise<NewsMarket> {
  const key = newsMarketKey(selection);
  const requestKey = `${view}:${key}`;
  const cached = view === "chart" ? readCachedNewsMarket(selection) : stats.get(key);
  if (!refresh && cached && Date.now() - (verifiedAt.get(requestKey) ?? 0) < (view === "chart" ? 15_000 : 30_000)) return cached;
  const existing = requests.get(requestKey);
  if (existing) return existing;
  const params = new URLSearchParams({ symbol: selection.symbol, venue: selection.venue, interval: selection.interval, view });
  if (selection.assetId) params.set("assetId", selection.assetId);
  const task = readNewsJson<NewsMarket>(`/api/eqn-news/market?${params}`, { signal: AbortSignal.timeout(12_000) })
    .then((market) => {
      if (market.symbol !== selection.symbol || market.venue !== selection.venue) throw new Error("行情币种不匹配");
      if (!market.error) {
        verifiedAt.delete(requestKey);
        verifiedAt.set(requestKey, Date.now());
        while (verifiedAt.size > 96) verifiedAt.delete(verifiedAt.keys().next().value!);
        if (view === "chart") {
          cacheNewsMarket(selection, market);
          persistNewsMarkets();
        } else {
          stats.delete(key);
          stats.set(key, market);
          while (stats.size > 32) stats.delete(stats.keys().next().value!);
        }
      }
      return market;
    }).finally(() => requests.delete(requestKey));
  requests.set(requestKey, task);
  return task;
}

// One speculative request at a time, with a small queue and a per-symbol cooldown.
export function prefetchNewsMarket(selection: NewsMarketSelection) {
  if (typeof document !== "undefined" && document.hidden) return;
  const key = newsMarketKey(selection);
  if (Date.now() - (preloadAttempts.get(key) ?? 0) < 30_000 || preloadQueue.has(key)) return;
  if (preloadQueue.size >= 2) return;
  preloadQueue.set(key, selection);
  void drainPreloads();
}

async function drainPreloads() {
  if (preloading) return;
  preloading = true;
  try {
    while (preloadQueue.size) {
      const [key, selection] = preloadQueue.entries().next().value!;
      preloadQueue.delete(key);
      if (typeof document !== "undefined" && document.hidden) { preloadQueue.clear(); break; }
      if (Date.now() - preloadWindowAt >= 60_000) { preloadWindowAt = Date.now(); preloadCount = 0; }
      if (preloadCount >= 6) { preloadQueue.clear(); break; }
      preloadCount++;
      preloadAttempts.delete(key);
      preloadAttempts.set(key, Date.now());
      while (preloadAttempts.size > 64) preloadAttempts.delete(preloadAttempts.keys().next().value!);
      await fetchNewsMarket(selection, "chart").catch(() => {});
    }
  } finally { preloading = false; }
}
