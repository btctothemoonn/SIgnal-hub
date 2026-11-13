import type { DatabaseSync } from "node:sqlite";
import type { Bar } from "./market-signals.ts";

// Follow-up price of every pump / crash / squeeze alert at fixed horizons, so the board can
// show which trigger conditions actually continue in the alert's direction.
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const ALERT_OUTCOME_BAR_MS = 5 * MINUTE_MS;
export const ALERT_OUTCOME_HORIZONS = [
  { key: "1h", ms: HOUR_MS },
  { key: "4h", ms: 4 * HOUR_MS },
  { key: "24h", ms: 24 * HOUR_MS },
] as const;
export type AlertOutcomeHorizon = (typeof ALERT_OUTCOME_HORIZONS)[number]["key"];
export type AlertCategory = "pump" | "crash" | "squeeze";

const FINAL_MS = 24 * HOUR_MS;
// A horizon is filled from the last closed 5m bar at or before the target; older than this means a data gap.
const MAX_BAR_GAP_MS = 15 * MINUTE_MS;
// Delisted or long-gapped symbols stop being retried once the 24h horizon is this far behind.
const GIVE_UP_AFTER_MS = 12 * HOUR_MS;

export type AlertEventLike = {
  id: string;
  type: string;
  symbol: string;
  side: string | null;
  level: number;
  stage: string;
  trigger: string;
  source: string;
  price: number;
  occurredAt: string;
  metrics?: Record<string, unknown> | null;
};

export type AlertOutcomeRow = {
  eventId: string;
  symbol: string;
  category: AlertCategory;
  triggerGroup: string;
  stage: string;
  level: number;
  source: string;
  occurredAt: string;
  refPrice: number;
  pre24hPct: number | null;
  ret1hPct: number | null;
  ret4hPct: number | null;
  ret24hPct: number | null;
  maxUpPct: number | null;
  maxDownPct: number | null;
  completed: boolean;
  attempts: number;
};

export function alertCategory(event: Pick<AlertEventLike, "type" | "side">): AlertCategory | null {
  if (event.type === "short_squeeze") return "squeeze";
  if (event.type !== "volatility") return null;
  if (event.side === "LONG") return "pump";
  if (event.side === "SHORT") return "crash";
  return null;
}

// "A趋势实时+B加速实时" -> "A+B", "B加速·确认" -> "B加速"; squeeze alerts group by stage.
export function alertTriggerGroup(event: Pick<AlertEventLike, "type" | "stage" | "trigger">) {
  if (event.type === "short_squeeze") return event.stage || "轧空";
  const parts = [...event.trigger.matchAll(/([A-D])(趋势|加速|阶梯|先行)/g)];
  const letters = [...new Set(parts.map((part) => part[1]))].sort();
  if (letters.length > 1) return letters.join("+");
  if (parts.length) return `${parts[0][1]}${parts[0][2]}`;
  return event.trigger.replace(/[·\s]*(实时|确认)$/u, "") || "其他";
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function finiteOrNull(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

export function seedFromEvent(event: AlertEventLike): AlertOutcomeRow | null {
  const category = alertCategory(event);
  if (!category || !(event.price > 0) || !Number.isFinite(Date.parse(event.occurredAt))) return null;
  return {
    eventId: event.id,
    symbol: event.symbol,
    category,
    triggerGroup: alertTriggerGroup({ type: event.type, stage: event.stage ?? "", trigger: event.trigger ?? "" }),
    stage: event.stage ?? "",
    level: Number(event.level) || 1,
    source: event.source ?? "",
    occurredAt: event.occurredAt,
    refPrice: event.price,
    pre24hPct: finiteOrNull(event.metrics?.pct24h),
    ret1hPct: null,
    ret4hPct: null,
    ret24hPct: null,
    maxUpPct: null,
    maxDownPct: null,
    completed: false,
    attempts: 0,
  };
}

function priceAt(bars: Bar[], targetMs: number) {
  let found: Bar | null = null;
  for (const bar of bars) {
    if (bar.t + ALERT_OUTCOME_BAR_MS > targetMs) break;
    found = bar;
  }
  if (!found || targetMs - (found.t + ALERT_OUTCOME_BAR_MS) > MAX_BAR_GAP_MS) return null;
  return found.c;
}

// Fills every horizon that is due and covered by closed 5m bars. Returns null when nothing changed.
export function fillAlertOutcome(row: AlertOutcomeRow, barsInput: Bar[], nowMs: number): AlertOutcomeRow | null {
  const startMs = Date.parse(row.occurredAt);
  const bars = barsInput.filter((bar) => bar.t + ALERT_OUTCOME_BAR_MS <= nowMs).sort((a, b) => a.t - b.t);
  const next = { ...row };
  let changed = false;
  const field = { "1h": "ret1hPct", "4h": "ret4hPct", "24h": "ret24hPct" } as const;
  for (const horizon of ALERT_OUTCOME_HORIZONS) {
    const key = field[horizon.key];
    if (next[key] !== null || startMs + horizon.ms > nowMs) continue;
    const close = priceAt(bars, startMs + horizon.ms);
    if (close === null) continue;
    next[key] = roundPct((close / row.refPrice - 1) * 100);
    changed = true;
  }
  if (next.ret24hPct !== null && next.maxUpPct === null) {
    const window = bars.filter((bar) => bar.t + ALERT_OUTCOME_BAR_MS > startMs && bar.t < startMs + FINAL_MS);
    if (window.length) {
      next.maxUpPct = roundPct((Math.max(...window.map((bar) => bar.h)) / row.refPrice - 1) * 100);
      next.maxDownPct = roundPct((Math.min(...window.map((bar) => bar.l)) / row.refPrice - 1) * 100);
    }
  }
  if (next.ret24hPct !== null || nowMs > startMs + FINAL_MS + GIVE_UP_AFTER_MS) {
    if (!next.completed) changed = true;
    next.completed = true;
  }
  return changed ? next : null;
}

// Return measured in the alert's own direction: a crash alert "wins" when price keeps falling.
export function directionalPct(category: AlertCategory, rawPct: number) {
  return category === "crash" ? -rawPct : rawPct;
}

export type AlertHorizonStats = { n: number; winRate: number | null; medianPct: number | null };
export type AlertOutcomeGroupStats = {
  category: AlertCategory;
  group: string;
  total: number;
  horizons: Record<AlertOutcomeHorizon, AlertHorizonStats>;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function horizonStats(rows: AlertOutcomeRow[], key: "ret1hPct" | "ret4hPct" | "ret24hPct"): AlertHorizonStats {
  const values = rows
    .filter((row) => row[key] !== null)
    .map((row) => directionalPct(row.category, row[key] as number));
  return {
    n: values.length,
    winRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
    medianPct: values.length ? roundPct(median(values) as number) : null,
  };
}

const CATEGORY_ORDER: AlertCategory[] = ["pump", "crash", "squeeze"];
export const ALERT_OUTCOME_ALL_GROUP = "全部";
export const ALERT_OUTCOME_ESCALATION_GROUP = "L2+ 升级";

// One "全部" row per category, then each trigger condition, then escalations (L2+) as their own row.
export function summarizeAlertOutcomes(rows: AlertOutcomeRow[]): AlertOutcomeGroupStats[] {
  const out: AlertOutcomeGroupStats[] = [];
  const build = (category: AlertCategory, group: string, members: AlertOutcomeRow[]): AlertOutcomeGroupStats => ({
    category,
    group,
    total: members.length,
    horizons: {
      "1h": horizonStats(members, "ret1hPct"),
      "4h": horizonStats(members, "ret4hPct"),
      "24h": horizonStats(members, "ret24hPct"),
    },
  });
  for (const category of CATEGORY_ORDER) {
    const members = rows.filter((row) => row.category === category);
    if (!members.length) continue;
    out.push(build(category, ALERT_OUTCOME_ALL_GROUP, members));
    const groups = new Map<string, AlertOutcomeRow[]>();
    for (const row of members) groups.set(row.triggerGroup, [...(groups.get(row.triggerGroup) ?? []), row]);
    for (const [group, groupRows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      out.push(build(category, group, groupRows));
    }
    const escalations = members.filter((row) => row.level >= 2);
    if (escalations.length && category !== "squeeze") out.push(build(category, ALERT_OUTCOME_ESCALATION_GROUP, escalations));
  }
  return out;
}

type Row = Record<string, unknown>;

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function rowToOutcome(row: Row): AlertOutcomeRow {
  return {
    eventId: String(row.event_id),
    symbol: String(row.symbol),
    category: String(row.category) as AlertCategory,
    triggerGroup: String(row.trigger_group),
    stage: String(row.stage),
    level: Number(row.level),
    source: String(row.source),
    occurredAt: String(row.occurred_at),
    refPrice: Number(row.ref_price),
    pre24hPct: nullableNumber(row.pre24h_pct),
    ret1hPct: nullableNumber(row.ret_1h_pct),
    ret4hPct: nullableNumber(row.ret_4h_pct),
    ret24hPct: nullableNumber(row.ret_24h_pct),
    maxUpPct: nullableNumber(row.max_up_pct),
    maxDownPct: nullableNumber(row.max_down_pct),
    completed: Number(row.completed) === 1,
    attempts: Number(row.attempts ?? 0),
  };
}

export function createAlertOutcomeRepo(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_alert_outcomes (
      event_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      category TEXT NOT NULL,
      trigger_group TEXT NOT NULL,
      stage TEXT NOT NULL,
      level INTEGER NOT NULL,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      ref_price REAL NOT NULL,
      pre24h_pct REAL,
      ret_1h_pct REAL,
      ret_4h_pct REAL,
      ret_24h_pct REAL,
      max_up_pct REAL,
      max_down_pct REAL,
      completed INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_alert_outcomes_pending ON market_alert_outcomes(completed, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_market_alert_outcomes_time ON market_alert_outcomes(occurred_at);
  `);

  return {
    latestSeededAt() {
      const row = db.prepare("SELECT MAX(occurred_at) AS value FROM market_alert_outcomes").get() as Row;
      const ms = Date.parse(String(row?.value ?? ""));
      return Number.isFinite(ms) ? ms : null;
    },
    seed(rows: AlertOutcomeRow[], nowMs: number) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO market_alert_outcomes
        (event_id,symbol,category,trigger_group,stage,level,source,occurred_at,ref_price,pre24h_pct,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      const at = new Date(nowMs).toISOString();
      let inserted = 0;
      for (const row of rows) {
        const result = stmt.run(row.eventId, row.symbol, row.category, row.triggerGroup, row.stage, row.level, row.source, row.occurredAt, row.refPrice, row.pre24hPct, at);
        inserted += Number(result.changes);
      }
      return inserted;
    },
    // Rows with at least one horizon whose time has passed and is still empty, oldest first.
    due(nowMs: number, limit: number) {
      const iso = (ms: number) => new Date(nowMs - ms - ALERT_OUTCOME_BAR_MS).toISOString();
      return db.prepare(`SELECT * FROM market_alert_outcomes WHERE completed=0 AND (
          (ret_1h_pct IS NULL AND occurred_at<=?) OR (ret_4h_pct IS NULL AND occurred_at<=?) OR (ret_24h_pct IS NULL AND occurred_at<=?)
        ) ORDER BY occurred_at LIMIT ?`)
        .all(iso(HOUR_MS), iso(4 * HOUR_MS), iso(FINAL_MS), limit)
        .map((row) => rowToOutcome(row as Row));
    },
    save(row: AlertOutcomeRow, nowMs: number) {
      db.prepare(`UPDATE market_alert_outcomes SET ret_1h_pct=?, ret_4h_pct=?, ret_24h_pct=?, max_up_pct=?, max_down_pct=?,
          completed=?, attempts=?, updated_at=? WHERE event_id=?`)
        .run(row.ret1hPct, row.ret4hPct, row.ret24hPct, row.maxUpPct, row.maxDownPct, row.completed ? 1 : 0, row.attempts, new Date(nowMs).toISOString(), row.eventId);
    },
    list(sinceMs: number) {
      return db.prepare("SELECT * FROM market_alert_outcomes WHERE occurred_at>=? ORDER BY occurred_at DESC")
        .all(new Date(sinceMs).toISOString())
        .map((row) => rowToOutcome(row as Row));
    },
    byEventIds(eventIds: string[]) {
      const out: Record<string, AlertOutcomeRow> = {};
      const stmt = db.prepare("SELECT * FROM market_alert_outcomes WHERE event_id=?");
      for (const id of eventIds) {
        const row = stmt.get(id) as Row | undefined;
        if (row) out[id] = rowToOutcome(row);
      }
      return out;
    },
  };
}

export type AlertOutcomeRepo = ReturnType<typeof createAlertOutcomeRepo>;
