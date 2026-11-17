import type { NewsDetail, NewsItem, NewsMarket } from "./news-terminal-types.ts";
import { calculateEqnReactions, getEqnMarketClient, readEqnMarketContext } from "./eqn-news-market.ts";
import { getEqnNewsStore } from "./eqn-news-store.ts";
import { readEqnRelatedSignals } from "./eqn-news-related.ts";

export type EqnDetailSelection = { coin?: string; venue?: NewsMarket["venue"] };

export function parseEqnDetailQuery(params: URLSearchParams): EqnDetailSelection {
  const coin = params.has("coin") ? params.get("coin")!.trim().toUpperCase() : undefined;
  const venue = params.get("venue");
  if (coin !== undefined && !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(coin)) throw new Error("Invalid coin");
  if (venue !== null && venue !== "binance" && venue !== "hyperliquid") throw new Error("Invalid venue");
  return { coin, ...(venue !== null ? { venue } : {}) };
}

export async function getEqnNewsDetail(id: string, options: EqnDetailSelection & {
  store?: ReturnType<typeof getEqnNewsStore>; market?: ReturnType<typeof getEqnMarketClient>; now?: number;
} = {}): Promise<NewsDetail | null> {
  const store = options.store ?? getEqnNewsStore();
  const item = store.get(id);
  if (!item) return null;
  const now = options.now ?? Date.now();
  const requestedCoin = options.coin?.trim().toUpperCase();
  const coin = requestedCoin === undefined ? item.coins[0] : item.coins.find((candidate) => candidate.symbol === requestedCoin);
  const relatedCoins = requestedCoin === undefined ? item.coins : coin ? [coin] : [];
  const related = new Map<string, NewsItem>();
  for (const coin of relatedCoins.slice(0, 3)) {
    for (const news of store.feed({ coin: coin.symbol, limit: 21 }).items) if (news.id !== item.id) related.set(news.id, news);
  }
  let reactions = [1, 5, 15, 60].map((minutes) => ({ minutes, change: null as number | null }));
  let signals: NewsDetail["signals"] = await readEqnRelatedSignals(relatedCoins.map((coin) => coin.symbol), now);
  if (coin) {
    const market = options.market ?? getEqnMarketClient();
    const request = { symbol: coin.symbol, assetId: coin.assetId, venue: options.venue ?? "binance", interval: "1m" as const };
    try {
      const mapping = await market.resolve(request);
      if (mapping) {
        signals.push(...readEqnMarketContext(mapping.pair, now - 86400000).signals);
        const start = Math.ceil(item.publishedAt / 60000) * 60000;
        const end = Math.min(now, start + 61 * 60000);
        if (end >= start) reactions = calculateEqnReactions(item.publishedAt, await market.getCandles(request, start, end), now);
      }
    } catch { /* Missing market data leaves reactions unknown, never fabricated zeroes. */ }
  }
  signals = [...new Map(signals.map((signal) => [signal.url, signal])).values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 20);
  return { item, relatedNews: [...related.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 20), reactions, signals };
}
