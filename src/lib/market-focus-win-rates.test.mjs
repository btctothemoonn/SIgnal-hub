import assert from "node:assert/strict";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { openMarketSignalsStore, readMarketSignalsSnapshot } from "./market-signals.ts";

const H = 3_600_000;
const now = Date.UTC(2026, 10, 20);
const cutoff = now - 14 * 24 * H;
const iso = t => new Date(t).toISOString();
const alerts = openMarketAlertsStore(":memory:");
const signals = openMarketSignalsStore(":memory:");
function track(id, symbol, at, overrides = {}) {
  alerts.insertMarketAlertEvent({
    id, symbol, occurredAt: iso(at), createdAt: iso(at), type: "volatility", side: "LONG",
    stage: "暴涨", trigger: "B加速", source: "ws", price: 8, changePct: 2,
    level: 1, volumeRatio: 20, score: null, metrics: { strengthPct: 5 }, reasons: [], ...overrides,
  });
}
function outcome(eventId, at, category, symbol, returns) {
  const seed = { eventId, symbol, category, refPrice: 8, triggerGroup: "B加速", stage: "", level: 1,
    source: "ws", occurredAt: iso(at), pre24hPct: null, ret1hPct: null, ret4hPct: null, ret24hPct: null,
    maxUpPct: null, maxDownPct: null, completed: true, attempts: 1, ...returns };
  signals.alertOutcomes.seed([seed], now);
  signals.alertOutcomes.save(seed, now);
}
const crypto = "MEGAUSDT", stock = "SOXSUSDT";
signals.replaceSymbolClasses([
  { symbol: crypto, underlyingType: "COIN", activeUsdtPerpetual: true },
  { symbol: stock, underlyingType: "EQUITY", activeUsdtPerpetual: true },
], now);
try {
  // An exact-boundary B-acceleration and a later L2 upgrade are separate recorded triggers.
  track("fast", crypto, cutoff);
  track("upgrade", crypto, now - 2 * H, { level: 2, volumeRatio: null, metrics: {} });
  track("soft", crypto, now - 5 * H, { volumeRatio: 19.99 });
  track("similar", crypto, now - 6 * H, { trigger: "A趋势", metrics: { strengthPct: 10 } });
  track("old", crypto, cutoff - 1, { level: 3 });
  track("future", crypto, now + H, { level: 3 });
  track("late-ingest", crypto, now - H, { level: 2, createdAt: iso(now + 1) });
  track("drop", crypto, now - 25 * H, { side: "SHORT", trigger: "A趋势+B加速" });
  track("unseeded", crypto, now, { side: "SHORT", level: 2 });
  track("squeeze", crypto, now - 5 * H, { type: "short_squeeze", side: null, level: 2 });
  track("ordinary-squeeze", crypto, now - 5 * H, { type: "short_squeeze", side: null, level: 1 });
  track("stock", stock, now - 3 * H, { side: "SHORT", level: 2 });
  track("stock-squeeze", stock, now - H, { type: "short_squeeze", level: 3 });
  outcome("fast", cutoff, "pump", crypto, { ret1hPct: 2, ret4hPct: 0, ret24hPct: -3 });
  outcome("upgrade", now - 2 * H, "pump", crypto, { ret1hPct: -1, ret4hPct: 1 });
  outcome("soft", now - 5 * H, "pump", crypto, { ret1hPct: 100 });
  outcome("drop", now - 25 * H, "crash", crypto, { ret1hPct: -1, ret4hPct: 1 });
  outcome("squeeze", now - 5 * H, "squeeze", crypto, { ret1hPct: 1 });
  outcome("stock", now - 3 * H, "crash", stock, { ret1hPct: -2 });
  const candidates = alerts.listFocusAlertCandidates(iso(cutoff), iso(now));
  const snapshot = market => readMarketSignalsSnapshot({ store: signals, nowMs: now, market,
    focusAlerts: [...candidates, ...candidates] }).specialWinRates;
  const rows = snapshot("crypto");
  const pump = rows.find(row => row.kind === "pump"), crash = rows.find(row => row.kind === "crash");
  assert.equal(pump.total, 2);
  assert.deepEqual(pump.horizons, { "1h": { wins: 1, settled: 2 }, "4h": { wins: 0, settled: 1 }, "24h": { wins: 0, settled: 1 } });
  assert.equal(crash.total, 2, "include signals missing the outcome row in total only");
  assert.deepEqual(crash.horizons, { "1h": { wins: 1, settled: 1 }, "4h": { wins: 0, settled: 1 }, "24h": { wins: 0, settled: 0 } });
  assert.deepEqual(rows.find(row => row.kind === "squeeze").horizons["1h"], { wins: 1, settled: 1 });
  const equities = snapshot("equities");
  assert.deepEqual(equities.map(row => [row.kind, row.total]), [["pump", 0], ["crash", 1]]);
  assert.deepEqual(equities[1].horizons["1h"], { wins: 1, settled: 1 });
} finally {
  alerts.close();
  signals.close();
}
console.log("ok - focus win rates use qualifying triggers, direction, closed horizons and each market's universe");
