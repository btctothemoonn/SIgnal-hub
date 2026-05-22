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
assert.match(source, /function PositionBriefPnl/);
assert.match(source, /formatSignedPercent\(card\.unrealizedPnlPercent\)/);
assert.match(source, /持仓状况/);
assert.match(source, /最后更新/);
assert.match(source, /数据每 60 秒更新一次/);
assert.match(source, /function PositionLogo/);
assert.match(source, /grid-cols-\[minmax\(0,18rem\)_minmax\(36rem,1fr\)_auto\]/);
assert.doesNotMatch(source, /<OptionRiskStrip/);
assert.doesNotMatch(source, /<ThemeAllocation/);
assert.doesNotMatch(source, /主题暴露/);
assert.doesNotMatch(source, /<PositionTreemap/);
assert.doesNotMatch(source, /<HoldingDetailTable/);

console.log("ok - us stock holding panel tiger contract");
