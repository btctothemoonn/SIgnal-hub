import { createBinanceFuturesClient, type BinanceMarketClient } from "./market-alerts-binance.ts";
import { isStableOrFiatBase } from "./market-alerts-core.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import type { EnvLike } from "./important-push-types.ts";
import {
  buildPullbackPushEvent,
  classifyPositioning,
  computeTradeOutcome,
  computeWatchOutcome,
  evaluatePullback,
  getMarketSignalRules,
  marketSignalsDbPath,
  normalizeKlines,
  openMarketSignalsStore,
  type MarketSignal,
  type MarketSignalKind,
  type MarketSignalRules,
  type MarketSignalsStore,
  type PositioningPoint,
} from "./market-signals.ts";

const HOUR_MS = 60 * 60_000;
const BAR_15M_MS = 15 * 60_000;
const MAX_PULLBACK_SYMBOLS_PER_CYCLE = 40;
const MAX_OUTCOMES_PER_CYCLE = 20;
// Positioning is read a few minutes after each hour so the 1h bar and OI point have settled.
const POSITIONING_SETTLE_MS = 3 * 60_000;

type AlertsStore = ReturnType<typeof openMarketAlertsStore>;

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export type MarketSignalsCycleResult = {
  anchors: number;
  symbolsChecked: number;
  filled: number;
  pushed: number;
  outcomes: number;
  positioning: { hourMs: number; symbols: number; volatile: number; coil: number } | null;
  errors: string[];
};

async function runPullbackChecks(input: {
  alerts: AlertsStore;
  signals: MarketSignalsStore;
  client: BinanceMarketClient;
  nowMs: number;
  rules: MarketSignalRules;
  result: MarketSignalsCycleResult;
}) {
  const { alerts, signals, client, nowMs, rules, result } = input;
  if (!client.getKlinesSince) return;
  const since = new Date(nowMs - rules.pullbackWindowMs - HOUR_MS).toISOString();
  const events = alerts
    .getMarketAlertsSnapshot({ type: "volatility", from: since, limit: 200, now: new Date(nowMs).toISOString() })
    .events.filter((event) => event.side === "LONG");
  const statuses = signals.anchorStatuses(events.map((event) => event.id));
  const open = events.filter((event) => !statuses.has(event.id));
  result.anchors = open.length;
  const bySymbol = new Map<string, typeof open>();
  for (const event of open) bySymbol.set(event.symbol, [...(bySymbol.get(event.symbol) ?? []), event]);
  const symbols = [...bySymbol.keys()].slice(0, MAX_PULLBACK_SYMBOLS_PER_CYCLE);
  for (const symbol of symbols) {
    const anchors = (bySymbol.get(symbol) ?? []).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const earliest = Date.parse(anchors[0].occurredAt);
    let bars;
    try {
      const start = earliest - 24 * HOUR_MS - 2 * BAR_15M_MS;
      const limit = Math.min(1500, Math.ceil((nowMs - start) / BAR_15M_MS) + 2);
      bars = normalizeKlines(await client.getKlinesSince(symbol, "15m", start, limit));
    } catch (error) {
      result.errors.push(`${symbol}: ${safeError(error)}`);
      continue;
    }
    result.symbolsChecked += 1;
    for (const anchor of anchors) {
      const triggerAtMs = Date.parse(anchor.occurredAt);
      const last = signals.latestSignalAt("pullback_long", symbol);
      // One open trade per symbol: a trigger during an active 24h hold does not start another.
      if (last !== null && triggerAtMs < last + rules.holdMs) {
        signals.setAnchorStatus(anchor.id, symbol, "skipped_active", nowMs);
        continue;
      }
      const evaluation = evaluatePullback({ triggerAtMs, bars15m: bars, nowMs, rules });
      if (evaluation.status === "waiting") continue;
      if (evaluation.status !== "filled") {
        signals.setAnchorStatus(anchor.id, symbol, evaluation.status === "rejected" ? `rejected_${evaluation.reason}` : "expired", nowMs);
        continue;
      }
      const signalAt = new Date(evaluation.entryAtMs).toISOString();
      const signal: MarketSignal = {
        id: `pullback_long:${symbol}:${signalAt}`,
        kind: "pullback_long",
        symbol,
        signalAt,
        refPrice: evaluation.entryPrice,
        detail: {
          triggerEventId: anchor.id,
          triggerAt: anchor.occurredAt,
          triggerPrice: anchor.price,
          triggerLevel: anchor.level,
          triggerName: anchor.trigger,
          pre24hPct: Math.round(evaluation.pre24hPct * 100) / 100,
          highSinceTrigger: evaluation.highSinceTrigger,
          stopPrice: evaluation.stopPrice,
          pullbackPct: rules.pullbackPct,
        },
        outcome: null,
        pushed: false,
      };
      // Late discoveries (e.g. after a restart) are still recorded for statistics but never pushed.
      const fresh = nowMs - evaluation.entryAtMs <= rules.fillFreshMs;
      const event = fresh ? buildPullbackPushEvent(signal, rules) : null;
      if (signals.recordSignal(signal, nowMs, event)) {
        result.filled += 1;
        if (event) result.pushed += 1;
      }
      signals.setAnchorStatus(anchor.id, symbol, "filled", nowMs);
    }
  }
}

async function runOutcomes(input: {
  signals: MarketSignalsStore;
  client: BinanceMarketClient;
  nowMs: number;
  rules: MarketSignalRules;
  result: MarketSignalsCycleResult;
}) {
  const { signals, client, nowMs, rules, result } = input;
  if (!client.getKlinesSince) return;
  const jobs: Array<{ kind: MarketSignalKind; dueMs: number }> = [
    { kind: "pullback_long", dueMs: nowMs - rules.holdMs - BAR_15M_MS },
    { kind: "volatile_watch", dueMs: nowMs - rules.watchOutcomeMs - BAR_15M_MS },
    { kind: "coil_watch", dueMs: nowMs - rules.watchOutcomeMs - BAR_15M_MS },
  ];
  let budget = MAX_OUTCOMES_PER_CYCLE;
  for (const job of jobs) {
    for (const signal of signals.pendingOutcomes(job.kind, job.dueMs, budget)) {
      if (budget <= 0) return;
      budget -= 1;
      const startMs = Date.parse(signal.signalAt);
      const windowMs = job.kind === "pullback_long" ? rules.holdMs : rules.watchOutcomeMs;
      try {
        const bars = normalizeKlines(await client.getKlinesSince(signal.symbol, "15m", startMs, Math.round(windowMs / BAR_15M_MS) + 4));
        const outcome = job.kind === "pullback_long"
          ? computeTradeOutcome({ entryPrice: signal.refPrice, entryAtMs: startMs, bars15m: bars, nowMs, stopPct: rules.stopPct, holdMs: rules.holdMs })
          : computeWatchOutcome({ refPrice: signal.refPrice, startMs, bars15m: bars, nowMs, windowMs });
        if (outcome) {
          signals.setOutcome(signal.id, outcome);
          result.outcomes += 1;
        }
      } catch (error) {
        result.errors.push(`outcome ${signal.symbol}: ${safeError(error)}`);
      }
    }
  }
}

function excludedSymbol(symbol: string) {
  if (!symbol.endsWith("USDT")) return true;
  const base = symbol.slice(0, -4);
  return isStableOrFiatBase(base) || base === "BTC" || base === "ETH";
}

async function runPositioning(input: {
  signals: MarketSignalsStore;
  client: BinanceMarketClient;
  nowMs: number;
  rules: MarketSignalRules;
  result: MarketSignalsCycleResult;
}) {
  const { signals, client, nowMs, rules, result } = input;
  if (!client.getKlinesSince || !client.getHourlyOpenInterest || !client.getPremiumIndex) return;
  // The last fully closed hourly bar opened one hour before the current hour.
  const hourMs = Math.floor((nowMs - POSITIONING_SETTLE_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const meta = signals.readMeta();
  if (meta.lastPositioningHourMs !== null && meta.lastPositioningHourMs >= hourMs) return;

  const [tickers, premium] = await Promise.all([client.getTickers24h(), client.getPremiumIndex()]);
  const funding = new Map<string, number>();
  for (const row of premium) {
    const rate = Number(row.lastFundingRate);
    if (Number.isFinite(rate)) funding.set(String(row.symbol), rate);
  }
  const universe = tickers
    .filter((row) => Number(row.quoteVolume) >= rules.positioningMinQuoteVolume)
    .map((row) => String(row.symbol))
    .filter((symbol) => !excludedSymbol(symbol));

  let volatile = 0, coil = 0, stored = 0;
  for (const symbol of universe) {
    try {
      const [klineRows, oiRows] = await Promise.all([
        client.getKlinesSince(symbol, "1h", hourMs - 25 * HOUR_MS, 26),
        client.getHourlyOpenInterest(symbol, 26),
      ]);
      const oiByHour = new Map<number, number>();
      for (const row of oiRows) {
        const value = Number(row.sumOpenInterestValue);
        // OI snapshots are stamped at the hour boundary; align them with the bar that just closed.
        const stampHour = Math.floor(Number(row.timestamp) / HOUR_MS) * HOUR_MS - HOUR_MS;
        if (Number.isFinite(value)) oiByHour.set(stampHour, value);
      }
      const points: PositioningPoint[] = normalizeKlines(klineRows)
        .filter((bar) => bar.t <= hourMs)
        .map((bar) => ({ hourMs: bar.t, close: bar.c, oiValue: oiByHour.get(bar.t) ?? null }));
      if (!points.length || points.at(-1)!.hourMs !== hourMs) continue;
      const rate = funding.get(symbol) ?? null;
      signals.upsertPositioning(points.map((point) => ({ symbol, ...point, funding: point.hourMs === hourMs ? rate : null })));
      stored += 1;
      const state = classifyPositioning({ symbol, points, funding: rate, rules });
      if (!state) continue;
      const signalAt = new Date(hourMs + HOUR_MS).toISOString();
      const detail = {
        funding: state.funding,
        oi24hPct: state.oi24hPct === null ? null : Math.round(state.oi24hPct * 10) / 10,
        px4hPct: state.px4hPct === null ? null : Math.round(state.px4hPct * 10) / 10,
        px24hPct: state.px24hPct === null ? null : Math.round(state.px24hPct * 10) / 10,
      };
      for (const kind of ["coil_watch", "volatile_watch"] as const) {
        if (kind === "coil_watch" ? !state.coil : !state.volatile) continue;
        const last = signals.latestSignalAt(kind, symbol);
        if (last !== null && nowMs - last < rules.watchCooldownMs) continue;
        const recorded = signals.recordSignal({
          id: `${kind}:${symbol}:${signalAt}`,
          kind, symbol, signalAt, refPrice: state.close, detail, outcome: null, pushed: false,
        }, nowMs, null);
        if (recorded) { if (kind === "coil_watch") coil += 1; else volatile += 1; }
      }
    } catch (error) {
      result.errors.push(`positioning ${symbol}: ${safeError(error)}`);
    }
  }
  signals.prunePositioning(nowMs - rules.positioningRetentionMs);
  signals.markPositioning(hourMs, nowMs);
  result.positioning = { hourMs, symbols: stored, volatile, coil };
}

export async function runMarketSignalsCycle(input: {
  env?: EnvLike;
  nowMs?: number;
  alerts?: AlertsStore;
  signals?: MarketSignalsStore;
  client?: BinanceMarketClient;
} = {}): Promise<MarketSignalsCycleResult> {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const rules = getMarketSignalRules(env);
  const alerts = input.alerts ?? openMarketAlertsStore();
  const signals = input.signals ?? openMarketSignalsStore(marketSignalsDbPath(env));
  const client = input.client ?? createBinanceFuturesClient({}, { rateLimitStore: alerts });
  const result: MarketSignalsCycleResult = { anchors: 0, symbolsChecked: 0, filled: 0, pushed: 0, outcomes: 0, positioning: null, errors: [] };
  try {
    await runPullbackChecks({ alerts, signals, client, nowMs, rules, result });
    await runOutcomes({ signals, client, nowMs, rules, result });
    try {
      await runPositioning({ signals, client, nowMs, rules, result });
    } catch (error) {
      result.errors.push(`positioning: ${safeError(error)}`);
    }
    signals.markCycle({ nowMs, error: result.errors.length ? result.errors.slice(0, 3).join("; ") : null });
    return result;
  } catch (error) {
    signals.markCycle({ nowMs, error: safeError(error) });
    throw error;
  } finally {
    if (!input.signals) signals.close();
    if (!input.alerts) alerts.close();
  }
}
