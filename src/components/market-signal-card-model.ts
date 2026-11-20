import type { MarketSignalsBoardData } from "@/lib/market-signals-view";
import type { MarketLifecycleEvent } from "@/lib/market-lifecycle";

export type BoardEvent = MarketSignalsBoardData["events"][number];
type Episode = MarketSignalsBoardData["volumeEpisodes"][number];
type Candle = MarketSignalsBoardData["cardCandles"][string][number];
export type Direction = "up" | "down" | "squeeze";
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

export function isSpecialAlert(event: BoardEvent) {
  if (event.type === "short_squeeze") return event.level >= 2;
  if (event.type !== "volatility" || (event.side !== "LONG" && event.side !== "SHORT")) return false;
  if (event.level >= 2) return true;
  const strength = event.metrics?.strengthPct;
  return event.level === 1 && event.trigger.includes("B加速") && typeof strength === "number" &&
    Number.isFinite(strength) && strength >= 5 && event.volumeRatio !== null && event.volumeRatio >= 20;
}

type CardFocus =
  | { kind: "startup"; phase: Extract<MarketLifecycleEvent, { kind: "startup" }> }
  | { kind: "weakening"; phase: Extract<MarketLifecycleEvent, { kind: "weakening" }> }
  | { kind: "special"; event: BoardEvent };

export type CardRow = {
  symbol: string;
  events: BoardEvent[];
  lifecycleEvents: MarketLifecycleEvent[];
  focus: CardFocus;
  episode?: Episode;
  latestAt: number;
};

export function buildCardRows(data: MarketSignalsBoardData, { startMs, endMs }: { startMs: number; endMs: number }): CardRow[] {
  const marketSymbols = new Set(data.market === "equities" ? data.searchSymbols : data.signals.coinSymbols);
  const histories = new Map<string, Pick<CardRow, "events" | "lifecycleEvents">>();
  function historyFor(symbol: string, at: number) {
    if (!marketSymbols.has(symbol) || !Number.isFinite(at) || at < startMs || at > endMs) return;
    let history = histories.get(symbol);
    if (!history) {
      history = { events: [], lifecycleEvents: [] };
      histories.set(symbol, history);
    }
    return history;
  }
  for (const event of data.events) {
    historyFor(event.symbol, eventTime(event))?.events.push(event);
  }
  for (const phase of data.lifecycleEvents ?? []) {
    historyFor(phase.symbol, phase.at)?.lifecycleEvents.push(phase);
  }

  const rows = new Map<string, CardRow>();
  for (const [symbol, { events, lifecycleEvents }] of histories) {
    events.sort((a, b) => eventTime(b) - eventTime(a) || b.level - a.level);
    lifecycleEvents.sort((a, b) => b.at - a.at);
    const phase = lifecycleEvents[0];
    const special = events.find(isSpecialAlert);
    // A pump graduates a startup. It does not cancel a separate qualifying price or squeeze alert.
    let focus: CardFocus;
    if (phase && phase.kind !== "pumped" && (!special || phase.at >= eventTime(special))) {
      focus = phase.kind === "startup" ? { kind: "startup", phase } : { kind: "weakening", phase };
    } else if (special) {
      focus = { kind: "special", event: special };
    } else {
      continue;
    }
    const latestAt = focus.kind === "special" ? eventTime(focus.event) : focus.phase.at;
    rows.set(symbol, { symbol, events, lifecycleEvents, focus, latestAt });
  }
  // Volume can annotate the signal which selected the card, but cannot create or promote one.
  for (const episode of data.volumeEpisodes ?? []) {
    const row = rows.get(episode.symbol);
    if (row && episode.firstAt <= row.latestAt && row.latestAt < episode.firstAt + EPISODE_MS &&
        (!row.episode || episode.firstAt > row.episode.firstAt)) row.episode = episode;
  }
  return [...rows.values()].sort((a, b) => b.latestAt - a.latestAt || a.symbol.localeCompare(b.symbol));
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
