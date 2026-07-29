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
assert.match(source, /data-us-holding-summary/);
assert.match(source, /data-us-position-card/);
assert.match(source, /持仓状况/);
assert.match(source, /最后更新/);
assert.match(source, /数据每 60 秒更新一次/);
assert.match(source, /function PositionLogo/);
assert.match(source, /xl:grid-cols-2/);
assert.doesNotMatch(source, /<OptionRiskStrip/);
assert.doesNotMatch(source, /<ThemeAllocation/);
assert.doesNotMatch(source, /主题暴露/);
assert.doesNotMatch(source, /<PositionTreemap/);
assert.doesNotMatch(source, /<HoldingDetailTable/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
assert.match(source, /window\.setTimeout\(\(\) => void loadTiger\(\), 0\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void loadTiger\(\)/);

console.log("ok - us stock holding panel tiger contract");
