import assert from "node:assert/strict";

const {
  US_STOCK_HOLDING_SNAPSHOT,
  analyzeUsStockHoldings,
  getUsStockHoldingGroups,
} = await import("./us-stock-holdings.ts");

const analysis = analyzeUsStockHoldings(US_STOCK_HOLDING_SNAPSHOT.positions);

assert.equal(US_STOCK_HOLDING_SNAPSHOT.reportedPositionCount, 12);
assert.equal(US_STOCK_HOLDING_SNAPSHOT.positions.length, 11);
assert.equal(analysis.totalMarketValue, 26388.9);
assert.equal(analysis.reportedMarketValueDelta, 1.04);
assert.equal(analysis.totalPnl, -1762.85);
assert.equal(analysis.winningCount, 2);
assert.equal(analysis.losingCount, 9);
assert.equal(analysis.optionMarketValue, 406);
assert.equal(analysis.optionPnl, -895.42);
assert.equal(analysis.topPosition?.symbol, "DRAM");

const groups = getUsStockHoldingGroups(US_STOCK_HOLDING_SNAPSHOT.positions);
assert.equal(groups.equity.length, 9);
assert.equal(groups.option.length, 2);

console.log("ok - us stock holdings snapshot analytics");
