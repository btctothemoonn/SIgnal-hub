import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleUrl = new URL("./system-health.ts", import.meta.url);
const systemHealthSource = readFileSync(moduleUrl, "utf8");
const {
  buildSystemHealthSnapshot,
  systemHealthStatusRank,
  summarizeCachedStocksSnapshot,
  summarizeMarketAlertsHeartbeat,
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
