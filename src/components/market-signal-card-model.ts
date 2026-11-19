import type { MarketSignalsBoardData } from "@/lib/market-signals-view";
import type { MarketLifecycleEvent } from "@/lib/market-lifecycle";

export type BoardEvent = MarketSignalsBoardData["events"][number];
type Episode = MarketSignalsBoardData["volumeEpisodes"][number];
type Candle = MarketSignalsBoardData["cardCandles"][string][number];
export type AssetFilter = "crypto" | "equity";
export type Direction = "up" | "down" | "squeeze";
export type DirectionFilter = Direction | "all" | "watch";
export type BoardView = "focus" | "all";
export const HOUR_MS = 3_600_000;
const EPISODE_MS = 2 * HOUR_MS;

export function directionOf(event: BoardEvent): Direction {
  if (event.type === "short_squeeze") return "squeeze";
  return event.side === "SHORT" ? "down" : "up";
}

export function eventTime(event: BoardEvent) {
  const created = Date.parse(event.createdAt);
  return Number.isFinite(created) ? created : Date.parse(event.occurredAt);
}

export const lifecycleLabels = { startup: "启动候选", pumped: "已大涨", weakening: "大涨后转弱" } as const;

export type CardRow = {
  symbol: string;
  events: BoardEvent[];
  lifecycleEvents: MarketLifecycleEvent[];
  primaryLifecycle?: MarketLifecycleEvent;
  episode?: Episode;
  latestAt: number;
};

type BoardFilters = { startMs: number; endMs: number; asset: AssetFilter; direction: DirectionFilter; watchlist: string[]; view: BoardView };

export function buildCardRows(data: MarketSignalsBoardData, filters: BoardFilters): CardRow[] {
  const { startMs, endMs, asset, direction, watchlist, view } = filters;
  const coins = new Set(data.signals.coinSymbols);
  const watched = new Set(watchlist);
  const bySymbol = new Map<string, CardRow>();
  function rowFor(symbol: string, at: number) {
    if (at < startMs || at > endMs || !Number.isFinite(at)) return;
    if (asset === "equity" ? data.assetClasses[symbol] !== "EQUITY" : !coins.has(symbol)) return;
    if (direction === "watch" && !watched.has(symbol)) return;
    let row = bySymbol.get(symbol);
    if (!row) {
      row = { symbol, events: [], lifecycleEvents: [], latestAt: at };
      bySymbol.set(symbol, row);
    }
    return row;
  }
  const rawDirection = direction === "up" || direction === "down" || direction === "squeeze";
  for (const event of data.events) {
    if (rawDirection && direction !== directionOf(event)) continue;
    rowFor(event.symbol, eventTime(event))?.events.push(event);
  }
  for (const phase of data.lifecycleEvents ?? []) {
    if (rawDirection && !bySymbol.has(phase.symbol)) continue;
    rowFor(phase.symbol, phase.at)?.lifecycleEvents.push(phase);
  }

  const rows: CardRow[] = [];
  for (const row of bySymbol.values()) {
    row.events.sort((a, b) => eventTime(b) - eventTime(a));
    row.lifecycleEvents.sort((a, b) => b.at - a.at);
    const latestPhase = row.lifecycleEvents[0];
    const latestAlertAt = row.events.length ? eventTime(row.events[0]) : -Infinity;
    if (view === "focus" && (!latestPhase || latestPhase.kind === "pumped")) continue;
    if (!rawDirection && latestPhase && (view === "focus" || latestPhase.at >= latestAlertAt)) row.primaryLifecycle = latestPhase;
    row.latestAt = row.primaryLifecycle?.at ?? latestAlertAt;
    rows.push(row);
  }
  // Volume can annotate the signal which selected the card, but cannot create or promote one.
  for (const episode of data.volumeEpisodes ?? []) {
    const row = bySymbol.get(episode.symbol);
    if (row && episode.firstAt <= row.latestAt && row.latestAt < episode.firstAt + EPISODE_MS &&
        (!row.episode || episode.firstAt > row.episode.firstAt)) row.episode = episode;
  }
  return rows.sort((a, b) => b.latestAt - a.latestAt || a.symbol.localeCompare(b.symbol));
}

export function triggerLabel(event: BoardEvent) {
  const direction = directionOf(event);
  if (direction === "squeeze") return event.stage || "轧空";
  return `${direction === "up" ? "暴涨" : "暴跌"} L${event.level}`;
}

type Mark = { kind: "burst" | Direction | MarketLifecycleEvent["kind"]; at: number; price: number; label: string };

export function getCardChart(candles: Candle[], endMs: number, row: CardRow) {
  const startMs = endMs - HOUR_MS;
  const bars = candles.filter(candle => candle.at + 60_000 > startMs && candle.at <= endMs);
  const marks: Mark[] = row.lifecycleEvents.map(phase => ({
    kind: phase.kind, at: phase.at, price: phase.price, label: lifecycleLabels[phase.kind],
  }));
  for (const event of row.events) {
    marks.push({ kind: directionOf(event), at: eventTime(event), price: event.price, label: triggerLabel(event) });
  }
  marks.sort((a, b) => Number(b.at === row.latestAt) - Number(a.at === row.latestAt) || b.at - a.at);
  if (row.episode) marks.push({ kind: "burst", at: row.episode.firstAt, price: row.episode.firstPrice, label: "首爆" });
  return { bars, startMs, endMs, marks: marks.filter(mark => mark.at >= startMs && mark.at <= endMs) };
}
