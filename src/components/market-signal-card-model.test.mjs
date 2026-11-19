import assert from "node:assert/strict";
import { buildCardRows, eventTime, getCardChart } from "./market-signal-card-model.ts";

const now = Date.UTC(2026, 10, 3, 5, 44);
const ago = minutes => now - minutes * 60_000;
const iso = ms => new Date(ms).toISOString();
const pie = "PIEVERSEUSDT";
const event = (id,symbol,minutes,side = "LONG") => ({
  id, symbol, type: "volatility", side, level: 1, price: 1.2, createdAt: iso(ago(minutes)),
  occurredAt: iso(ago(minutes + 1)), trigger: "B加速·实时",
});
const stage = (id,symbol,minutes,kind) => ({ id,symbol,kind,at:ago(minutes),price:1.2 });
const burst = (symbol,first,last=first) => ({symbol, firstAt:ago(first), lastAt:ago(last), firstPrice:1.11, firstRatio:6.05, firstQuoteVolume:138800, count:first===last?1:2});
const long=event("long",pie,12), down=event("down","DOWNUSDT",10,"SHORT");
const early=stage("early",pie,42,"startup"), pumped=stage("pump",pie,35,"pumped"), weak=stage("weak",pie,20,"weakening");
const prior=burst(pie,46,6);
const data={
  events:[long,down,event("stock","TSLAUSDT",8),event("old","OLDUSDT",100)],
  lifecycleEvents:[pumped,weak,early,stage("new","NEWUSDT",1,"startup"),stage("pending","DONEUSDT",43,"startup"),stage("done","DONEUSDT",2,"pumped")],
  volumeEpisodes:[burst(pie,5),burst("OBSUSDT",1),prior,burst("OLDUSDT",1),burst("DOWNUSDT",131)],
  assetClasses:{TSLAUSDT:"EQUITY"},
  signals:{coinSymbols:[pie,"DOWNUSDT","NEWUSDT","DONEUSDT","OLDUSDT","OBSUSDT"]},
};
const rows=(view="focus", direction="all", asset="crypto", watchlist=[])=>buildCardRows(data,{view,direction,asset,watchlist,startMs:ago(60),endMs:now});
const focus=rows();
assert.deepEqual(focus.map(row=>row.symbol),["NEWUSDT",pie],"a pumped coin graduates from startup, one card per focused symbol");
const focused=focus.find(r=>r.symbol===pie);
assert.equal(focused.primaryLifecycle,weak);
assert.equal(focused.latestAt,weak.at);
assert.deepEqual(focused.events,[long],"raw events enrich an existing focus card");
assert.deepEqual(focused.lifecycleEvents,[weak,pumped,early]);
assert.equal(focused.episode,prior,"a newer unrelated burst cannot replace context for a stage");
assert.deepEqual(rows("all").map(row=>row.symbol),["NEWUSDT","DONEUSDT","DOWNUSDT",pie],"only real signals affect order and visibility");
assert.equal(rows("all").find(r=>r.symbol===pie).primaryLifecycle,undefined,"in the archive a more recent raw alert can headline");
assert.deepEqual(rows("all","watch","crypto",["OBSUSDT",pie]).map(r=>r.symbol),[pie]);
assert.deepEqual(rows("all","all","equity").map(r=>r.symbol),["TSLAUSDT"]);
const downRows=rows("all","down");
assert.deepEqual(downRows.map(r=>r.symbol),["DOWNUSDT"]);
assert.equal(downRows[0].episode,undefined,"expired volume does not attach");
const up = rows("all", "up").find(row => row.symbol === pie);
assert.equal(up.primaryLifecycle, undefined, "direction filters use the selected price alert as the headline");
assert.deepEqual(up.lifecycleEvents, [weak, pumped, early], "lifecycle is available as background on matching alert cards");
assert.equal(eventTime(long),ago(12));
const chart=getCardChart([{at:ago(70)},{at:ago(2)}],now,focused);
assert.deepEqual(chart.bars.map(b=>b.at),[ago(2)]);
assert.ok(chart.marks.some(m=>m.kind==="weakening" && m.at===weak.at && m.price===weak.price));
assert.ok(chart.marks.some(m=>m.kind==="startup" && m.at===early.at));
assert.ok(chart.marks.some(m=>m.kind==="pumped" && m.at===pumped.at));
assert.ok(chart.marks.some(m=>m.kind==="burst" && m.at===prior.firstAt));
assert.deepEqual(getCardChart([],ago(21),focused).marks.filter(m=>m.kind==="weakening"),[]);
assert.equal(rows("all").find(r=>r.symbol==="OLDUSDT"),undefined);
assert.equal(rows("all").find(r=>r.symbol==="OBSUSDT"),undefined);
console.log("ok - lifecycle grouping, graduation, archive filters, actual signal times and chart context");
