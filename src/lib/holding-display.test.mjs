import assert from "node:assert/strict";
import { formatUsdtPrice } from "./holding-display.ts";

assert.equal(formatUsdtPrice(65000), "$65,000.00");
assert.equal(formatUsdtPrice(1.23456), "$1.2346");
assert.equal(formatUsdtPrice(0.123456), "$0.123456");
assert.equal(formatUsdtPrice(0.00001234), "$0.00001234");
assert.equal(formatUsdtPrice(0), "-");

console.log("ok - holding display formatters");
