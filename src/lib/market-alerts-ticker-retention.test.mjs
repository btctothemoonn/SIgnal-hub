import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKET_TICKER_FRESH_MS, MARKET_TICKER_RETENTION_MS } from "./market-alerts-core.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";

assert.equal(MARKET_TICKER_FRESH_MS, 30 * 60 * 1000);
assert.equal(MARKET_TICKER_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);

const dir = mkdtempSync(join(tmpdir(), "ticker-retention-"));
const dbPath = join(dir, "alerts.sqlite");
const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const store = openMarketAlertsStore(dbPath);

function tickerSymbols() {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare("SELECT symbol FROM market_alert_tickers ORDER BY symbol").all().map((row) => row.symbol);
  } finally {
    db.close();
  }
}

try {
  store.upsertMarketTickers([
    { symbol: "FRESHUSDT", price: 2, pct24h: 4, quoteVolume: 10, updatedAt: iso(nowMs) },
    { symbol: "WEEKUSDT", price: 3, pct24h: -2, quoteVolume: 9, updatedAt: iso(nowMs - 6 * 24 * 60 * 60 * 1000) },
    { symbol: "OLDUSDT", price: 4, pct24h: 8, quoteVolume: 8, updatedAt: iso(nowMs - MARKET_TICKER_RETENTION_MS - 1000) },
  ]);
  assert.deepEqual(tickerSymbols(), ["FRESHUSDT", "WEEKUSDT"]);
  store.insertMarketAlertEvent({
    id: "volatility:LONG:FRESHUSDT:1",
    type: "volatility",
    symbol: "FRESHUSDT",
    side: "LONG",
    level: 2,
    stage: "test",
    trigger: "A趋势",
    source: "rest",
    price: 2,
    changePct: 4,
    volumeRatio: 2,
    score: null,
    metrics: {},
    reasons: [],
    occurredAt: iso(nowMs - 10 * 60 * 1000),
  });
  store.insertMarketAlertEvent({
    id: "volatility:LONG:WARMUSDT:1",
    type: "volatility",
    symbol: "WARMUSDT",
    side: "LONG",
    level: 1,
    stage: "test",
    trigger: "B加速",
    source: "rest",
    price: 5,
    changePct: 6,
    volumeRatio: 3,
    score: null,
    metrics: {},
    reasons: [],
    occurredAt: iso(nowMs - 20 * 60 * 1000),
  });
  store.insertMarketAlertEvent({
    id: "volatility:SHORT:STALEUSDT:1",
    type: "volatility",
    symbol: "STALEUSDT",
    side: "SHORT",
    level: 1,
    stage: "test",
    trigger: "A趋势",
    source: "rest",
    price: 6,
    changePct: -7,
    volumeRatio: 4,
    score: null,
    metrics: {},
    reasons: [],
    occurredAt: iso(nowMs - 25 * 60 * 1000),
  });
  store.upsertMarketTickers([
    { symbol: "WARMUSDT", price: 5, pct24h: 11, quoteVolume: 20, updatedAt: iso(nowMs - 20 * 60 * 1000) },
    { symbol: "STALEUSDT", price: 6, pct24h: -12, quoteVolume: 20, updatedAt: iso(nowMs - 31 * 60 * 1000) },
  ]);
  const snapshot = store.getMarketAlertsSnapshot({ now: iso(nowMs), limit: 10 });
  assert.deepEqual(snapshot.marketRanking.map((item) => item.symbol).sort(), ["FRESHUSDT", "WARMUSDT"]);
  assert.equal(snapshot.events.find((event) => event.symbol === "STALEUSDT")?.tickerUpdatedAt, iso(nowMs - 31 * 60 * 1000));
  assert.deepEqual(tickerSymbols(), ["FRESHUSDT", "STALEUSDT", "WARMUSDT", "WEEKUSDT"]);
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - stale market tickers are hidden after 30 minutes and deleted after 7 days");
