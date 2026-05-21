import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./us-stock-holding-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /USStockHoldingPanel/);
assert.match(source, /US_STOCK_HOLDING_SNAPSHOT/);
assert.match(source, /\/api\/holdings\/tiger/);
assert.match(source, /EquityCurve/);
assert.match(source, /PositionBriefCards/);
assert.match(source, /getUsStockHoldingBriefCards/);
assert.match(source, /PositionTreemap/);
assert.match(source, /OptionRiskStrip/);
assert.match(source, /HoldingDetailTable/);

console.log("ok - us stock holding panel tiger contract");
