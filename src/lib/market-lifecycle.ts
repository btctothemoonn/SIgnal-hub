import type { DatabaseSync } from "node:sqlite";
import { isStableOrFiatBase } from "./market-alerts-core.ts";

export const LIFECYCLE_BAR_MS = 15 * 60_000;
const DAY = 96 * LIFECYCLE_BAR_MS;
const SEED_BARS = 290; // Three days: baseline, state warmup, and a full board window.
export type LifecycleBar = { at: number; high: number; low: number; close: number };
type Point = { id: string; symbol: string; at: number; price: number };
export type MarketLifecycleEvent =
  | (Point & { kind: "startup"; hourPct: number; relativePct: number; gainFromLowPct: number })
  | (Point & { kind: "pumped"; gainFromLowPct: number })
  | (Point & { kind: "weakening"; pumpAt: number; peakPrice: number; peakGainPct: number;
    drawdownPct: number; supportPrice: number; retestAt?: number; retestPrice?: number });

type Weakening = Extract<MarketLifecycleEvent, { kind: "weakening" }>;
type Pump = { at: number; base: number; peak: number; weak?: Weakening;
  broken?: { at: number; support: number; testedClose?: number } };
type State = { at: number; hot: boolean; pump: Pump | null };
const freshState = (): State => ({ at: 0, hot: false, pump: null });

function range(bars: LifecycleBar[], start: number, end: number, key: "high" | "low" | "close", max: boolean) {
  let value = bars[start][key];
  for (let i = start + 1; i < end; i++) value = max ? Math.max(value, bars[i][key]) : Math.min(value, bars[i][key]);
  return value;
}

// Input bars are closed, strictly ordered and unique by exchange close boundary.
function advance(symbol: string, bars: LifecycleBar[], state: State) {
  const changes: MarketLifecycleEvent[] = [];
  const candidates: { symbol: string; at: number; price: number; gainFromLowPct: number; hourPct: number }[] = [];
  let runStart = 0;
  for (let i = 0; i < bars.length; i++) {
    const { at, high, close: price } = bars[i];
    if (i && at !== bars[i - 1].at + LIFECYCLE_BAR_MS) runStart = i;
    if (at <= state.at || i - runStart < 96) continue;
    if (state.at !== at - LIFECYCLE_BAR_MS) {
      // A gap can hide both a peak and a breakout. Require complete history before resuming.
      state.pump = null;
      if (i - runStart < 97) continue;
      state.hot = bars[i - 1].close >= 1.20 * range(bars, i - 97, i - 1, "close", false);
    }
    const base = range(bars, i - 96, i, "close", false);
    const gainFromLowPct = 100 * (price / base - 1);
    const hot = price >= 1.20 * base;
    if (state.pump && at > state.pump.at + DAY) state.pump = null;
    const point = { symbol, at, price };
    if (!state.pump && hot && !state.hot) {
      state.pump = { at, base, peak: price };
      changes.push({ ...point, kind: "pumped", id: `pumped:${symbol}:${at}`, gainFromLowPct });
    }
    const pump = state.pump;
    if (pump && at > pump.at) {
      pump.peak = Math.max(price, pump.peak);
      const drawdownPct = 100 * (1 - price / pump.peak);
      const broken = pump.broken;
      if (broken && (at - broken.at > 8 * LIFECYCLE_BAR_MS || price >= broken.support)) {
        delete pump.broken;
      } else if (broken && pump.weak && !pump.weak.retestAt) {
        if (broken.testedClose !== undefined && price < broken.testedClose) {
          pump.weak = { ...pump.weak, retestAt: at, retestPrice: price };
          changes.push(pump.weak);
        } else if (broken.testedClose === undefined && high >= broken.support * 0.99) {
          broken.testedClose = price;
        }
      }
      const supportPrice = range(bars, i - 4, i, "low", false);
      if (!pump.broken && drawdownPct >= 8 && price < supportPrice) {
        pump.broken = { at, support: supportPrice };
        if (!pump.weak) {
          pump.weak = { ...point, kind: "weakening", id: `weakening:${symbol}:${at}`, pumpAt: pump.at,
            peakPrice: pump.peak, peakGainPct: 100 * (pump.peak / pump.base - 1), drawdownPct, supportPrice };
          changes.push(pump.weak);
        }
      }
    } else if (!pump && price < base * 1.10) {
      const hourPct = 100 * (price / bars[i - 4].close - 1);
      if (hourPct >= 3 && price > range(bars, i - 16, i, "high", true)) {
        candidates.push({ ...point, gainFromLowPct, hourPct });
      }
    }
    state.at = at;
    state.hot = hot;
  }
  return { changes, candidates };
}

function marketMedians(series: Map<string, LifecycleBar[]>) {
  const observations = new Map<number, number[]>();
  for (const bars of series.values()) {
    for (let i = 4; i < bars.length; i++) {
      const { at, close } = bars[i];
      if (at - bars[i - 4].at !== 4 * LIFECYCLE_BAR_MS) continue;
      const points = observations.get(at) ?? [];
      points.push(100 * (close / bars[i - 4].close - 1));
      observations.set(at, points);
    }
  }
  const result = new Map<number, number>();
  for (const [at, points] of observations) {
    if (points.length < 40) continue;
    points.sort((a, b) => a - b);
    result.set(at, (points[(points.length - 1) >> 1] + points[points.length >> 1]) / 2);
  }
  return result;
}

function parseBar(row: unknown[], end: number): LifecycleBar | null {
  const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim()) ? Number(v) : NaN;
  const [openAt, open, high, low, close, , lastMs] = row.map(numeric);
  const at = openAt + LIFECYCLE_BAR_MS;
  if (!Number.isSafeInteger(at) || openAt < 0 || openAt % LIFECYCLE_BAR_MS || lastMs !== at - 1 || at > end ||
      ![high, low, open, close].every(Number.isFinite) || low <= 0 || low > Math.min(open, close) ||
      high < Math.max(open, close)) return null;
  return { at, high, low, close };
}

export function createMarketLifecycleStore(db: DatabaseSync, transaction: <T>(work: () => T) => T) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_lifecycle_bars (
      symbol TEXT NOT NULL, at INTEGER NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      PRIMARY KEY(symbol,at)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS market_lifecycle_state (
      symbol TEXT PRIMARY KEY, at INTEGER NOT NULL, pump_at INTEGER, state_json TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS market_lifecycle_events (
      symbol TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, event_json TEXT NOT NULL,
      PRIMARY KEY(symbol,kind,at)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS market_lifecycle_candidates (
      symbol TEXT NOT NULL, at INTEGER NOT NULL, price REAL NOT NULL, gain REAL NOT NULL, hour REAL NOT NULL,
      PRIMARY KEY(symbol,at)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS market_lifecycle_repairs (
      symbol TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL DEFAULT 0, failed_at INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS market_lifecycle_events_at ON market_lifecycle_events(at);
  `);
  const insertBar = db.prepare("INSERT OR IGNORE INTO market_lifecycle_bars VALUES (?,?,?,?,?)");
  const saveState = db.prepare("INSERT OR REPLACE INTO market_lifecycle_state VALUES (?,?,?,?)");
  const saveEvent = db.prepare(`INSERT INTO market_lifecycle_events VALUES(?,?,?,?)
    ON CONFLICT(symbol,kind,at) DO UPDATE SET event_json=excluded.event_json`);
  const list = db.prepare("SELECT event_json FROM market_lifecycle_events WHERE at BETWEEN ? AND ? ORDER BY at DESC,symbol,kind");
  const readState = db.prepare("SELECT state_json FROM market_lifecycle_state WHERE symbol=?");
  const recentBars = db.prepare("SELECT at,high,low,close FROM market_lifecycle_bars WHERE symbol=? AND at BETWEEN ? AND ? ORDER BY at");
  const coverage = db.prepare(`SELECT MIN(at) AS first, MAX(at) AS last, COUNT(*) AS count
    FROM market_lifecycle_bars WHERE symbol=? AND at BETWEEN ? AND ?`);
  const lastRepair = db.prepare("SELECT attempted_at, failed_at FROM market_lifecycle_repairs WHERE symbol=?");
  const setRepair = db.prepare("INSERT OR REPLACE INTO market_lifecycle_repairs (symbol,attempted_at) VALUES(?,?)");
  const failedRepair = db.prepare(`INSERT INTO market_lifecycle_repairs (symbol,failed_at) VALUES(?,?)
    ON CONFLICT(symbol) DO UPDATE SET failed_at=excluded.failed_at`);
  const saveCandidate = db.prepare("INSERT OR IGNORE INTO market_lifecycle_candidates VALUES(?,?,?,?,?)");
  const pending = db.prepare("SELECT * FROM market_lifecycle_candidates ORDER BY at,symbol");
  const forget = db.prepare("DELETE FROM market_lifecycle_candidates WHERE symbol=? AND at=?");
  const nearStartup = db.prepare("SELECT 1 FROM market_lifecycle_events WHERE symbol=? AND kind='startup' AND at>? AND at<? LIMIT 1");
  const activeSymbols = db.prepare(`SELECT DISTINCT symbol FROM market_card_minutes WHERE observe_volume=1 AND at BETWEEN ? AND ?
    UNION SELECT symbol FROM market_lifecycle_state WHERE pump_at>=?`);
  // A local quarter counts only if every one of its 15 whole, eligible minutes is present.
  const local = db.prepare(`WITH mins AS (
      SELECT symbol,at,(at / 900000 + 1)*900000 AS boundary,high,low,close
      FROM market_card_minutes WHERE observe_volume=1 AND at>=? AND at<?
    )
    SELECT symbol,boundary AS at,MAX(high) AS high,MIN(low) AS low,MAX(CASE WHEN at=boundary-60000 THEN close END) AS close
    FROM mins GROUP BY symbol,boundary HAVING COUNT(*)=15 ORDER BY symbol,boundary`);
  function listLifecycleEvents(from: number, to: number): MarketLifecycleEvent[] {
    return list.all(from, to).map(row => {
      const event = JSON.parse(String(row.event_json)) as MarketLifecycleEvent;
      if (event.kind === "weakening" && event.retestAt !== undefined && event.retestAt > to) {
        delete event.retestAt;
        delete event.retestPrice;
      }
      return event;
    });
  }
  function targets(end: number) {
    return activeSymbols.all(end - 30 * 60_000, end, end - DAY).map(row => String(row.symbol));
  }
  function storeBars(symbol: string, bars: LifecycleBar[]) {
    transaction(() => {
      for (const b of bars) insertBar.run(symbol, b.at, b.high, b.low, b.close);
    });
  }
  function localBars(end: number) {
    const result = new Map<string, LifecycleBar[]>();
    for (const row of local.all(end - 75 * 60_000, end)) {
      const symbol = String(row.symbol);
      const bars = result.get(symbol) ?? [];
      bars.push({ at: Number(row.at), high: Number(row.high), low: Number(row.low), close: Number(row.close) });
      result.set(symbol, bars);
    }
    return result;
  }
  function evaluate(symbols: string[], end: number) {
    const series = new Map<string, LifecycleBar[]>();
    const start = end - (SEED_BARS - 1) * LIFECYCLE_BAR_MS;
    for (const symbol of symbols) series.set(symbol, recentBars.all(symbol, start, end) as LifecycleBar[]);
    const medians = marketMedians(series);
    let events = 0;
    for (const [symbol, bars] of series) {
      if (bars.length < 97) continue;
      transaction(() => {
        const row = readState.get(symbol);
        const state: State = row ? JSON.parse(String(row.state_json)) : freshState();
        const before = state.at;
        if (before >= bars[bars.length - 1].at) return;
        const { changes, candidates } = advance(symbol, bars, state);
        for (const c of candidates) saveCandidate.run(symbol, c.at, c.price, c.gainFromLowPct, c.hourPct);
        for (const e of changes) saveEvent.run(symbol, e.kind, e.at, JSON.stringify(e));
        if (state.at !== before) saveState.run(symbol, state.at, state.pump?.at ?? null, JSON.stringify(state));
        events += changes.length;
      });
    }
    transaction(() => {
      // Finish startup checks independently so a missing breadth sample never blocks pump tracking.
      for (const row of pending.all()) {
        const symbol = String(row.symbol), at = Number(row.at), hourPct = Number(row.hour);
        const median = medians.get(at);
        if (median === undefined) continue;
        if (hourPct - median >= 2 && !nearStartup.get(symbol, at - DAY, at + DAY)) {
          const e: MarketLifecycleEvent = { id: `startup:${symbol}:${at}`, symbol, kind: "startup", at,
            price: Number(row.price), hourPct, relativePct: hourPct - median, gainFromLowPct: Number(row.gain) };
          saveEvent.run(symbol, e.kind, at, JSON.stringify(e));
          events++;
        }
        forget.run(symbol, at);
      }
      db.prepare("DELETE FROM market_lifecycle_candidates WHERE at<?").run(start);
      db.prepare("DELETE FROM market_lifecycle_repairs WHERE MAX(attempted_at,failed_at)<?").run(start);
      db.prepare("DELETE FROM market_lifecycle_bars WHERE at<?").run(start);
      db.prepare("DELETE FROM market_lifecycle_state WHERE at<?").run(end - 7 * DAY);
      db.prepare("DELETE FROM market_lifecycle_events WHERE at<?").run(end - 30 * DAY);
    });
    return events;
  }
  function candleCoverage(symbol: string, end: number) {
    const row = coverage.get(symbol, end - (SEED_BARS - 1) * LIFECYCLE_BAR_MS, end)!;
    const last = Number(row.last), count = Number(row.count);
    const hole = count > 0 && (last - Number(row.first)) / LIFECYCLE_BAR_MS + 1 !== count;
    const previous = lastRepair.get(symbol);
    const repairDue = (count < 98 || hole) && end - Number(previous?.attempted_at ?? 0) >= 4 * LIFECYCLE_BAR_MS;
    return { last, repairDue, recentlyFailed: Number(previous?.failed_at ?? 0) >= end };
  }
  return { listLifecycleEvents, lifecycle: { targets, storeBars, localBars, evaluate, candleCoverage,
    markRepair: (symbol: string, end: number) => { setRepair.run(symbol, end); },
    markFailure: (symbol: string, end: number) => { failedRepair.run(symbol, end); },
  } };
}

type Store = ReturnType<typeof createMarketLifecycleStore>["lifecycle"];
export async function runLifecycleObservations(input: {
  store: Store; coinSymbols: Set<string>; nowMs: number;
  getKlines: (symbol: string, interval: "15m", limit: number) => Promise<unknown[][]>;
  errors: string[];
}) {
  const { store, nowMs, coinSymbols } = input;
  // Leave the minute WS collector time to flush the last minute. REST also uses this exact closed boundary.
  const end = Math.floor((nowMs - 45_000) / LIFECYCLE_BAR_MS) * LIFECYCLE_BAR_MS;
  const symbols = store.targets(end).filter(symbol => coinSymbols.has(symbol) &&
    symbol.endsWith("USDT") && !isStableOrFiatBase(symbol.slice(0, -4)) &&
    !["BTCUSDT", "ETHUSDT", "PAXGUSDT", "XAUTUSDT"].includes(symbol));
  if (!symbols.length) return;
  const local = store.localBars(end);
  let failures = 0;
  for (const symbol of symbols) {
    const { last: latest, repairDue, recentlyFailed } = store.candleCoverage(symbol, end);
    if (latest >= end && !repairDue) continue;
    const bars = (local.get(symbol) ?? []).filter(b => b.at > latest);
    if (!repairDue && bars.length && bars[0].at === latest + LIFECYCLE_BAR_MS && bars.at(-1)!.at === end &&
        bars.length * LIFECYCLE_BAR_MS === end - latest) {
      store.storeBars(symbol, bars);
      continue;
    }
    // Start with three days once. After a discontinuity request only the missing tail.
    // Bound network retries during an exchange outage; local complete bars remain usable.
    if (recentlyFailed || failures >= 3) {
      if (latest && bars.length) store.storeBars(symbol, bars);
      continue;
    }
    const limit = repairDue || !latest ? SEED_BARS : Math.min(SEED_BARS, Math.ceil((nowMs - latest) / LIFECYCLE_BAR_MS) + 1);
    try {
      const rows = await input.getKlines(symbol, "15m", limit);
      const closed = rows.map(row => parseBar(row, end)).filter((bar): bar is LifecycleBar => bar !== null);
      store.storeBars(symbol, closed);
      if (closed.length === 0) store.markFailure(symbol, end);
      else if (repairDue) store.markRepair(symbol, end);
    } catch (error) {
      store.markFailure(symbol, end);
      failures += /429|418/.test(String(error)) ? 3 : 1;
      input.errors.push(`lifecycle ${symbol}: ${String(error).slice(0, 200)}`);
    }
  }
  store.evaluate(symbols, end);
}
