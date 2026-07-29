import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./holding-panel.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../app/holding/page.tsx", import.meta.url),
  "utf8",
);
const summaryTileSource = source.slice(
  source.indexOf("function SummaryTile"),
  source.indexOf("function EmptyState"),
);
const holdingMetricCellSource = source.slice(
  source.indexOf("function HoldingMetricCell"),
  source.indexOf("function BinanceSummaryGrid"),
);

assert.match(source, /FuturesEquityCurve/);
assert.match(source, /equityHistory/);
assert.match(source, /polyline/);
assert.match(source, /futuresMarginBalance/);
assert.match(source, /USStockHoldingPanel/);
assert.match(source, /activeHoldingView/);
assert.match(source, /tracked-accounts/);
assert.match(source, /TrackedAccountsPanel/);
assert.match(source, /跟踪账户/);
assert.match(source, /Alex/);
assert.match(source, /Hyperdash/);
assert.match(source, /Hyperliquid/);
assert.match(source, /资金费/);
assert.match(source, /fundingAllTime/);
assert.match(source, /Binance 持仓状况/);
assert.match(source, /实时跟踪 Binance 现货与合约表现/);
assert.match(source, /function FuturesPositionCards/);
assert.match(source, /function SpotBalanceCards/);
assert.match(source, /data-holding-workspace/);
assert.match(source, /data-holding-view-tabs/);
assert.match(source, /data-holding-metric-strip/);
assert.match(source, /data-holding-position-grid/);
assert.match(source, /rounded-\[6px\]/);
assert.match(source, /getBinanceDisplayTotalEquity/);
assert.match(source, /label="浮盈 \/ 合约权益"/);
assert.match(source, /label="浮盈 \/ 账户权益"/);
assert.doesNotMatch(source, /label="盈亏比例"/);
assert.match(source, /className="h-64 w-full overflow-visible"/);
assert.doesNotMatch(source, /className="h-64 w-full overflow-hidden"/);
assert.doesNotMatch(summaryTileSource, /truncate/);
assert.match(summaryTileSource, /\[overflow-wrap:anywhere\]/);
assert.doesNotMatch(holdingMetricCellSource, /truncate/);
assert.match(holdingMetricCellSource, /\[overflow-wrap:anywhere\]/);
assert.doesNotMatch(source, /bg-gradient-|from-[a-z]|to-[a-z]/);
assert.match(pageSource, /overflow-x-hidden/);
assert.doesNotMatch(pageSource, /overflow-x-auto/);
assert.match(source, /合约持仓/);
assert.match(source, /现货资产/);
assert.doesNotMatch(source, /<FuturesHeatmap/);
assert.doesNotMatch(source, /<FuturesTable/);
assert.doesNotMatch(source, /<SpotAllocationPanel/);
assert.match(source, /window\.setTimeout\(\(\) => void load\(\), 0\)/);
assert.match(source, /window\.setTimeout\(\(\) => void loadTracked\(\), 0\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void load\(\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void loadTracked\(\)/);

console.log("ok - holding panel optimized Binance contract");
