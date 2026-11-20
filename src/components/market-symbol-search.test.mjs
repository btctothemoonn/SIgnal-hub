import assert from "node:assert/strict";
import { findMarketSymbols } from "./market-symbol-search.ts";

const symbols = ["BTCDOMUSDT", "WBTCUSDT", "BTCUSDT", "AAPLUSDT", "AAAUSDT"];
assert.deepEqual(findMarketSymbols(symbols, " btc "), ["BTCUSDT", "BTCDOMUSDT", "WBTCUSDT"]);
assert.deepEqual(findMarketSymbols(symbols, "$aapl"), ["AAPLUSDT"]);
assert.deepEqual(findMarketSymbols(symbols, "ｂｔｃ／ｕｓｄｔ"), ["BTCUSDT"]);
assert.deepEqual(findMarketSymbols(symbols, "AA"), ["AAAUSDT", "AAPLUSDT"]);
assert.deepEqual(findMarketSymbols(symbols, "USDT"), []);
assert.deepEqual(findMarketSymbols(symbols, "unknown"), []);
assert.deepEqual(findMarketSymbols(symbols, " / "), []);
