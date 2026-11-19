import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openMarketSignalsStore } from "./market-signals.ts";
import { runMarketSignalsCycle } from "./market-signals-worker.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { readMarketCardMetrics } from "./market-card-metrics.ts";

const minute = 60_000;
const hour = 60 * minute;
const boundary = Date.parse("2026-11-15T10:00:00Z");
const now = boundary + 12 * minute + 15_000;
const blank = { oi1hPct: null, fundingRate: null, shortLiquidations15m: null };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "market-card-metrics-"));
  const env = { MARKET_SIGNALS_DB: join(directory, "signals.sqlite"), MARKET_ALERTS_DB: join(directory, "alerts.sqlite") };
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { env, stores };
}

test("the hourly scan stores exact-hour OI quantity and source-stamped funding, including zero rates", async (t) => {
  const { env, stores } = fixture(t);
  const legacy = new DatabaseSync(env.MARKET_SIGNALS_DB);
  legacy.exec(`CREATE TABLE market_positioning_hourly (
    symbol TEXT, hour_ms INTEGER, close REAL, oi_value REAL, funding REAL, PRIMARY KEY(symbol,hour_ms)
  )`);
  legacy.prepare("INSERT INTO market_positioning_hourly VALUES (?,?,?,?,?)").run("OLDUSDT", boundary-hour, 1, 75, 0.01);
  legacy.close();
  assert.deepEqual(readMarketCardMetrics(["OLDUSDT"], now, env).OLDUSDT, blank);
  const signals = openMarketSignalsStore(env.MARKET_SIGNALS_DB);
  stores.push(signals);
  const oiRows = [
    { timestamp: boundary, sumOpenInterest: "125", sumOpenInterestValue: "90" },
    { timestamp: boundary - hour, sumOpenInterest: "100", sumOpenInterestValue: "100" },
    { timestamp: boundary + hour, sumOpenInterest: "10000", sumOpenInterestValue: "150" },
  ];
  const symbols = ["ALPHAUSDT", "GAPUSDT", "EMPTYUSDT", "OFFHOURUSDT"];
  const client = {
    async getExchangeInfo() { return { symbols: symbols.map(symbol => ({ symbol, underlyingType: "COIN" })) }; },
    async getTickers24h() { return symbols.map(symbol => ({ symbol, quoteVolume: "10000000" })); },
    async getPremiumIndex() {
      return [
        { symbol: "ALPHAUSDT", lastFundingRate: "-0.001", time: now },
        { symbol: "BTCUSDT", lastFundingRate: "0", time: now },
        { symbol: "EMPTYUSDT", lastFundingRate: "", time: now },
        { symbol: "GAPUSDT", lastFundingRate: "0.002", time: now - 3 * hour },
        { symbol: "OFFHOURUSDT", lastFundingRate: "0.01" },
      ];
    },
    async getHourlyOpenInterest(symbol) {
      if (symbol === "GAPUSDT") return [oiRows[0], { ...oiRows[1], timestamp: boundary - 2 * hour }];
      if (symbol === "EMPTYUSDT") return [oiRows[1], { ...oiRows[0], sumOpenInterest: null }];
      if (symbol === "OFFHOURUSDT") return [oiRows[1], { ...oiRows[0], timestamp: boundary + 20 * minute }];
      return oiRows;
    },
    async getKlinesSince() { return [3, 2, 1].map(i => [boundary - i * hour, "1", "2", "1", "2"]); },
  };
  const cycle = await runMarketSignalsCycle({ nowMs: now, signals, alerts: { getMarketAlertsSnapshot: () => ({ events: [] }) }, client, env });
  assert.deepEqual(cycle.errors, []);
  const metrics = readMarketCardMetrics([...symbols, "BTCUSDT", "OLDUSDT", "ALPHAUSDT"], now, env);
  assert.deepEqual(metrics.ALPHAUSDT, { ...blank, oi1hPct: 25, fundingRate: -0.001 });
  assert.deepEqual(metrics.BTCUSDT, { ...blank, fundingRate: 0 });
  for (const symbol of ["GAPUSDT", "EMPTYUSDT", "OFFHOURUSDT", "OLDUSDT"]) assert.deepEqual(metrics[symbol], blank, symbol);
  assert.deepEqual(readMarketCardMetrics(["ALPHAUSDT"], now + 2 * hour, env).ALPHAUSDT, blank);
  assert.deepEqual(readMarketCardMetrics(["ALPHAUSDT"], boundary - 1, env).ALPHAUSDT, blank);

  const alerts = openMarketAlertsStore(env.MARKET_ALERTS_DB);
  stores.push(alerts);
  const at = new Date(now + minute).toISOString();
  for (const [symbol, rate, sourceTime] of [
    ["ALPHAUSDT", -0.002, at], ["BTCUSDT", 0.003, new Date(now - minute).toISOString()],
    ["GAPUSDT", 0.005, new Date(now - 2 * hour).toISOString()], ["OFFHOURUSDT", 0.002, null],
  ]) alerts.upsertOpportunityEnrichment({
    symbol, fetchedAt: at, stale: false, error: null,
    metrics: { symbol, funding: rate, pushEvidence: { sourceTimes: { funding: sourceTime } } },
  });
  const latest = readMarketCardMetrics(["ALPHAUSDT", "BTCUSDT", "GAPUSDT", "OFFHOURUSDT"], now + minute, env);
  assert.equal(latest.ALPHAUSDT.fundingRate, -0.002, "a newer premium sample from the opportunity scan wins");
  assert.equal(latest.BTCUSDT.fundingRate, 0, "an older sample does not displace the hourly premium");
  assert.equal(latest.GAPUSDT.fundingRate, null, "refreshing an enrichment record cannot refresh stale exchange data");
  assert.equal(latest.OFFHOURUSDT.fundingRate, null, "funding without exchange time is unavailable");
});

test("only complete 15-minute coverage makes short liquidation sums and observed zero available", t => {
  const { env, stores } = fixture(t);
  const store = openMarketAlertsStore(env.MARKET_ALERTS_DB);
  stores.push(store);
  const end = Math.floor(now / minute) * minute;
  const start = end - 15 * minute;
  for (const [symbol, minuteAt, side, notionalUsdt] of [
    ["AUSDT", start - minute, "BUY", 20_000], ["AUSDT", start, "BUY", 200],
    ["AUSDT", end - minute, "BUY", 31], ["AUSDT", start + minute, "SELL", 450],
    ["AUSDT", end, "BUY", 30_000], ["BUSDT", end - minute, "SELL", 700],
  ]) store.recordMarketLiquidation({ symbol, minuteAt, side, notionalUsdt });
  store.recordLiquidationCoverage(start, start + 8 * minute);
  store.recordLiquidationCoverage(start + 9 * minute, end);
  function read() { return readMarketCardMetrics(["AUSDT", "BUSDT", "CUSDT"], now, env); }
  assert.deepEqual(read().AUSDT, blank);
  assert.deepEqual(read().CUSDT, blank);
  store.recordLiquidationCoverage(start + 8 * minute, start + 9 * minute);
  assert.deepEqual(read(), {
    AUSDT: { ...blank, shortLiquidations15m: 231 },
    BUSDT: { ...blank, shortLiquidations15m: 0 },
    CUSDT: { ...blank, shortLiquidations15m: 0 },
  });
});
