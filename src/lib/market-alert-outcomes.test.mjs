import assert from "node:assert/strict";
import {
  alertTriggerGroup,
  directionalPct,
  fillAlertOutcome,
  seedFromEvent,
  summarizeAlertOutcomes,
} from "./market-alert-outcomes.ts";
import { openMarketSignalsStore, readMarketSignalsSnapshot } from "./market-signals.ts";
import { runMarketSignalsCycle } from "./market-signals-worker.ts";

const M5 = 5 * 60_000;
const H = 60 * 60_000;
const T = Date.parse("2026-11-10T00:00:00.000Z");

assert.equal(alertTriggerGroup({ type: "volatility", stage: "暴涨预警", trigger: "A趋势实时+B加速实时" }), "A+B");
assert.equal(alertTriggerGroup({ type: "volatility", stage: "暴跌预警", trigger: "B加速·确认" }), "B加速");
assert.equal(alertTriggerGroup({ type: "volatility", stage: "暴涨预警", trigger: "D先行·实时" }), "D先行");
assert.equal(alertTriggerGroup({ type: "short_squeeze", stage: "轧空启动", trigger: "轧空启动" }), "轧空启动");
assert.equal(directionalPct("crash", -4), 4);
assert.equal(directionalPct("pump", -4), -4);

const event = (id, side, trigger, at = T, extra = {}) => ({
  id, type: "volatility", symbol: "AUSDT", side, level: 1, stage: side === "LONG" ? "暴涨预警" : "暴跌预警",
  trigger, source: "ws", price: 1, occurredAt: new Date(at).toISOString(), metrics: { pct24h: 12.5 }, ...extra,
});
assert.equal(seedFromEvent({ ...event("x", "LONG", "B加速·实时"), type: "opportunity" }), null);
assert.equal(seedFromEvent(event("x", "LONG", "B加速·实时")).pre24hPct, 12.5);

// Price path: +2% by 1h, +5% by 4h, -3% by 24h; spike to 1.10 and dip to 0.95 inside the window.
function path(t) {
  const k = (t - T) / H;
  if (k < 0) return 1;
  if (k < 1) return 1.02;
  if (k < 4) return 1.05;
  return 0.97;
}
const fiveMinBars = [];
for (let t = T - 2 * M5; t < T + 30 * H; t += M5) {
  const c = path(t);
  fiveMinBars.push({ t, o: c, h: t === T + 2 * H ? 1.1 : c, l: t === T + 10 * H ? 0.95 : c, c });
}

const seeded = seedFromEvent(event("e1", "LONG", "B加速·实时"));
assert.equal(fillAlertOutcome(seeded, fiveMinBars, T + 30 * 60_000), null, "nothing due before 1h");
const at2h = fillAlertOutcome(seeded, fiveMinBars, T + 2 * H);
assert.equal(at2h.ret1hPct, 2);
assert.equal(at2h.ret4hPct, null);
assert.equal(at2h.completed, false);
// Bars after "now" are not closed yet and must not be used.
assert.equal(fillAlertOutcome(at2h, fiveMinBars, T + 3 * H), null);
const done = fillAlertOutcome(at2h, fiveMinBars, T + 25 * H);
assert.equal(done.ret4hPct, 5);
assert.equal(done.ret24hPct, -3);
assert.equal(done.maxUpPct, 10);
assert.equal(done.maxDownPct, -5);
assert.equal(done.completed, true);
// A data gap leaves the horizon empty, and the row is given up once well past 24h.
const gapped = fillAlertOutcome(seeded, fiveMinBars.filter((bar) => bar.t < T), T + 2 * H);
assert.equal(gapped, null);
assert.equal(fillAlertOutcome(seeded, [], T + 37 * H).completed, true);

const crash = { ...seedFromEvent(event("e2", "SHORT", "A趋势·实时")), ret1hPct: -2, ret4hPct: 1, ret24hPct: -8 };
const pumpEsc = { ...seedFromEvent(event("e3", "LONG", "B加速·实时", T, { level: 2, stage: "暴涨升级" })), ret1hPct: 1, ret4hPct: null, ret24hPct: null };
const groups = summarizeAlertOutcomes([done, crash, pumpEsc]);
const find = (category, group) => groups.find((row) => row.category === category && row.group === group);
assert.equal(find("pump", "全部").total, 2);
assert.equal(find("pump", "B加速").horizons["1h"].winRate, 1);
assert.equal(find("pump", "B加速").horizons["24h"].n, 1);
assert.equal(find("pump", "L2+ 升级").total, 1);
assert.equal(find("crash", "A趋势").horizons["1h"].winRate, 1, "a crash alert wins when price falls");
assert.equal(find("crash", "A趋势").horizons["4h"].winRate, 0);
assert.equal(find("crash", "A趋势").horizons["24h"].medianPct, 8);

// Worker cycle: seeds alerts from the alerts store and fills due horizons from 5m klines.
{
  const signals = openMarketSignalsStore(":memory:");
  const raw = fiveMinBars.map((bar) => [bar.t, String(bar.o), String(bar.h), String(bar.l), String(bar.c)]);
  const calls = [];
  const client = {
    async getKlinesSince(symbol, interval, startTime, limit) {
      calls.push([symbol, interval]);
      return raw.filter((row) => row[0] >= startTime).slice(0, limit);
    },
    async getHourlyOpenInterest() { return []; },
    async getPremiumIndex() { return []; },
    async getTickers24h() { return []; },
  };
  const events = [
    event("w1", "SHORT", "A趋势·实时"),
    { ...event("w2", "LONG", "轧空启动"), type: "short_squeeze", stage: "轧空启动" },
  ];
  const alerts = { getMarketAlertsSnapshot: () => ({ events }) };
  const env = { MARKET_SIGNAL_AI_ENABLED: "false" };
  const first = await runMarketSignalsCycle({ env, nowMs: T + 2 * H, alerts, signals, client });
  assert.equal(first.alertOutcomes.seeded, 2);
  assert.equal(first.alertOutcomes.updated, 2);
  assert.ok(calls.some(([, interval]) => interval === "5m"));
  const second = await runMarketSignalsCycle({ env, nowMs: T + 2 * H + M5, alerts, signals, client });
  assert.equal(second.alertOutcomes.seeded, 0, "seeding is idempotent");
  assert.equal(second.alertOutcomes.symbols, 0, "no request while no horizon is due");
  await runMarketSignalsCycle({ env, nowMs: T + 25 * H, alerts, signals, client });
  const snapshot = readMarketSignalsSnapshot({ store: signals, nowMs: T + 25 * H, env });
  const crashAll = snapshot.alertOutcomeStats.groups.find((row) => row.category === "crash" && row.group === "全部");
  assert.equal(crashAll.horizons["24h"].winRate, 1);
  assert.equal(snapshot.alertOutcomeStats.groups.find((row) => row.category === "squeeze" && row.group === "轧空启动").horizons["4h"].winRate, 1);
  assert.deepEqual(snapshot.recentAlertOutcomes.w1, { "1h": 2, "4h": 5, "24h": -3 });
  assert.equal(signals.alertOutcomes.due(T + 25 * H, 10).length, 0);
  signals.close();
}

console.log("market-alert-outcomes tests passed");
