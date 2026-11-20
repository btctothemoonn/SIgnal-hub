import assert from "node:assert/strict";
import { buildCardRows, eventTime, getCardChart, isSpecialAlert } from "./market-signal-card-model.ts";

const now = Date.UTC(2026, 10, 20, 4);
const ago = minutes => now - minutes * 60_000;
const iso = ms => new Date(ms).toISOString();
function alert(symbol, minutes, values = {}) {
  return {
    id: symbol + "-" + minutes, symbol, type: "volatility", side: "LONG", level: 1,
    createdAt: iso(ago(minutes)), occurredAt: iso(ago(minutes + 1)),
    price: 1.2, trigger: "A趋势·实时", volumeRatio: 5, metrics: {}, ...values,
  };
}
function phase(symbol, minutes, kind) {
  return { id: symbol + "-" + kind, symbol, kind, at: ago(minutes), price: 1.2 };
}
function burst(symbol, first) {
  return { symbol, firstAt: ago(first), lastAt: ago(first), firstPrice: 1.11, firstRatio: 6, firstQuoteVolume: 60_000, count: 1 };
}

const megaEarly = alert("MEGAUSDT", 14, {
  side: "SHORT", trigger: "B加速·实时", price: 0.05484, changePct: -3.72,
  volumeRatio: 136.77, metrics: { strengthPct: 5.1273 },
});
const megaUpgrade = alert("MEGAUSDT", 10, { side: "SHORT", level: 2, price: 0.05039, changePct: -12.04 });
const megaNormal = alert("MEGAUSDT", 2);
const up = alert("UPUSDT", 28, { level: 3 });
const squeeze = alert("SQUSDT", 22, { type: "short_squeeze", level: 2, stage: "轧空启动" });
const weak = phase("FADEUSDT", 20, "weakening");
const startup = phase("STARTUSDT", 6, "startup");
const oldStage = phase("FADEUSDT", 42, "startup");
const graduated = phase("FADEUSDT", 35, "pumped");
const related = burst("MEGAUSDT", 17);

const atThreshold = { ...megaEarly, trigger: "A趋势实时+B加速确认", metrics: { strengthPct: 5 }, volumeRatio: 20 };
assert.ok(isSpecialAlert(atThreshold));
for (const override of [
  { metrics: {} }, { metrics: { strengthPct: 4.999 } }, { metrics: { strengthPct: Infinity } },
  { volumeRatio: 19.99 }, { volumeRatio: null }, { trigger: "D先行·实时" },
  { side: null }, { type: "short_squeeze", level: 1, stage: "轧空蓄势" },
]) assert.equal(isSpecialAlert({ ...atThreshold, ...override }), false);

const data = {
  events: [
    megaEarly, megaNormal, megaUpgrade, up, squeeze,
    alert("FADEUSDT", 20, { side: "SHORT", level: 3 }),
    alert("STARTUSDT", 6, { level: 2 }), alert("OLDUSDT", 61, { level: 3 }),
    alert("FUTUREUSDT", -1, { level: 3 }), alert("TSLAUSDT", 8, { level: 3 }),
    alert("ORDINARYUSDT", 1), alert("FADEUSDT", 1),
  ],
  lifecycleEvents: [
    graduated, weak, oldStage, startup, phase("DONEUSDT", 43, "startup"),
    phase("DONEUSDT", 2, "pumped"), phase("UPUSDT", 20, "pumped"), phase("MEGAUSDT", 30, "startup"),
  ],
  volumeEpisodes: [burst("MEGAUSDT", 5), burst("OBSUSDT", 1), related, burst("SQUSDT", 143)],
  signals: { coinSymbols: ["MEGAUSDT","UPUSDT","SQUSDT","STARTUSDT","FADEUSDT","DONEUSDT","OLDUSDT","OBSUSDT","ORDINARYUSDT","FUTUREUSDT"] },
};
const rows = buildCardRows(data, { startMs: ago(60), endMs: now });
assert.deepEqual(rows.map(row => row.symbol), ["STARTUSDT", "MEGAUSDT", "FADEUSDT", "SQUSDT", "UPUSDT"]);
const mega = rows.find(row => row.symbol === "MEGAUSDT");
assert.deepEqual(mega.focus, { kind: "special", event: megaUpgrade });
assert.equal(mega.latestAt, eventTime(megaUpgrade), "ordinary events cannot reorder focused cards");
assert.deepEqual(mega.events, [megaNormal, megaUpgrade, megaEarly], "early crash and upgrade share a timeline");
assert.equal(mega.episode, related, "an unrelated later burst cannot hijack the focused event");
assert.deepEqual(rows[0].focus, { kind: "startup", phase: startup }, "a lifecycle stage wins a timestamp tie");
assert.deepEqual(rows[2].focus, { kind: "weakening", phase: weak });
assert.deepEqual(rows[2].lifecycleEvents, [weak, graduated, oldStage]);
assert.deepEqual(rows[3].focus, { kind: "special", event: squeeze });
assert.equal(rows[3].episode, undefined);
assert.deepEqual(rows[4].focus, { kind: "special", event: up }, "a later 20% crossing does not erase the surge");
const earlyOnly = buildCardRows(data, { startMs: ago(18), endMs: ago(12) });
assert.deepEqual(earlyOnly.find(row => row.symbol === "MEGAUSDT").focus, { kind: "special", event: megaEarly });

const chart = getCardChart([{ at: ago(70) }, { at: ago(2) }], now, mega);
assert.deepEqual(chart.bars.map(bar => bar.at), [ago(2)]);
assert.equal(chart.marks[0].at, eventTime(megaUpgrade));
assert.ok(chart.marks.some(mark => mark.at === eventTime(megaEarly) && mark.kind === "down"));
assert.ok(chart.marks.some(mark => mark.at === related.firstAt && mark.kind === "burst"));
assert.ok(getCardChart([], now, rows[2]).marks.some(mark => mark.kind === "weakening" && mark.price === weak.price));
console.log("ok - focused market events, graduation, upgrades and card chart context");
