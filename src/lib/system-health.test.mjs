import assert from "node:assert/strict";

const moduleUrl = new URL("./system-health.ts", import.meta.url);
const {
  buildSystemHealthSnapshot,
  systemHealthStatusRank,
  summarizeCachedStocksSnapshot,
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

console.log("ok - system health status aggregation");
