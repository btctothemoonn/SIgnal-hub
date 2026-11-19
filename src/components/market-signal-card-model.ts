import type { MarketSignalsBoardData } from "@/lib/market-signals-view";

export type BoardEvent = MarketSignalsBoardData["events"][number];
type Episode = MarketSignalsBoardData["volumeEpisodes"][number];
type Candle = MarketSignalsBoardData["cardCandles"][string][number];
export type AssetFilter = "crypto" | "equity";
export type Direction = "up" | "down" | "squeeze";
export type DirectionFilter = Direction | "all" | "watch" | "observation";
export const HOUR_MS = 3_600_000;
export const EPISODE_MS = 2 * HOUR_MS;

export function directionOf(event: BoardEvent): Direction {
  if (event.type === "short_squeeze") return "squeeze";
  return event.side === "SHORT" ? "down" : "up";
}

export function eventTime(event: BoardEvent) {
  const created = Date.parse(event.createdAt);
  return Number.isFinite(created) ? created : Date.parse(event.occurredAt);
}

export type CardRow = {
  symbol: string;
  events: BoardEvent[];
  episode?: Episode;
  confirmations: BoardEvent[];
  latestAt: number;
};

type BoardFilters = { startMs: number; endMs: number; asset: AssetFilter; direction: DirectionFilter; watchlist: string[] };

export function buildCardRows(data: MarketSignalsBoardData, filters: BoardFilters): CardRow[] {
  const { startMs, endMs, asset, direction, watchlist } = filters;
  const coins = new Set(data.signals.coinSymbols);
  const watched = new Set(watchlist);
  const matchesAsset = (symbol: string) => asset === "equity" ? data.assetClasses[symbol] === "EQUITY" : coins.has(symbol);
  const bySymbol = new Map<string, BoardEvent[]>();
  for (const event of data.events) {
    if (!matchesAsset(event.symbol) || eventTime(event) > endMs) continue;
    const list = bySymbol.get(event.symbol);
    if (list) list.push(event);
    else bySymbol.set(event.symbol, [event]);
  }
  const episodes = new Map<string, Episode>();
  for (const episode of data.volumeEpisodes ?? []) {
    if (!matchesAsset(episode.symbol) || episode.firstAt > endMs) continue;
    const previous = episodes.get(episode.symbol);
    if (!previous || episode.firstAt > previous.firstAt) episodes.set(episode.symbol, episode);
  }

  const rows: CardRow[] = [];
  for (const symbol of new Set([...bySymbol.keys(), ...episodes.keys()])) {
    if (direction === "watch" && !watched.has(symbol)) continue;
    const history = (bySymbol.get(symbol) ?? []).sort((a, b) => eventTime(b) - eventTime(a));
    const candidate = episodes.get(symbol);
    // occurredAt may be the start of a candle. createdAt is when the worker actually raised the alert.
    const confirmations = candidate ? history.filter(event => {
      const at = Date.parse(event.createdAt);
      return event.type === "volatility" && event.side === "LONG"
        && at >= candidate.firstAt && at < candidate.firstAt + EPISODE_MS;
    }).reverse() : [];
    const episode = candidate && (candidate.lastAt >= startMs || confirmations.some(event => eventTime(event) >= startMs)) ? candidate : undefined;
    const events = history.filter(event => eventTime(event) >= startMs);
    if (direction === "observation" && (!episode || confirmations.length)) continue;
    const selectedEvents = direction === "up" || direction === "down" || direction === "squeeze"
      ? events.filter(event => directionOf(event) === direction)
      : events;
    if (!selectedEvents.length && (!episode || direction === "up" || direction === "down" || direction === "squeeze")) continue;
    rows.push({
      symbol, events: selectedEvents, episode, confirmations: episode ? confirmations : [],
      latestAt: Math.max(episode?.lastAt ?? 0, selectedEvents.length ? eventTime(selectedEvents[0]) : 0),
    });
  }
  return rows.sort((a, b) => b.latestAt - a.latestAt || a.symbol.localeCompare(b.symbol));
}

export function currentStageEvent(row: CardRow, direction: DirectionFilter): BoardEvent | undefined {
  const latest = row.events[0];
  if (!row.episode || direction === "up" || direction === "down" || direction === "squeeze") return latest;
  if (direction === "observation") return undefined;
  const confirmation = row.confirmations.at(-1);
  if (latest && eventTime(latest) >= row.episode.firstAt && (!confirmation || eventTime(latest) >= eventTime(confirmation))) return latest;
  return confirmation;
}

export function triggerLabel(event: BoardEvent) {
  const direction = directionOf(event);
  if (direction === "squeeze") return event.stage || "轧空";
  return `${direction === "up" ? "暴涨" : "暴跌"} L${event.level}`;
}

type Mark = { kind: "burst" | "long" | Direction; at: number; price: number; label: string };

export function getCardChart(candles: Candle[], endMs: number, episode: Episode | undefined, confirmations: BoardEvent[], stageEvent?: BoardEvent) {
  const startMs = endMs - HOUR_MS;
  const bars = candles.filter(candle => candle.at + 60_000 > startMs && candle.at <= endMs);
  const marks: Mark[] = [];
  if (episode) marks.push({ kind: "burst", at: episode.firstAt, price: episode.firstPrice, label: "首爆" });
  for (const event of confirmations) {
    marks.push({ kind: "long", at: Date.parse(event.createdAt), price: event.price, label: `暴涨 L${event.level}` });
  }
  if (stageEvent && !confirmations.some(event => event.id === stageEvent.id)) {
    marks.push({ kind: directionOf(stageEvent), at: eventTime(stageEvent), price: stageEvent.price, label: triggerLabel(stageEvent) });
  }
  return { bars, startMs, endMs, marks: marks.filter(mark => mark.at >= startMs && mark.at <= endMs) };
}
