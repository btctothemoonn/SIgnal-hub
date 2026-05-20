import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./holding-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /FuturesEquityCurve/);
assert.match(source, /equityHistory/);
assert.match(source, /polyline/);
assert.match(source, /futuresMarginBalance/);
assert.match(source, /USStockHoldingPanel/);
assert.match(source, /activeHoldingView/);

console.log("ok - holding panel equity curve contract");
