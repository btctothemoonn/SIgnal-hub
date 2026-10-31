import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opportunityDecision, pushNow, pushNowMs } from "./important-push-test-fixtures.mjs";
import { qualifyOpportunity } from "./important-push-policy.ts";
import { createImportantPushOutbox } from "./important-push-outbox.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import {
  ALERTS_AI_RUN_RETENTION_MS,
  ALERTS_DIAGNOSTIC_RETENTION_MS,
  ALERTS_RETENTION_BATCH_SIZE,
  ALERTS_RETENTION_INTERVAL_MS,
  ALERTS_SCAN_DEDUPE_FLOOR_MS,
  ALERTS_SCAN_RETENTION_MS,
  pruneAlertsRetention,
} from "./market-alerts-retention.ts";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";

const day = 24 * 60 * 60_000;
const dir = mkdtempSync(join(tmpdir(), "alerts-retention-"));
const dbPath = join(dir, "alerts.sqlite");

assert.equal(ALERTS_SCAN_RETENTION_MS, 7 * day);
assert.equal(ALERTS_DIAGNOSTIC_RETENTION_MS, 14 * day);
assert.equal(ALERTS_AI_RUN_RETENTION_MS, 30 * day);
assert.equal(ALERTS_RETENTION_BATCH_SIZE, 5000);
assert.equal(ALERTS_RETENTION_INTERVAL_MS, 60 * 60_000);
assert.equal(MARKET_OPPORTUNITY_RULES.diagnosticRetentionMs, ALERTS_DIAGNOSTIC_RETENTION_MS);
assert.ok(
  ALERTS_SCAN_RETENTION_MS >= ALERTS_SCAN_DEDUPE_FLOOR_MS,
  "scan retention must cover the important-push dedupe window",
);
assert.ok(ALERTS_SCAN_DEDUPE_FLOOR_MS >= MARKET_OPPORTUNITY_RULES.maxLifetimeMs);
assert.doesNotMatch(readFileSync(new URL("./market-alerts-retention.ts", import.meta.url), "utf8"), /VACUUM/i);
assert.doesNotMatch(readFileSync(new URL("./important-push-outbox.ts", import.meta.url), "utf8"), /VACUUM/i);
assert.doesNotMatch(readFileSync(new URL("./market-alerts-store.ts", import.meta.url), "utf8"), /VACUUM/i);

try {
  const store = openMarketAlertsStore(dbPath);
  const nowMs = pushNowMs;
  const oldDiagnostic = new Date(nowMs - 15 * day).toISOString();
  const freshDiagnostic = new Date(nowMs - 13 * day).toISOString();
  const oldRun = new Date(nowMs - 31 * day).toISOString();
  const freshRun = new Date(nowMs - 29 * day).toISOString();
  store.recordOpportunityDiagnostic({ symbol: "OLDUSDT", detail: { score: 1 }, createdAt: oldDiagnostic });
  store.recordOpportunityDiagnostic({ symbol: "KEEPUSDT", detail: { score: 2 }, createdAt: freshDiagnostic });
  store.recordOpportunityAiAttempt({ fingerprint: "old", createdAt: oldRun });
  store.recordOpportunityAiAttempt({ fingerprint: "fresh", createdAt: freshRun });
  for (let index = 0; index < 5; index += 1) {
    store.recordOpportunityDiagnostic({
      symbol: `BATCH${index}USDT`,
      detail: { score: index },
      createdAt: oldDiagnostic,
    });
  }
  store.close();

  const db = new DatabaseSync(dbPath);
  const outbox = createImportantPushOutbox(db);
  const index = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='index' AND name='idx_important_push_market_scans_scanned_at'
  `).get();
  assert.equal(index?.name, "idx_important_push_market_scans_scanned_at");

  const qualify = (symbol, scanId) => qualifyOpportunity({
    decision: opportunityDecision({ symbol }),
    enrichment: { fetchedAt: pushNow, stale: false, error: null },
    scanId,
  }, nowMs);
  const recentScanId = `opportunity:${nowMs}`;
  const expiredScanId = `opportunity:${nowMs - day}`;
  assert.equal(outbox.applyMarketObservations([qualify("RECENTUSDT", recentScanId)], nowMs).length, 1);
  assert.equal(outbox.applyMarketObservations([qualify("RECENTUSDT", recentScanId)], nowMs).length, 0);
  assert.equal(outbox.applyMarketObservations([qualify("EXPIREDUSDT", expiredScanId)], nowMs).length, 1);
  db.prepare("UPDATE important_push_market_scans SET scanned_at=? WHERE scan_id=?").run(nowMs - 8 * day, expiredScanId);
  db.prepare(`
    INSERT INTO important_push_market_scans(symbol, participant_key, scan_id)
    VALUES ('LEGACYUSDT', 'opportunity:capital_long', ?)
  `).run(`squeeze:${nowMs - 9 * day}`);
  db.prepare(`
    INSERT INTO important_push_market_scans(symbol, participant_key, scan_id, scanned_at)
    VALUES ('LITERALUSDT', 'opportunity:capital_long', 'scan-1', NULL)
  `).run();

  const limited = pruneAlertsRetention(db, nowMs, { force: true, batchSize: 2, maxBatches: 1 });
  assert.equal(limited.ran, true);
  assert.equal(limited.diagnostics, 2, "each batch deletes at most batchSize rows");
  const remainingOldDiagnostics = db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_diagnostics WHERE created_at=?
  `).get(oldDiagnostic).value;
  assert.equal(Number(remainingOldDiagnostics), 4);

  const drained = pruneAlertsRetention(db, nowMs, { force: true, batchSize: 2, maxBatches: 10 });
  assert.equal(limited.diagnostics + drained.diagnostics, 6);
  assert.equal(limited.aiRuns + drained.aiRuns, 1);
  assert.ok(limited.scans + drained.scans >= 1);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_diagnostics WHERE symbol='KEEPUSDT'
  `).get().value), 1);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_diagnostics WHERE created_at=?
  `).get(oldDiagnostic).value), 0);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_ai_runs WHERE fingerprint='fresh'
  `).get().value), 1);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_ai_runs WHERE fingerprint='old'
  `).get().value), 0);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM important_push_market_scans WHERE scan_id=?
  `).get(recentScanId).value), 1, "scans inside the 7 day dedupe window stay");
  db.exec("DELETE FROM important_push_market_episodes");
  assert.equal(outbox.applyMarketObservations([qualify("RECENTUSDT", recentScanId)], nowMs).length, 0, "kept scan ids still dedupe after the episode row is gone");
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM important_push_market_scans WHERE scan_id=?
  `).get(expiredScanId).value), 0);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM important_push_market_scans WHERE symbol='LEGACYUSDT'
  `).get().value), 0, "legacy opportunity/squeeze scan ids are timed from the id");
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM important_push_market_scans WHERE scan_id='scan-1'
  `).get().value), 1, "scan ids without a timestamp stay so dedup still holds");
  const replay = outbox.applyMarketObservations([qualify("EXPIREDUSDT", expiredScanId)], nowMs);
  assert.equal(replay.length, 1, "a scan id can be replayed only after it ages out of retention");

  db.prepare(`
    INSERT INTO market_opportunity_diagnostics(symbol, detail_json, created_at) VALUES ('GATEUSDT', '{}', ?)
  `).run(oldDiagnostic);
  const skipped = pruneAlertsRetention(db, nowMs + 1000);
  assert.equal(skipped.ran, false);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_diagnostics WHERE symbol='GATEUSDT'
  `).get().value), 1);
  const later = pruneAlertsRetention(db, nowMs + ALERTS_RETENTION_INTERVAL_MS + 1, { batchSize: 5000 });
  assert.equal(later.ran, true);
  assert.equal(later.diagnostics, 1);

  const viaStore = openMarketAlertsStore(dbPath);
  try {
    const again = viaStore.pruneMarketAlertsRetention(nowMs + ALERTS_RETENTION_INTERVAL_MS + 2);
    assert.equal(again.ran, false);
  } finally {
    viaStore.close();
  }
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - alerts sqlite retention keeps the push dedupe window");
