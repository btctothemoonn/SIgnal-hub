import assert from "node:assert/strict";
import { buildCardRows, currentStageEvent, eventTime, getCardChart } from "./market-signal-card-model.ts";

const minute = 60_000;
const now = Date.UTC(2026, 10, 3, 5, 44);
const ago = minutes => now - minutes * minute;
const iso = ms => new Date(ms).toISOString();
const episode = (symbol, first, last = first) => ({
  symbol, firstAt: ago(first), lastAt: ago(last), count: first === last ? 1 : 2,
  firstPrice: 1.1531, firstRatio: 6.05, firstQuoteVolume: 138800,
});
const event = (id, symbol, minutes, side = "LONG") => ({
  id, symbol, type: "volatility", side, level: 1, price: 1.203, createdAt: iso(ago(minutes)),
  occurredAt: iso(ago(minutes + 1)), trigger: "B加速·实时",
});
const pie = "PIEVERSEUSDT";
const fresh = episode(pie, 56, 40);
const earlier = episode(pie, 220, 190);
const long = event("long", pie, 1);
const data = {
  volumeEpisodes: [fresh, earlier, episode("OBSUSDT", 10), episode("OLDUSDT", 400), episode("OVERRUNUSDT", 130), episode("INWINDOWUSDT", 92, 25), episode("CONFIRMUSDT", 80)],
  events: [long, event("prior", pie, 59), event("short", "DOWNUSDT", 15, "SHORT"), event("equity", "TSLAUSDT", 8), event("late", "OVERRUNUSDT", 1), event("crosses", "CONFIRMUSDT", 2)],
  assetClasses: { TSLAUSDT: "EQUITY" },
  signals: { coinSymbols: [pie, "OBSUSDT", "OLDUSDT", "OVERRUNUSDT", "INWINDOWUSDT", "CONFIRMUSDT", "DOWNUSDT"] },
};
const rows = (direction = "all", asset = "crypto", watchlist = []) => buildCardRows(
  data, { startMs: ago(60), endMs: now, asset, direction, watchlist },
);
const find = (symbol, list = rows()) => list.find(row => row.symbol === symbol);

assert.equal(find(pie).episode, fresh);
assert.deepEqual(find(pie).confirmations.map(item => item.id), ["long"]);
assert.equal(find(pie).events.length, 2, "independent older triggers remain in the history");
assert.equal(eventTime(long), ago(1), "use actual creation time, not the candle bucket");
assert.equal(find("OLDUSDT"), undefined);
assert.equal(find("OVERRUNUSDT").episode, undefined, "a later independent event does not resurrect an expired observation");
assert.equal(find("INWINDOWUSDT").episode.count, 2);
assert.equal(find("CONFIRMUSDT").confirmations[0].id, "crosses", "an in-window confirmation keeps the first burst as context");
assert.deepEqual(rows("observation").map(row => row.symbol).sort(), ["INWINDOWUSDT", "OBSUSDT"]);
assert.deepEqual(rows("down").map(row => row.symbol), ["DOWNUSDT"]);
assert.deepEqual(rows("watch", "crypto", [pie]).map(row => row.symbol), [pie]);
assert.deepEqual(rows("all", "equity").map(row => row.symbol), ["TSLAUSDT"]);
assert.equal(find("OBSUSDT", rows("up")), undefined, "direction-neutral observations are not up alerts");

const bar = at => ({ at, open: 1.1, high: 1.3, low: 1, close: 1.2 });
const chart = getCardChart([bar(ago(70)), bar(ago(57)), bar(ago(2))], now, fresh, [long, event("out", pie, 65)]);
assert.deepEqual(chart.bars.map(item => item.at), [ago(57), ago(2)]);
assert.deepEqual(chart.marks.map(mark => [mark.kind, mark.at]), [["burst", fresh.firstAt], ["long", ago(1)]]);
assert.equal(getCardChart([], now, fresh, [long]).bars.length, 0);
const newerDown = event("reversal", pie, 0.5, "SHORT");
const squeeze = { ...event("squeeze", pie, 0.2), type: "short_squeeze", stage: "轧空启动" };
const mixed = { ...data, events: [newerDown, squeeze, ...data.events] };
const stages = direction => {
  const result = buildCardRows(mixed, { startMs: ago(60), endMs: now, asset: "crypto", direction, watchlist: [] });
  return currentStageEvent(find(pie, result), direction);
};
assert.equal(stages("all"), squeeze, "the latest independent trigger succeeds an older LONG");
assert.equal(stages("up"), long);
assert.equal(stages("down"), newerDown);
assert.equal(stages("squeeze"), squeeze);
assert.equal(currentStageEvent({ ...find(pie), events: [data.events[1]], confirmations: [] }, "all"), undefined, "a new burst takes precedence over earlier events");
assert.equal(getCardChart([bar(ago(2))], now, undefined, [], newerDown).marks[0].kind, "down");
assert.equal(getCardChart([bar(ago(2))], now, undefined, [], squeeze).marks[0].kind, "squeeze");
assert.equal(getCardChart([bar(ago(2))], now, undefined, [], long).marks[0].kind, "up", "an independent LONG is distinct from a burst confirmation");
console.log("ok - card filtering, observation lifetime, actual confirmation times and chart window");
