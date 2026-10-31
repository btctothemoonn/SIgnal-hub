import type { DatabaseSync } from "node:sqlite";
import { MARKET_PUSH_FRESH_MS } from "./important-push-policy.ts";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";

export const ALERTS_RETENTION_BATCH_SIZE = 5000;
export const ALERTS_RETENTION_INTERVAL_MS = 60 * 60_000;
export const ALERTS_RETENTION_MAX_BATCHES = 200;
export const ALERTS_SCAN_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const ALERTS_DIAGNOSTIC_RETENTION_MS = MARKET_OPPORTUNITY_RULES.diagnosticRetentionMs;
export const ALERTS_AI_RUN_RETENTION_MS = 30 * 24 * 60 * 60_000;
/**
 * Dedup is `INSERT OR IGNORE` on (symbol, participant_key, scan_id). A deleted
 * scan id can be applied again. Live workers only emit the current scan, and
 * an observation older than enrichment freshness cannot qualify. Opportunity
 * episodes are also bounded by max lifetime. Retention stays at least that long.
 */
export const ALERTS_SCAN_DEDUPE_FLOOR_MS = Math.max(
  MARKET_PUSH_FRESH_MS,
  MARKET_OPPORTUNITY_RULES.maxLifetimeMs,
);

if (ALERTS_SCAN_RETENTION_MS < ALERTS_SCAN_DEDUPE_FLOOR_MS) {
  throw new Error("important_push_market_scans retention is shorter than the dedupe window");
}

type RetentionResult = {
  ran: boolean;
  scans: number;
  diagnostics: number;
  aiRuns: number;
  scanTimesBackfilled: number;
};

function changes(result: { changes?: number | bigint }) {
  return Number(result.changes ?? 0);
}

export function pruneAlertsRetention(
  db: DatabaseSync,
  nowMs: number,
  options: { force?: boolean; maxBatches?: number; batchSize?: number } = {},
): RetentionResult {
  const batchSize = Math.max(1, options.batchSize ?? ALERTS_RETENTION_BATCH_SIZE);
  const maxBatches = Math.max(1, options.maxBatches ?? ALERTS_RETENTION_MAX_BATCHES);
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_alert_maintenance (
      id INTEGER PRIMARY KEY CHECK (id=1),
      last_retention_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO market_alert_maintenance (id, last_retention_at) VALUES (1, 0);
  `);
  if (options.force) {
    db.prepare("UPDATE market_alert_maintenance SET last_retention_at=? WHERE id=1").run(nowMs);
  } else {
    const claimed = db.prepare(`
      UPDATE market_alert_maintenance
      SET last_retention_at=?
      WHERE id=1 AND last_retention_at<=?
    `).run(nowMs, nowMs - ALERTS_RETENTION_INTERVAL_MS);
    if (!changes(claimed)) {
      return { ran: false, scans: 0, diagnostics: 0, aiRuns: 0, scanTimesBackfilled: 0 };
    }
  }

  const beforeScan = nowMs - ALERTS_SCAN_RETENTION_MS;
  const beforeDiagnostics = new Date(nowMs - ALERTS_DIAGNOSTIC_RETENTION_MS).toISOString();
  const beforeAiRuns = new Date(nowMs - ALERTS_AI_RUN_RETENTION_MS).toISOString();
  const backfill = db.prepare(`
    UPDATE important_push_market_scans
    SET scanned_at = CAST(substr(scan_id, instr(scan_id, ':') + 1) AS INTEGER)
    WHERE rowid IN (
      SELECT rowid FROM important_push_market_scans
      WHERE scanned_at IS NULL
        AND (scan_id LIKE 'opportunity:%' OR scan_id LIKE 'squeeze:%')
        AND length(substr(scan_id, instr(scan_id, ':') + 1)) >= 10
        AND substr(scan_id, instr(scan_id, ':') + 1) NOT GLOB '*[^0-9]*'
      LIMIT ?
    )
  `);
  const deleteScans = db.prepare(`
    DELETE FROM important_push_market_scans
    WHERE rowid IN (
      SELECT rowid FROM important_push_market_scans
      WHERE scanned_at IS NOT NULL AND scanned_at < ?
      LIMIT ?
    )
  `);
  const deleteDiagnostics = db.prepare(`
    DELETE FROM market_opportunity_diagnostics
    WHERE id IN (
      SELECT id FROM market_opportunity_diagnostics
      WHERE created_at < ?
      ORDER BY created_at ASC
      LIMIT ?
    )
  `);
  const deleteAiRuns = db.prepare(`
    DELETE FROM market_opportunity_ai_runs
    WHERE id IN (
      SELECT id FROM market_opportunity_ai_runs
      WHERE created_at < ?
      ORDER BY created_at ASC
      LIMIT ?
    )
  `);

  const totals = { scans: 0, diagnostics: 0, aiRuns: 0, scanTimesBackfilled: 0 };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const scanTimesBackfilled = changes(backfill.run(batchSize));
    const scans = changes(deleteScans.run(beforeScan, batchSize));
    const diagnostics = changes(deleteDiagnostics.run(beforeDiagnostics, batchSize));
    const aiRuns = changes(deleteAiRuns.run(beforeAiRuns, batchSize));
    totals.scanTimesBackfilled += scanTimesBackfilled;
    totals.scans += scans;
    totals.diagnostics += diagnostics;
    totals.aiRuns += aiRuns;
    if (
      scanTimesBackfilled < batchSize &&
      scans < batchSize &&
      diagnostics < batchSize &&
      aiRuns < batchSize
    ) break;
  }
  return { ran: true, ...totals };
}
