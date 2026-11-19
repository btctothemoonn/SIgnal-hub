import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { EnvLike } from "./important-push-types.ts";
import { marketSignalsDbPath } from "./market-signals.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Hourly positioning runs after settlement, then scans the universe. Allow a 15-minute handover.
const HOURLY_MAX_AGE = HOUR + 15 * MINUTE;

export type MarketCardMetrics = {
  oi1hPct: number | null;
  fundingRate: number | null;
  shortLiquidations15m: number | null;
};

function readExisting(path: string, read: (db: DatabaseSync) => void) {
  if (!existsSync(path)) return;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    read(db);
  } catch (error) {
    // During rollout a worker may not have initialized its new tables or columns yet.
    if (!(error instanceof Error && /no such (table|column):/.test(error.message))) throw error;
  } finally {
    db?.close();
  }
}

export function readMarketCardMetrics(
  symbols: string[], nowMs: number, env: EnvLike = process.env,
): Record<string, MarketCardMetrics> {
  const wanted = [...new Set(symbols)];
  const result: Record<string, MarketCardMetrics> = Object.fromEntries(wanted.map(symbol =>
    [symbol, { oi1hPct: null, fundingRate: null, shortLiquidations15m: null }]));
  if (!wanted.length) return result;
  const keys = JSON.stringify(wanted);
  const fundingTimes = new Map<string, number>();
  readExisting(marketSignalsDbPath(env), db => {
    // hour_ms is the opening time of the bar; OI is sampled at its closing boundary.
    const rows = db.prepare(`
      SELECT w.value AS symbol, p.oi_quantity AS quantity, prior.oi_quantity AS baseline, f.rate, f.observed_at_ms
      FROM json_each(?) w
      LEFT JOIN market_positioning_hourly p ON p.rowid = (
        SELECT rowid FROM market_positioning_hourly
        WHERE symbol = w.value AND hour_ms BETWEEN ? AND ?
        ORDER BY hour_ms DESC LIMIT 1
      )
      LEFT JOIN market_positioning_hourly prior ON prior.symbol = p.symbol AND prior.hour_ms = p.hour_ms - ?
      LEFT JOIN market_card_funding f ON f.symbol = w.value AND f.observed_at_ms BETWEEN ? AND ?
    `).all(keys, nowMs - HOURLY_MAX_AGE - HOUR, nowMs - HOUR, HOUR, nowMs - HOURLY_MAX_AGE, nowMs);
    for (const row of rows) {
      const symbol = String(row.symbol);
      const metrics = result[symbol];
      if (typeof row.rate === "number") {
        metrics.fundingRate = row.rate;
        fundingTimes.set(symbol, Number(row.observed_at_ms));
      }
      if (typeof row.quantity === "number" && row.quantity >= 0 && typeof row.baseline === "number" && row.baseline > 0) {
        const pct = (row.quantity - row.baseline) / row.baseline * 100;
        if (Number.isFinite(pct)) metrics.oi1hPct = pct;
      }
    }
  });
  const end = Math.floor(nowMs / MINUTE) * MINUTE;
  const start = end - 15 * MINUTE;
  const alertsPath = env.MARKET_ALERTS_DB?.trim() || getRuntimeDataPath(env, "market-alerts", "alerts.sqlite");
  readExisting(alertsPath, db => {
    // Opportunity scans sample some of the same premiums more often than the hourly worker.
    const rates = db.prepare(`
      SELECT symbol, json_extract(metrics_json, '$.funding') AS rate,
             json_extract(metrics_json, '$.pushEvidence.sourceTimes.funding') AS source_time
      FROM market_opportunity_enrichment
      WHERE symbol IN (SELECT value FROM json_each(?)) AND stale = 0 AND fetched_at BETWEEN ? AND ?
        AND json_valid(metrics_json)
    `).all(keys, new Date(nowMs - HOURLY_MAX_AGE).toISOString(), new Date(nowMs).toISOString());
    for (const row of rates) {
      const symbol = String(row.symbol);
      const at = Date.parse(String(row.source_time));
      if (typeof row.rate === "number" && Number.isFinite(row.rate) && at <= nowMs &&
          at >= (fundingTimes.get(symbol) ?? nowMs - HOURLY_MAX_AGE)) {
        result[symbol].fundingRate = row.rate;
      }
    }
    const totals = db.prepare(`
      WITH totals AS (
        SELECT symbol, SUM(short_notional_usdt) AS total
        FROM market_liquidation_minutes WHERE minute_at >= ? AND minute_at < ?
          AND symbol IN (SELECT value FROM json_each(?)) GROUP BY symbol
      )
      SELECT w.value AS symbol, COALESCE(t.total, 0) AS amount
      FROM json_each(?) w LEFT JOIN totals t ON w.value = t.symbol
      WHERE (SELECT COUNT(*) FROM market_liquidation_coverage WHERE minute_at >= ? AND minute_at < ?) = 15
    `).all(start, end, keys, keys, start, end);
    for (const row of totals) {
      const symbol = String(row.symbol);
      if (symbol.endsWith("USDT")) result[symbol].shortLiquidations15m = Number(row.amount);
    }
  });
  return result;
}
