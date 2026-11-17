import type {
  NewsCandle,
  NewsItem,
  TradeRequest,
  TradeVenue,
} from "./news-terminal-types.ts";

export function mergeNewsItems(
  previous: NewsItem[],
  incoming: NewsItem[],
): NewsItem[] {
  const items = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt || b.id.localeCompare(a.id))
    .slice(0, 500);
}

export function chartNewsMarkers(
  items: NewsItem[],
  symbol: string,
  candles: NewsCandle[],
) {
  const groups = new Map<number, number>();
  const lastTime = candles.at(-1)?.time ?? 0;
  const step = candles.length > 1 ? lastTime - candles[candles.length - 2].time : 60;
  for (const item of items) {
    if (
      item.score < 70 ||
      !item.coins.some(
        (coin) => coin.symbol.toUpperCase() === symbol.toUpperCase(),
      )
    )
      continue;
    const seconds = item.publishedAt / 1000;
    if (
      !candles.length ||
      seconds < candles[0].time ||
      seconds >= lastTime + step
    )
      continue;
    let index = candles.findIndex((candle) => candle.time > seconds);
    if (index < 0) index = candles.length;
    const time = candles[index - 1]?.time;
    if (time !== undefined) groups.set(time, (groups.get(time) || 0) + 1);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([time, count]) => ({
      time,
      position: "aboveBar" as const,
      color: "#d6a85b",
      shape: "circle" as const,
      text: count > 1 ? `新闻 ×${count}` : "新闻",
    }));
}

export function formatNewsPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 0.01 ? 10 : value < 1 ? 6 : 2,
  }).format(value);
}

export function newsPriceMinMove(price: number | null | undefined): number {
  const exponent = Math.floor(Math.log10(Math.max(1e-10, Math.abs(price || 1) / 100000)));
  return 10 ** Math.max(-10, Math.min(-2, exponent));
}

export function newsExecutionSymbol(pair: string, venue: TradeVenue): string {
  return venue === "binance" ? pair.replace(/USDT$/, "") : pair;
}

export function normalizeNewsOrder<T extends Partial<TradeRequest>>(order: T): T {
  const normalized = { ...order };
  if (normalized.type === "market") delete normalized.limitPrice;
  if (normalized.reduceOnly) {
    delete normalized.stopLossPct;
    delete normalized.takeProfitPct;
  }
  return normalized;
}

export function formatNewsMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function tradeConfirmationKey(order: Partial<TradeRequest>): string {
  return JSON.stringify([
    order.venue,
    order.symbol,
    order.side,
    order.type,
    order.notional,
    order.leverage,
    order.limitPrice,
    order.stopLossPct,
    order.takeProfitPct,
    order.reduceOnly,
    order.closeFraction,
    order.newsId,
  ]);
}

export async function readNewsJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data as T;
}
