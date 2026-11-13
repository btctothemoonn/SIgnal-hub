import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createImportantPushOutbox } from "./important-push-outbox.ts";
import type { EnvLike, PushEvent } from "./important-push-types.ts";
import { createAlertOutcomeRepo, summarizeAlertOutcomes, type AlertOutcomeGroupStats } from "./market-alert-outcomes.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

// Rules come from the 2026-08-31..11-11 backtest documented in docs/market-signals.md.
// Every threshold can be overridden by env so tuning does not need a code change.
export const MARKET_SIGNAL_RULE_VERSION = "market-signals-v1";
const HOUR_MS = 60 * 60_000;
const BAR_15M_MS = 15 * 60_000;

function envNumber(env: EnvLike, key: string, fallback: number) {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getMarketSignalRules(env: EnvLike = process.env) {
  return {
    pullbackPct: envNumber(env, "MARKET_SIGNAL_PULLBACK_PCT", 12),
    pullbackWindowMs: envNumber(env, "MARKET_SIGNAL_PULLBACK_WINDOW_HOURS", 12) * HOUR_MS,
    maxPre24hPct: envNumber(env, "MARKET_SIGNAL_MAX_PRE24H_PCT", 10),
    stopPct: envNumber(env, "MARKET_SIGNAL_STOP_PCT", 8),
    holdMs: 24 * HOUR_MS,
    fillFreshMs: envNumber(env, "MARKET_SIGNAL_FILL_FRESH_MINUTES", 30) * 60_000,
    pushTtlMs: 30 * 60_000,
    volatileFundingMax: envNumber(env, "MARKET_SIGNAL_VOLATILE_FUNDING_MAX", -0.001),
    volatileOi24hMinPct: envNumber(env, "MARKET_SIGNAL_VOLATILE_OI24H_PCT", 30),
    coilOi24hMinPct: envNumber(env, "MARKET_SIGNAL_COIL_OI24H_PCT", 30),
    coilMaxAbsPx4hPct: envNumber(env, "MARKET_SIGNAL_COIL_MAX_PX4H_PCT", 3),
    coilMaxPx24hPct: envNumber(env, "MARKET_SIGNAL_COIL_MAX_PX24H_PCT", 10),
    watchOutcomeMs: 12 * HOUR_MS,
    watchCooldownMs: 12 * HOUR_MS,
    positioningMinQuoteVolume: envNumber(env, "MARKET_SIGNAL_POSITIONING_MIN_QUOTE_VOLUME", 5_000_000),
    positioningRetentionMs: 180 * 24 * HOUR_MS,
    btcShortWarningPct: envNumber(env, "MARKET_SIGNAL_BTC_SHORT_WARNING_PCT", -1.7),
    statsWindowMs: 30 * 24 * HOUR_MS,
    legacyPushFilter: (env.MARKET_SIGNAL_LEGACY_PUSH_FILTER ?? "true").trim().toLowerCase() !== "false",
    aiEnabled: (env.MARKET_SIGNAL_AI_ENABLED ?? "true").trim().toLowerCase() !== "false",
    aiNotesPerCycle: envNumber(env, "MARKET_SIGNAL_AI_NOTES_PER_CYCLE", 3),
    aiMaxAttempts: 2,
    aiNoteWindowMs: 6 * HOUR_MS,
  };
}
export type MarketSignalRules = ReturnType<typeof getMarketSignalRules>;

export type Bar = { t: number; o: number; h: number; l: number; c: number };

export function normalizeKlines(rows: unknown[]): Bar[] {
  const bars: Bar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const bar = { t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]) };
    if ([bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) && bar.o > 0) bars.push(bar);
  }
  return bars.sort((a, b) => a.t - b.t);
}

export function closedBars(bars: Bar[], intervalMs: number, nowMs: number) {
  return bars.filter((bar) => bar.t + intervalMs <= nowMs);
}

function firstIndexAtOrAfter(bars: Bar[], t: number) {
  let lo = 0, hi = bars.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t >= t) { found = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return found;
}

export type PullbackEvaluation =
  | { status: "waiting"; pre24hPct: number | null; highSinceTrigger: number | null }
  | { status: "rejected"; reason: "pre24h" | "history_missing"; pre24hPct: number | null }
  | { status: "expired"; pre24hPct: number; highSinceTrigger: number }
  | {
    status: "filled";
    pre24hPct: number;
    highSinceTrigger: number;
    entryPrice: number;
    stopPrice: number;
    entryAtMs: number;
  };

// Entry rule: a pump trigger whose prior 24h move was small, then a pullback of pullbackPct from the
// highest price since the trigger, within pullbackWindowMs. Only closed 15m bars are used.
export function evaluatePullback(input: {
  triggerAtMs: number;
  bars15m: Bar[];
  nowMs: number;
  rules: MarketSignalRules;
}): PullbackEvaluation {
  const bars = closedBars(input.bars15m, BAR_15M_MS, input.nowMs);
  const start = firstIndexAtOrAfter(bars, input.triggerAtMs + 1);
  if (start < 0) return { status: "waiting", pre24hPct: null, highSinceTrigger: null };
  const back = firstIndexAtOrAfter(bars, bars[start].t - 24 * HOUR_MS);
  if (back < 0 || bars[back].t !== bars[start].t - 24 * HOUR_MS) {
    return { status: "rejected", reason: "history_missing", pre24hPct: null };
  }
  const pre24hPct = (bars[start].o / bars[back].o - 1) * 100;
  if (pre24hPct >= input.rules.maxPre24hPct) return { status: "rejected", reason: "pre24h", pre24hPct };
  const windowBars = Math.round(input.rules.pullbackWindowMs / BAR_15M_MS);
  let high = bars[start].o;
  for (let k = start; k < Math.min(bars.length, start + windowBars); k += 1) {
    high = Math.max(high, bars[k].h);
    const level = high * (1 - input.rules.pullbackPct / 100);
    if (bars[k].l <= level) {
      return {
        status: "filled",
        pre24hPct,
        highSinceTrigger: high,
        entryPrice: level,
        stopPrice: level * (1 - input.rules.stopPct / 100),
        entryAtMs: bars[k].t + BAR_15M_MS,
      };
    }
  }
  const windowEnd = bars[start].t + windowBars * BAR_15M_MS;
  if (input.nowMs >= windowEnd) return { status: "expired", pre24hPct, highSinceTrigger: high };
  return { status: "waiting", pre24hPct, highSinceTrigger: high };
}

export type TradeOutcome = { returnPct: number; stopHit: boolean; maxUpPct: number; maxDownPct: number; closedAt: string };

export function computeTradeOutcome(input: {
  entryPrice: number;
  entryAtMs: number;
  bars15m: Bar[];
  nowMs: number;
  stopPct: number;
  holdMs: number;
  feePct?: number;
}): TradeOutcome | null {
  const bars = closedBars(input.bars15m, BAR_15M_MS, input.nowMs).filter((bar) => bar.t >= input.entryAtMs);
  const needed = Math.round(input.holdMs / BAR_15M_MS);
  if (bars.length < needed) return null;
  const window = bars.slice(0, needed);
  const stop = input.entryPrice * (1 - input.stopPct / 100);
  let maxUp = 0, maxDown = 0, stopHit = false;
  for (const bar of window) {
    maxUp = Math.max(maxUp, (bar.h / input.entryPrice - 1) * 100);
    maxDown = Math.min(maxDown, (bar.l / input.entryPrice - 1) * 100);
    if (!stopHit && bar.l <= stop) stopHit = true;
  }
  const last = window[window.length - 1];
  const fee = input.feePct ?? 0.1;
  const returnPct = stopHit ? -input.stopPct - fee : (last.c / input.entryPrice - 1) * 100 - fee;
  return { returnPct, stopHit, maxUpPct: maxUp, maxDownPct: maxDown, closedAt: new Date(last.t + BAR_15M_MS).toISOString() };
}

export type WatchOutcome = { upPct: number; downPct: number; launched: boolean; crashed: boolean; upFirst: boolean; closedAt: string };

// Direction-neutral follow-up for volatility watches: did price move 15% either way within the window?
export function computeWatchOutcome(input: { refPrice: number; startMs: number; bars15m: Bar[]; nowMs: number; windowMs: number }): WatchOutcome | null {
  const bars = closedBars(input.bars15m, BAR_15M_MS, input.nowMs).filter((bar) => bar.t >= input.startMs);
  const needed = Math.round(input.windowMs / BAR_15M_MS);
  if (bars.length < needed) return null;
  let up = 0, down = 0, firstHit: "up" | "down" | null = null;
  for (const bar of bars.slice(0, needed)) {
    up = Math.max(up, (bar.h / input.refPrice - 1) * 100);
    down = Math.min(down, (bar.l / input.refPrice - 1) * 100);
    if (!firstHit) {
      const hitUp = bar.h >= input.refPrice * 1.15;
      const hitDown = bar.l <= input.refPrice * 0.92;
      if (hitUp && !hitDown) firstHit = "up";
      else if (hitDown) firstHit = "down";
    }
  }
  return {
    upPct: up,
    downPct: down,
    launched: up >= 15,
    crashed: down <= -15,
    upFirst: firstHit === "up",
    closedAt: new Date(bars[needed - 1].t + BAR_15M_MS).toISOString(),
  };
}

export type PositioningPoint = { hourMs: number; close: number; oiValue: number | null };

export type PositioningState = {
  symbol: string;
  hourMs: number;
  close: number;
  funding: number | null;
  oi24hPct: number | null;
  px4hPct: number | null;
  px24hPct: number | null;
  volatile: boolean;
  coil: boolean;
};

// points: hourly closes keyed by the hour the bar opened, ascending. Evaluated at the latest point.
export function classifyPositioning(input: {
  symbol: string;
  points: PositioningPoint[];
  funding: number | null;
  rules: MarketSignalRules;
}): PositioningState | null {
  const points = [...input.points].sort((a, b) => a.hourMs - b.hourMs);
  const latest = points.at(-1);
  if (!latest) return null;
  const at = (hoursBack: number) => points.find((point) => point.hourMs === latest.hourMs - hoursBack * HOUR_MS) ?? null;
  const p4 = at(4), p24 = at(24);
  const pct = (now: number | null | undefined, then: number | null | undefined) =>
    now && then && then > 0 ? (now / then - 1) * 100 : null;
  const oi24hPct = pct(latest.oiValue, p24?.oiValue);
  const px4hPct = pct(latest.close, p4?.close);
  const px24hPct = pct(latest.close, p24?.close);
  const r = input.rules;
  const volatile =
    (input.funding !== null && input.funding <= r.volatileFundingMax) ||
    (oi24hPct !== null && oi24hPct >= r.volatileOi24hMinPct);
  const coil =
    oi24hPct !== null && px4hPct !== null && px24hPct !== null &&
    oi24hPct >= r.coilOi24hMinPct &&
    Math.abs(px4hPct) < r.coilMaxAbsPx4hPct &&
    px24hPct < r.coilMaxPx24hPct;
  return { symbol: input.symbol, hourMs: latest.hourMs, close: latest.close, funding: input.funding, oi24hPct, px4hPct, px24hPct, volatile, coil };
}

export type MarketSignalKind = "pullback_long" | "volatile_watch" | "coil_watch";

export type MarketSignal = {
  id: string;
  kind: MarketSignalKind;
  symbol: string;
  signalAt: string;
  refPrice: number;
  detail: Record<string, number | string | boolean | null>;
  outcome: (TradeOutcome | WatchOutcome) | null;
  pushed: boolean;
  aiNote?: string | null;
};

export type MarketSignalStats = {
  kind: MarketSignalKind;
  n: number;
  winRate: number | null;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  launchRate: number | null;
  crashRate: number | null;
  upFirstRate: number | null;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export function summarizeSignals(signals: MarketSignal[], kind: MarketSignalKind): MarketSignalStats {
  const done = signals.filter((signal) => signal.kind === kind && signal.outcome);
  const rate = (predicate: (signal: MarketSignal) => boolean) => (done.length ? done.filter(predicate).length / done.length : null);
  if (kind === "pullback_long") {
    const returns = done.map((signal) => (signal.outcome as TradeOutcome).returnPct);
    return {
      kind, n: done.length,
      winRate: rate((signal) => (signal.outcome as TradeOutcome).returnPct > 0),
      meanReturnPct: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null,
      medianReturnPct: median(returns),
      launchRate: null, crashRate: null, upFirstRate: null,
    };
  }
  return {
    kind, n: done.length, winRate: null, meanReturnPct: null, medianReturnPct: null,
    launchRate: rate((signal) => (signal.outcome as WatchOutcome).launched),
    crashRate: rate((signal) => (signal.outcome as WatchOutcome).crashed),
    upFirstRate: rate((signal) => (signal.outcome as WatchOutcome).upFirst),
  };
}

function trimPrice(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return Number(value.toPrecision(4)).toString();
}

export function buildPullbackPushEvent(signal: MarketSignal, rules: MarketSignalRules): PushEvent {
  const base = signal.symbol.replace(/USDT$/, "");
  const stop = Number(signal.detail.stopPrice);
  return {
    id: `signals:${signal.id}`,
    source: "signals",
    episodeId: `signals:${signal.id}`,
    stage: "pullback_entry",
    priority: 0,
    title: `${base} 回调买点`,
    body: `暴涨后回调 ${rules.pullbackPct}%，参考价 ${trimPrice(signal.refPrice)}，止损 ${trimPrice(stop)}（-${rules.stopPct}%）。历史胜率约三成半，靠少数大涨盈利，需严格止损。`,
    target: "/alerts",
    occurredAt: signal.signalAt,
    expiresAt: new Date(Date.parse(signal.signalAt) + rules.pushTtlMs).toISOString(),
    sourcePublishedAt: signal.signalAt,
    ruleVersion: MARKET_SIGNAL_RULE_VERSION,
    evidence: [
      `symbol=${signal.symbol}`,
      `entry=${signal.refPrice}`,
      `stop=${stop}`,
      `pre24hPct=${signal.detail.pre24hPct}`,
      `triggerAt=${signal.detail.triggerAt}`,
    ],
  };
}

// Legacy opportunity/squeeze pushes pass only if they agree with the backtested rules: long pushes
// (pump chasing and squeeze longs) lost money, and shorts are skipped once BTC already fell sharply.
export function legacyMarketPushAllowed(input: { direction: "LONG" | "SHORT"; btc24hPct: number | null; rules: MarketSignalRules }) {
  if (input.direction === "LONG") return false;
  if (input.btc24hPct !== null && input.btc24hPct <= input.rules.btcShortWarningPct) return false;
  return true;
}

export function marketSignalsDbPath(env: EnvLike = process.env) {
  return env.MARKET_SIGNALS_DB?.trim() || getRuntimeDataPath(env, "market-alerts", "signals.sqlite");
}

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? (JSON.parse(value) as T) : fallback; } catch { return fallback; }
}

function rowToSignal(row: Row): MarketSignal {
  return {
    id: String(row.id),
    kind: String(row.kind) as MarketSignalKind,
    symbol: String(row.symbol),
    signalAt: String(row.signal_at),
    refPrice: Number(row.ref_price),
    detail: parseJson(row.detail_json, {}),
    outcome: parseJson(row.outcome_json, null),
    pushed: Number(row.pushed) === 1,
    aiNote: typeof row.ai_note === "string" && row.ai_note ? row.ai_note : null,
  };
}

export function openMarketSignalsStore(path = marketSignalsDbPath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout must be set first: several processes open this file at startup and the WAL switch needs a lock.
  db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;");
  const outbox = createImportantPushOutbox(db);
  const alertOutcomes = createAlertOutcomeRepo(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_signals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      symbol TEXT NOT NULL,
      signal_at TEXT NOT NULL,
      ref_price REAL NOT NULL,
      detail_json TEXT NOT NULL,
      outcome_json TEXT,
      pushed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      ai_note TEXT,
      ai_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_market_signals_kind_time ON market_signals(kind, signal_at);
    CREATE INDEX IF NOT EXISTS idx_market_signals_symbol_time ON market_signals(symbol, kind, signal_at);
    CREATE TABLE IF NOT EXISTS market_signal_anchors (
      event_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_positioning_hourly (
      symbol TEXT NOT NULL,
      hour_ms INTEGER NOT NULL,
      close REAL NOT NULL,
      oi_value REAL,
      funding REAL,
      PRIMARY KEY(symbol, hour_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_market_positioning_hour ON market_positioning_hourly(hour_ms);
    CREATE TABLE IF NOT EXISTS market_symbol_class (
      symbol TEXT PRIMARY KEY,
      underlying_type TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_signal_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_cycle_at TEXT,
      last_success_at TEXT,
      last_positioning_hour_ms INTEGER,
      last_positioning_at TEXT,
      last_error TEXT,
      last_error_at TEXT
    );
    INSERT OR IGNORE INTO market_signal_meta(id) VALUES (1);
  `);

  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE;");
    try { const value = fn(); db.exec("COMMIT;"); return value; } catch (error) { db.exec("ROLLBACK;"); throw error; }
  }

  return {
    alertOutcomes,
    anchorStatuses(eventIds: string[]) {
      const out = new Map<string, string>();
      const stmt = db.prepare("SELECT status FROM market_signal_anchors WHERE event_id=?");
      for (const id of eventIds) {
        const row = stmt.get(id) as Row | undefined;
        if (row) out.set(id, String(row.status));
      }
      return out;
    },
    setAnchorStatus(eventId: string, symbol: string, status: string, nowMs: number) {
      db.prepare(`INSERT INTO market_signal_anchors(event_id,symbol,status,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`)
        .run(eventId, symbol, status, new Date(nowMs).toISOString());
    },
    latestSignalAt(kind: MarketSignalKind, symbol: string) {
      const row = db.prepare("SELECT MAX(signal_at) AS value FROM market_signals WHERE kind=? AND symbol=?").get(kind, symbol) as Row;
      const ms = Date.parse(String(row?.value ?? ""));
      return Number.isFinite(ms) ? ms : null;
    },
    // Records the signal and, when requested, its push event in one transaction. Returns false on duplicates.
    recordSignal(signal: MarketSignal, nowMs: number, pushEvent?: PushEvent | null) {
      return transaction(() => {
        const result = db.prepare(`INSERT OR IGNORE INTO market_signals
          (id,kind,symbol,signal_at,ref_price,detail_json,outcome_json,pushed,created_at) VALUES (?,?,?,?,?,?,NULL,?,?)`)
          .run(signal.id, signal.kind, signal.symbol, signal.signalAt, signal.refPrice, JSON.stringify(signal.detail), pushEvent ? 1 : 0, new Date(nowMs).toISOString());
        if (Number(result.changes) === 0) return false;
        if (pushEvent) outbox.appendEvent(pushEvent);
        return true;
      });
    },
    pendingOutcomes(kind: MarketSignalKind, dueBeforeMs: number, limit: number) {
      return db.prepare("SELECT * FROM market_signals WHERE kind=? AND outcome_json IS NULL AND signal_at<=? ORDER BY signal_at LIMIT ?")
        .all(kind, new Date(dueBeforeMs).toISOString(), limit)
        .map((row) => rowToSignal(row as Row));
    },
    setOutcome(id: string, outcome: TradeOutcome | WatchOutcome) {
      db.prepare("UPDATE market_signals SET outcome_json=? WHERE id=?").run(JSON.stringify(outcome), id);
    },
    pendingNotes(kinds: MarketSignalKind[], sinceMs: number, maxAttempts: number, limit: number) {
      const placeholders = kinds.map(() => "?").join(",");
      return db.prepare(`SELECT * FROM market_signals WHERE kind IN (${placeholders}) AND ai_note IS NULL
          AND ai_attempts<? AND signal_at>=? ORDER BY signal_at DESC LIMIT ?`)
        .all(...kinds, maxAttempts, new Date(sinceMs).toISOString(), limit)
        .map((row) => rowToSignal(row as Row));
    },
    recordNoteAttempt(id: string, note: string | null) {
      db.prepare("UPDATE market_signals SET ai_attempts=ai_attempts+1, ai_note=COALESCE(?, ai_note) WHERE id=?").run(note, id);
    },
    listSignals(sinceMs: number) {
      return db.prepare("SELECT * FROM market_signals WHERE signal_at>=? ORDER BY signal_at DESC")
        .all(new Date(sinceMs).toISOString())
        .map((row) => rowToSignal(row as Row));
    },
    upsertPositioning(rows: Array<{ symbol: string; hourMs: number; close: number; oiValue: number | null; funding: number | null }>) {
      transaction(() => {
        const stmt = db.prepare(`INSERT INTO market_positioning_hourly(symbol,hour_ms,close,oi_value,funding) VALUES (?,?,?,?,?)
          ON CONFLICT(symbol,hour_ms) DO UPDATE SET close=excluded.close,
            oi_value=COALESCE(excluded.oi_value, market_positioning_hourly.oi_value),
            funding=COALESCE(excluded.funding, market_positioning_hourly.funding)`);
        for (const row of rows) stmt.run(row.symbol, row.hourMs, row.close, row.oiValue, row.funding);
      });
    },
    prunePositioning(beforeMs: number) {
      return Number(db.prepare("DELETE FROM market_positioning_hourly WHERE hour_ms<?").run(beforeMs).changes);
    },
    readMeta() {
      const row = db.prepare("SELECT * FROM market_signal_meta WHERE id=1").get() as Row;
      return {
        lastCycleAt: (row?.last_cycle_at as string | null) ?? null,
        lastSuccessAt: (row?.last_success_at as string | null) ?? null,
        lastPositioningHourMs: row?.last_positioning_hour_ms === null || row?.last_positioning_hour_ms === undefined ? null : Number(row.last_positioning_hour_ms),
        lastPositioningAt: (row?.last_positioning_at as string | null) ?? null,
        lastError: (row?.last_error as string | null) ?? null,
        lastErrorAt: (row?.last_error_at as string | null) ?? null,
      };
    },
    markCycle(input: { nowMs: number; error?: string | null }) {
      const at = new Date(input.nowMs).toISOString();
      if (input.error) {
        db.prepare("UPDATE market_signal_meta SET last_cycle_at=?, last_error=?, last_error_at=? WHERE id=1").run(at, input.error.slice(0, 500), at);
      } else {
        db.prepare("UPDATE market_signal_meta SET last_cycle_at=?, last_success_at=? WHERE id=1").run(at, at);
      }
    },
    markPositioning(hourMs: number, nowMs: number) {
      db.prepare("UPDATE market_signal_meta SET last_positioning_hour_ms=?, last_positioning_at=? WHERE id=1").run(hourMs, new Date(nowMs).toISOString());
    },
    symbolClassesUpdatedAt() {
      const row = db.prepare("SELECT MAX(updated_at) AS value FROM market_symbol_class").get() as Row;
      const ms = Date.parse(String(row?.value ?? ""));
      return Number.isFinite(ms) ? ms : null;
    },
    replaceSymbolClasses(rows: Array<{ symbol: string; underlyingType: string }>, nowMs: number) {
      transaction(() => {
        db.exec("DELETE FROM market_symbol_class");
        const stmt = db.prepare("INSERT INTO market_symbol_class(symbol,underlying_type,updated_at) VALUES (?,?,?)");
        const at = new Date(nowMs).toISOString();
        for (const row of rows) stmt.run(row.symbol, row.underlyingType, at);
      });
    },
    // Only non-crypto underlyings; anything absent is treated as a normal coin.
    readSymbolClasses(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const row of db.prepare("SELECT symbol, underlying_type FROM market_symbol_class WHERE underlying_type<>'COIN'").all() as Row[]) {
        out[String(row.symbol)] = String(row.underlying_type);
      }
      return out;
    },
    readAfter: outbox.readAfter,
    getBaseline: () => ({ lastSequence: outbox.getBaseline().lastSequence }),
    revalidate(event: PushEvent, nowMs: number) {
      if (event.source !== "signals" || event.stage !== "pullback_entry") return false;
      return Date.parse(event.expiresAt) > nowMs;
    },
    close() { db.close(); },
  };
}

export type MarketSignalsStore = ReturnType<typeof openMarketSignalsStore>;

export type MarketSignalsSnapshot = {
  generatedAt: string;
  signals: MarketSignal[];
  stats: Record<MarketSignalKind, MarketSignalStats>;
  meta: ReturnType<MarketSignalsStore["readMeta"]>;
  symbolClasses: Record<string, string>;
  alertOutcomeStats: { windowDays: number; groups: AlertOutcomeGroupStats[] };
  // Raw (not direction-adjusted) follow-up % per alert id for alerts in the last 24h.
  recentAlertOutcomes: Record<string, { "1h": number | null; "4h": number | null; "24h": number | null }>;
  rules: Pick<MarketSignalRules, "pullbackPct" | "maxPre24hPct" | "stopPct" | "btcShortWarningPct">;
};

export const ALERT_OUTCOME_STATS_DAYS = 14;

export function readMarketSignalsSnapshot(input: { store?: MarketSignalsStore; nowMs?: number; env?: EnvLike } = {}): MarketSignalsSnapshot {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const rules = getMarketSignalRules(env);
  const store = input.store ?? openMarketSignalsStore(marketSignalsDbPath(env));
  try {
    const window = store.listSignals(nowMs - rules.statsWindowMs);
    const outcomeRows = store.alertOutcomes.list(nowMs - ALERT_OUTCOME_STATS_DAYS * 24 * HOUR_MS);
    const recentAlertOutcomes: MarketSignalsSnapshot["recentAlertOutcomes"] = {};
    for (const row of outcomeRows) {
      if (Date.parse(row.occurredAt) < nowMs - 25 * HOUR_MS) break;
      if (row.ret1hPct === null) continue;
      recentAlertOutcomes[row.eventId] = { "1h": row.ret1hPct, "4h": row.ret4hPct, "24h": row.ret24hPct };
    }
    return {
      generatedAt: new Date(nowMs).toISOString(),
      signals: window.filter((signal) => Date.parse(signal.signalAt) >= nowMs - 24 * HOUR_MS),
      stats: {
        pullback_long: summarizeSignals(window, "pullback_long"),
        volatile_watch: summarizeSignals(window, "volatile_watch"),
        coil_watch: summarizeSignals(window, "coil_watch"),
      },
      meta: store.readMeta(),
      symbolClasses: store.readSymbolClasses(),
      alertOutcomeStats: {
        windowDays: ALERT_OUTCOME_STATS_DAYS,
        groups: summarizeAlertOutcomes(outcomeRows),
      },
      recentAlertOutcomes,
      rules: { pullbackPct: rules.pullbackPct, maxPre24hPct: rules.maxPre24hPct, stopPct: rules.stopPct, btcShortWarningPct: rules.btcShortWarningPct },
    };
  } finally {
    if (!input.store) store.close();
  }
}
