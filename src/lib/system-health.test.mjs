import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const moduleUrl = new URL("./system-health.ts", import.meta.url);
const {
  buildSystemHealthSnapshot,
  systemHealthStatusRank,
  summarizeCachedStocksSnapshot,
  opportunityHealthItem,
  summarizeServiceState,
} = await import(moduleUrl);

const now = new Date("2026-05-21T04:00:00.000Z");

const freshMarket = summarizeCachedStocksSnapshot({
  id: "stocks-market",
  label: "Stocks 行情",
  kind: "market",
  snapshot: {
    generatedAt: "2026-05-21T03:58:00.000Z",
    source: "live",
    provider: "fmp",
    errors: [],
  },
  now,
  staleMs: 10 * 60 * 1000,
});

assert.equal(freshMarket.status, "ok");
assert.equal(freshMarket.stale, false);
assert.equal(freshMarket.meta?.provider, "fmp");

const staleCatalysts = summarizeCachedStocksSnapshot({
  id: "stocks-catalysts",
  label: "Stocks 新闻/研报",
  kind: "catalysts",
  snapshot: {
    generatedAt: "2026-05-21T02:30:00.000Z",
    source: "live",
    provider: "all-sources",
    errors: [],
  },
  now,
  staleMs: 30 * 60 * 1000,
});

assert.equal(staleCatalysts.status, "warning");
assert.equal(staleCatalysts.stale, true);
assert.match(staleCatalysts.detail, /stale/i);

const missingFinancials = summarizeCachedStocksSnapshot({
  id: "stocks-financial",
  label: "Stocks 财报",
  kind: "financial",
  snapshot: null,
  now,
  staleMs: 6 * 60 * 60 * 1000,
});

assert.equal(missingFinancials.status, "warning");
assert.match(missingFinancials.detail, /cache missing/i);

const inactiveService = summarizeServiceState({
  name: "signal-hub-telegram",
  activeState: "failed",
  detail: "exit-code",
});

assert.equal(inactiveService.status, "error");
assert.equal(inactiveService.label, "Telegram 采集");
assert.match(inactiveService.detail, /failed/);

const snapshot = buildSystemHealthSnapshot({
  generatedAt: now.toISOString(),
  items: [freshMarket, staleCatalysts, missingFinancials, inactiveService],
});

assert.equal(snapshot.status, "error");
assert.equal(systemHealthStatusRank("ok") < systemHealthStatusRank("warning"), true);
assert.equal(systemHealthStatusRank("warning") < systemHealthStatusRank("error"), true);

const opportunityDirectory = mkdtempSync(join(tmpdir(), "opportunity-health-"));
const opportunityDbPath = join(opportunityDirectory, "opportunities.sqlite");
const opportunityDb = new DatabaseSync(opportunityDbPath);
opportunityDb.exec(`
  CREATE TABLE opportunity_worker_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
opportunityDb.prepare(`
  INSERT INTO opportunity_worker_state(state_key, state_value, updated_at)
  VALUES ('last_cycle', ?, ?)
`).run(
  JSON.stringify({
    lastSuccessAt: "2026-05-21T03:30:00.000Z",
    lastError: null,
    candidateCount: 8,
    evaluatedCount: 3,
    selectedToday: 2,
    provider: "minimax",
    model: "MiniMax-M2.7",
  }),
  "2026-05-21T03:30:00.000Z",
);
opportunityDb.close();

try {
  const opportunityHealth = opportunityHealthItem({ OPPORTUNITY_DB: opportunityDbPath }, now);
  assert.equal(opportunityHealth.status, "ok");
  assert.equal(opportunityHealth.stale, false);
  assert.equal(opportunityHealth.updatedAt, "2026-05-21T03:30:00.000Z");
  assert.deepEqual(opportunityHealth.meta, {
    lastSuccessAt: "2026-05-21T03:30:00.000Z",
    lastError: null,
    candidates: 8,
    evaluated: 3,
    selected: 2,
    provider: "minimax",
    model: "MiniMax-M2.7",
  });

  const db = new DatabaseSync(opportunityDbPath);
  db.prepare(`
    UPDATE opportunity_worker_state
    SET state_value = ?, updated_at = ?
    WHERE state_key = 'last_cycle'
  `).run(
    JSON.stringify({
      lastSuccessAt: "2026-05-21T00:00:00.000Z",
      lastError: "OpportunityAiUnavailable",
      candidateCount: 8,
      evaluatedCount: 0,
      selectedToday: 2,
      provider: null,
      model: null,
    }),
    "2026-05-21T04:00:00.000Z",
  );
  db.close();
  const recoveredHealth = opportunityHealthItem({ OPPORTUNITY_DB: opportunityDbPath }, now);
  assert.equal(recoveredHealth.status, "warning");
  assert.equal(recoveredHealth.stale, true);
  assert.match(recoveredHealth.detail, /OpportunityAiUnavailable/);

  const failedDb = new DatabaseSync(opportunityDbPath);
  failedDb.prepare(`
    UPDATE opportunity_worker_state
    SET state_value = ?, updated_at = ?
    WHERE state_key = 'last_cycle'
  `).run(
    JSON.stringify({
      lastSuccessAt: null,
      lastError: "Error",
      candidateCount: 0,
      evaluatedCount: 0,
      selectedToday: 0,
      provider: null,
      model: null,
    }),
    "2026-05-21T04:00:00.000Z",
  );
  failedDb.close();
  assert.equal(
    opportunityHealthItem({ OPPORTUNITY_DB: opportunityDbPath }, now).status,
    "error",
  );
} finally {
  rmSync(opportunityDirectory, { recursive: true, force: true });
}

console.log("ok - system health status aggregation");
