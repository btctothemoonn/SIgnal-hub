import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAlphaSummaryPeriod } from "./alpha-summary.ts";

const moduleUrl = new URL("./system-health.ts", import.meta.url);
const systemHealthSource = readFileSync(moduleUrl, "utf8");
const {
  buildSystemHealthSnapshot,
  systemHealthStatusRank,
  summarizeCachedStocksSnapshot,
  summarizeMarketAlertsHeartbeat,
  summarizeServiceState,
  summaryHealthItem,
  stocksHealthStaleMs,
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

const liveMarketWorker = summarizeMarketAlertsHeartbeat({
  id: "market-volatility-rest",
  label: "暴涨暴跌 REST",
  heartbeat: {
    worker: "volatility-rest",
    status: "live",
    detail: "扫描 200 个合约",
    meta: { scanned: 200 },
    updatedAt: "2026-05-21T03:59:00.000Z",
  },
  now,
  staleMs: 3 * 60 * 1000,
});

assert.equal(liveMarketWorker.status, "ok");
assert.equal(liveMarketWorker.stale, false);
assert.match(liveMarketWorker.detail, /200/);

const missingMarketWorker = summarizeMarketAlertsHeartbeat({
  id: "market-squeeze",
  label: "轧空监控",
  heartbeat: null,
  now,
  staleMs: 3 * 60 * 1000,
});

assert.equal(missingMarketWorker.status, "warning");
assert.equal(missingMarketWorker.stale, true);

const snapshot = buildSystemHealthSnapshot({
  generatedAt: now.toISOString(),
  items: [freshMarket, staleCatalysts, missingFinancials, inactiveService],
});

assert.equal(snapshot.status, "error");
assert.equal(systemHealthStatusRank("ok") < systemHealthStatusRank("warning"), true);
assert.equal(systemHealthStatusRank("warning") < systemHealthStatusRank("error"), true);
assert.doesNotMatch(
  systemHealthSource,
  /opportunityHealthItem|getOpportunityDbPath|OPPORTUNITY_DB/,
);

console.log("ok - system health status aggregation");

const summaryDir = mkdtempSync(join(tmpdir(), "summary-health-"));
const summaryDbPath = join(summaryDir, "summary.sqlite");
const summaryDb = new DatabaseSync(summaryDbPath);
summaryDb.exec(`create table alpha_summary_cache (
  period_key text primary key, model text, item_count integer, status text,
  error text, generated_at text, updated_at text
)`);
try {
  const scopes = ["12h", "today", "3d", "7d"];
  for (const scope of scopes) {
    summaryDb.prepare("insert into alpha_summary_cache values (?, 'test', 10, ?, ?, ?, ?)")
      .run(getAlphaSummaryPeriod({ now, audience: "stocks", scope }).key,
        scope === "12h" ? "error" : "generated", scope === "12h" ? "invalid JSON" : null,
        "2026-05-21T03:50:00.000Z", scope === "12h" ? "2026-05-21T03:50:00.000Z" : "2026-05-21T03:55:00.000Z");
  }
  const input = { audience: "stocks", label: "stocks", now, env: { STOCKS_SUMMARY_DB: summaryDbPath } };
  assert.equal(typeof summaryHealthItem, "function", "health must inspect all current summary scopes");
  const errored = summaryHealthItem(input);
  assert.equal(errored.status, "error");
  assert.match(errored.detail, /12h.*invalid JSON/);
  summaryDb.exec("update alpha_summary_cache set status = 'generated', error = null");
  assert.equal(summaryHealthItem(input).status, "ok");
  const weeklyKey = getAlphaSummaryPeriod({ now, audience: "stocks", scope: "7d" }).key;
  summaryDb.prepare("update alpha_summary_cache set updated_at = ?, generated_at = ? where period_key = ?")
    .run(new Date(now.getTime() - 14 * 60 * 60_000).toISOString(), new Date(now.getTime() - 14 * 60 * 60_000).toISOString(), weeklyKey);
  assert.equal(summaryHealthItem(input).status, "ok", "a weekly summary refreshed daily must not use the 12h-scope freshness limit");
  summaryDb.prepare("update alpha_summary_cache set updated_at = ?, generated_at = ? where period_key = ?")
    .run(new Date(now.getTime() - 26 * 60 * 60_000).toISOString(), new Date(now.getTime() - 26 * 60 * 60_000).toISOString(), weeklyKey);
  assert.equal(summaryHealthItem(input).status, "warning", "an overdue daily refresh must still be detected");
  summaryDb.prepare("delete from alpha_summary_cache where period_key = ?")
    .run(getAlphaSummaryPeriod({ now, audience: "stocks", scope: "7d" }).key);
  assert.equal(summaryHealthItem(input).status, "warning");
  assert.match(summaryHealthItem(input).detail, /7d.*missing/);
  assert.ok(stocksHealthStaleMs("financial", { STOCKS_CACHE_WORKER_FINANCIAL_INTERVAL_MS: "43200000" }) > 12 * 60 * 60 * 1000);
} finally {
  summaryDb.close();
  rmSync(summaryDir, { recursive: true, force: true });
}
