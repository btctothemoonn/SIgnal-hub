import assert from "node:assert/strict";

const { getDailyBriefGroup, groupDailyBriefItems } = await import(
  "./daily-brief-display.ts"
);

function item(topic, rank) {
  return { topic, rank };
}

assert.equal(getDailyBriefGroup(item("AI / 科技产业链", 1)), "ai");
assert.equal(getDailyBriefGroup(item("半导体 / 存储 / 海力士", 2)), "ai");
assert.equal(getDailyBriefGroup(item("BTC / 加密货币", 3)), "crypto");
assert.equal(getDailyBriefGroup(item("宏观 / 地缘政治 / 原油", 4)), "markets");
assert.equal(getDailyBriefGroup(item("美股 / 韩股 / A股", 5)), "markets");

const grouped = groupDailyBriefItems([
  item("BTC / 加密货币", 1),
  item("AI / 科技产业链", 2),
  item("宏观 / 地缘政治 / 原油", 3),
]);
assert.deepEqual(grouped.ai.map((entry) => entry.rank), [2]);
assert.deepEqual(grouped.crypto.map((entry) => entry.rank), [1]);
assert.deepEqual(grouped.markets.map((entry) => entry.rank), [3]);

console.log("ok - daily brief display groups AI, crypto, and markets");
