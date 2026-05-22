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
assert.match(source, /合约持仓/);
assert.match(source, /现货资产/);
assert.doesNotMatch(source, /<FuturesHeatmap/);
assert.doesNotMatch(source, /<FuturesTable/);
assert.doesNotMatch(source, /<SpotAllocationPanel/);

console.log("ok - holding panel optimized Binance contract");
