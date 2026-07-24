import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-today-changes.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("./alpha-research-page.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function StocksTodayChanges/);
assert.match(source, /今日变化/);
assert.match(source, /data-testid="stocks-today-changes"/);
assert.match(source, /onSelectTicker\(item\.ticker\)/);
assert.match(source, /changes\.map/);
assert.match(pageSource, /buildStocksTodayChanges\(stocks/);
assert.match(pageSource, /<StocksTodayChanges/);
assert.match(pageSource, /onSelectTicker=\{setSelectedTicker\}/);

console.log("ok - stocks today changes component contract");
