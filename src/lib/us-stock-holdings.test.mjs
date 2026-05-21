import assert from "node:assert/strict";

const {
  US_STOCK_HOLDING_SNAPSHOT,
  analyzeUsStockHoldings,
  getUsStockHoldingBriefCards,
  getUsStockHoldingGroups,
  getUsStockThemeAllocation,
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

const briefCards = getUsStockHoldingBriefCards(US_STOCK_HOLDING_SNAPSHOT);
assert.equal(briefCards.length, US_STOCK_HOLDING_SNAPSHOT.positions.length);
assert.equal(briefCards[0].symbol, "DRAM");
assert.equal(briefCards[0].weightPercent, 37.79);
assert.equal(briefCards[0].unrealizedPnlPercent, -1.72);
assert.equal(briefCards[0].fee, null);
assert.equal(
  briefCards.find((card) => card.id === "pltr-put-115")?.optionLabel,
  "PLTR 115P 2026-07-17",
);

const tigerLikeSnapshot = {
  ...US_STOCK_HOLDING_SNAPSHOT,
  positions: [
    {
      ...US_STOCK_HOLDING_SNAPSHOT.positions[0],
      id: "arm-live",
      symbol: "ARM",
      theme: "AI semiconductor",
    },
    {
      ...US_STOCK_HOLDING_SNAPSHOT.positions[1],
      id: "dram-live",
      symbol: "DRAM",
      theme: "Memory chain",
    },
    {
      ...US_STOCK_HOLDING_SNAPSHOT.positions[6],
      id: "pltr-put-live",
      symbol: "PLTR 20260717 105P",
      theme: "Option hedge",
    },
  ],
};
const localizedCards = getUsStockHoldingBriefCards(tigerLikeSnapshot);
assert.equal(localizedCards.find((card) => card.symbol === "ARM")?.theme, "AI 半导体");
assert.equal(localizedCards.find((card) => card.symbol === "DRAM")?.theme, "存储链");
assert.equal(
  localizedCards.find((card) => card.id === "pltr-put-live")?.theme,
  "期权保护",
);

const localizedAllocation = getUsStockThemeAllocation(tigerLikeSnapshot.positions);
assert.deepEqual(
  localizedAllocation.map((item) => item.theme),
  ["存储链", "AI 半导体", "期权保护"],
);

console.log("ok - us stock holdings snapshot analytics");
