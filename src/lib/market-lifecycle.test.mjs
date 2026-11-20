import assert from "node:assert/strict";
import { test } from "node:test";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { LIFECYCLE_BAR_MS as barMs, runLifecycleObservations } from "./market-lifecycle.ts";

const origin = Date.UTC(2026, 10, 16);
const at = i => origin + i * barMs;
const sample = (i, close = 1, low = close, high = close) => ({ at: at(i), close, high, low });
const subject = "TESTUSDT";
const peers = Array.from({ length: 39 }, (_, i) => `PEER${i}USDT`);
const quiet = Array.from({ length: 110 }, (_, i) => sample(i));
const prices = [1.05, 1.21, 1.30, 1.28, 1.24, 1.15, 1.14, 1.10];
function eventBars() {
  const series = quiet.slice();
  for (let i = 0; i < prices.length; i++) series[100+i] = sample(100+i, prices[i]);
  series[106] = sample(106, 1.14, 1.13, 1.21);
  return series;
}
test("market breadth can arrive after an independent pump, weakness and failed retest", () => {
  const alerts = openMarketAlertsStore(":memory:");
  try {
    const store = alerts.lifecycle;
    const before = alerts.getMarketAlertsRevision();
    store.storeBars(subject, eventBars());
    store.evaluate([subject], at(109));
    let rows = alerts.listLifecycleEvents(at(0), at(109));
    assert.deepEqual(rows.map(r => r.kind), ["weakening", "pumped"]);
    const weakness = rows[0];
    assert.equal(weakness.at, at(105));
    assert.equal(weakness.pumpAt, at(101));
    assert.equal(weakness.peakPrice, 1.30);
    assert.ok(Math.abs(weakness.peakGainPct - 30) < 1e-9);
    assert.equal(weakness.supportPrice, 1.21);
    assert.equal(weakness.retestAt, at(107));
    assert.equal(alerts.listLifecycleEvents(at(100), at(106))[0].retestAt, undefined);
    assert.ok(alerts.getMarketAlertsRevision() > before);

    for (const p of peers) store.storeBars(p,quiet);
    store.evaluate([subject,...peers.slice(1)],at(109)); // 39 samples
    assert.ok(!alerts.listLifecycleEvents(at(0),at(109)).some(r => r.kind === "startup"));
    store.evaluate([subject,...peers],at(109)); // 40 samples
    rows = alerts.listLifecycleEvents(at(0),at(109));
    const startup = rows.find(r => r.kind === "startup");
    assert.equal(startup.at, at(100));
    assert.ok(Math.abs(startup.relativePct - 5) < 1e-9);
    const revision = alerts.getMarketAlertsRevision();
    store.evaluate([subject,...peers],at(109));
    assert.equal(alerts.getMarketAlertsRevision(),revision);
    assert.equal(alerts.listLifecycleEvents(at(0),at(109)).length,3);
  } finally { alerts.close(); }
});

test("an ordinary dump never becomes post-pump weakness and missing quarters cannot be bridged", () => {
  const alerts = openMarketAlertsStore(":memory:");
  try {
    const store = alerts.lifecycle;
    const dump = quiet.slice();
    for (let i = 100; i < dump.length; i++) dump[i] = sample(i, .75);
    store.storeBars("DUMPUSDT",dump);
    store.storeBars(subject,eventBars().filter((_,i) => i !== 90));
    store.evaluate(["DUMPUSDT",subject], at(109));
    assert.deepEqual(alerts.listLifecycleEvents(at(0),at(109)),[]);
    assert.equal(store.candleCoverage(subject,at(109)).repairDue,true);
    store.storeBars(subject,[sample(90)]);
    store.evaluate([subject],at(109));
    assert.deepEqual(alerts.listLifecycleEvents(at(0),at(109)).map(r => r.kind),["weakening","pumped"]);
  } finally { alerts.close(); }
});

test("worker seeds only confirmed perpetual quarters, recovers a hole and uses closed minute data thereafter", async () => {
  // Exercise the normal table schemas and public lifecycle store with a shared fixture.
  const alerts = openMarketAlertsStore(":memory:");
  try {
    const store = alerts.lifecycle;
    const rows = eventBars().map(b => [b.at-barMs,b.close,b.high,b.low,b.close,1,b.at-1,1]);
    const minute = 60_000;
    function putMinutes(i) {
      const mins = Array.from({length:15}, (_,j) => ({
        symbol:subject,at:at(i)-barMs+j*minute,open:1,high:1.01,low:.99,close:1,quoteVolume:1,observeVolume:true,
      }));
      alerts.recordCardMinutes(mins,at(i)+60_000);
    }
    putMinutes(109);
    let calls = 0;
    const input = { store, nowMs:at(109)+60_000, coinSymbols:new Set([subject]), errors:[],
      getKlines:async (_sym,interval) => {
        calls++;
        assert.equal(interval,"15m");
        return [...rows.filter((_,i) => calls!==1 || i!==90),[at(109),1,100,1,100,1,at(110)-1,1]];
      },
    };
    await runLifecycleObservations(input);
    assert.equal(calls,1);
    assert.equal(alerts.listLifecycleEvents(at(0),at(109)).length,0);
    assert.equal(store.candleCoverage(subject,at(110)).last,at(109)); // excluded still-open candle
    for (let i=110;i<=113;i++) {
      putMinutes(i);
      await runLifecycleObservations({...input,nowMs:at(i)+60_000});
    }
    assert.equal(calls,2);
    assert.ok(alerts.listLifecycleEvents(at(0),at(109)).some(r => r.kind === "weakening"));
    assert.deepEqual(input.errors,[]);
  } finally { alerts.close(); }
});

test("lifecycle win rates settle at the exact horizon and preserve sampled closes after retention", () => {
  const alerts = openMarketAlertsStore(":memory:");
  try {
    const store = alerts.lifecycle;
    store.storeBars(subject, eventBars());
    for (const peer of peers) store.storeBars(peer, quiet);
    store.evaluate([subject, ...peers], at(109));
    // The 4h startup close is flat. There is no 24h weakening close, even though adjacent bars exist.
    store.storeBars(subject, [sample(116, 1.05), sample(121, 1.30), sample(196, 1.2), sample(200, .8), sample(202, .8)]);
    const eligible = new Set([subject]);
    const rates = (from, to) => alerts.readLifecycleWinRates(from, to, eligible);
    const early = rates(at(0), at(104) - 1);
    assert.equal(early[0].total, 1);
    assert.deepEqual(early[0].horizons["1h"], { wins: 0, settled: 0 });
    assert.equal(early[1].total, 0);
    const expected = [
      { kind: "startup", total: 1, horizons: { "1h": { wins: 1, settled: 1 }, "4h": { wins: 0, settled: 1 }, "24h": { wins: 1, settled: 1 } } },
      { kind: "weakening", total: 1, horizons: { "1h": { wins: 1, settled: 1 }, "4h": { wins: 0, settled: 1 }, "24h": { wins: 0, settled: 0 } } },
    ];
    assert.deepEqual(rates(at(0), at(202)), expected);
    assert.deepEqual(rates(at(101), at(202)).map(row => row.total), [0, 1]);
    assert.deepEqual(alerts.readLifecycleWinRates(at(0), at(202), new Set(peers)).map(row => row.total), [0, 0]);

    store.evaluate([], at(500));
    assert.equal(store.candleCoverage(subject, at(202)).last, at(196), "unused old bars still expire");
    assert.deepEqual(rates(at(0), at(500)), expected);
  } finally { alerts.close(); }
});
