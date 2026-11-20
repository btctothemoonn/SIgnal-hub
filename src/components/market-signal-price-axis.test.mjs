import assert from "node:assert/strict";
import { getCardPriceTicks } from "./market-signal-price-axis.ts";

const ticks = getCardPriceTicks(101, 102, 5);
assert.deepEqual(ticks.map(tick => tick.label), ["102", "101.75", "101.5", "101.25", "101"]);
assert.deepEqual(getCardPriceTicks(0.0023, 0.0023, 5), [{ price: 0.0023, label: "0.0023" }]);
for (const [low, high] of [
  [0.000012341, 0.000012349], [1.0000000000001, 1.0000000000002],
  [1e-12, 1.00001e-12], [1e15, 1e15 + 3], [1, 1 + Number.EPSILON],
  [Number.MIN_VALUE, Number.MIN_VALUE * 2], [1e308, Number.MAX_VALUE],
]) {
  const range = getCardPriceTicks(low, high, 5);
  assert.equal(range[0].price, high);
  assert.equal(range.at(-1).price, low);
  assert.equal(new Set(range.map(tick => tick.label)).size, range.length);
  assert.ok(range.every(({ price, label }, index) => Number.isFinite(Number(label)) &&
    Number(label) > 0 && (!index || price < range[index - 1].price)));
}
assert.ok(getCardPriceTicks(1e-12, 2e-12, 3).every(({ label }) => label.includes("e-")));
for (const args of [[NaN, 1, 3], [1, Infinity, 3], [0, 1, 5], [2, 1, 5], [1, 2, 0]]) {
  assert.deepEqual(getCardPriceTicks(...args), []);
}
console.log("ok - candlestick price axis ticks");