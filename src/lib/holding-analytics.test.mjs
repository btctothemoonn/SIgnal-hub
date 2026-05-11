import assert from "node:assert/strict";
import {
  analyzeFuturesPositions,
  analyzeSpotAllocation,
  getHeatmapTileLayout,
} from "./holding-analytics.ts";

const analytics = analyzeFuturesPositions({
  positions: [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      amount: 0.1,
      entryPrice: 60000,
      markPrice: 65000,
      unrealizedPnl: 500,
      liquidationPrice: 45000,
      leverage: 10,
      marginType: "cross",
      notional: 6500,
    },
    {
      symbol: "ETHUSDT",
      side: "SHORT",
      amount: -1,
      entryPrice: 3000,
      markPrice: 3100,
      unrealizedPnl: -100,
      liquidationPrice: 3600,
      leverage: 5,
      marginType: "cross",
      notional: -3100,
    },
  ],
  summary: {
    spotAssetCount: 2,
    futuresPositionCount: 2,
    futuresWalletBalance: 10000,
    futuresUnrealizedPnl: 400,
    futuresMarginBalance: 10000,
    futuresAvailableBalance: 5000,
    futuresLongNotional: 6500,
    futuresShortNotional: 3100,
    futuresGrossNotional: 9600,
    futuresNetNotional: 3400,
  },
});

assert.equal(analytics.biasLabel, "Bullish");
assert.equal(analytics.longShare, 67.70833333333334);
assert.equal(analytics.shortShare, 32.29166666666667);
assert.equal(analytics.profitShare, 83.33333333333334);
assert.equal(analytics.lossShare, 16.666666666666664);
assert.equal(analytics.positivePnl, 500);
assert.equal(analytics.negativePnlAbs, 100);
assert.equal(analytics.netExposureLeverage, 0.34);
assert.equal(analytics.maxAbsNotional, 6500);

assert.deepEqual(
  getHeatmapTileLayout({
    absNotional: 470,
    maxAbsNotional: 80260,
  }),
  {
    colSpan: 2,
    rowSpan: 1,
  },
);

assert.deepEqual(
  getHeatmapTileLayout({
    absNotional: 80260,
    maxAbsNotional: 80260,
  }),
  {
    colSpan: 6,
    rowSpan: 2,
  },
);

assert.deepEqual(
  analyzeSpotAllocation([
    { asset: "BTC", usdtValue: 1000 },
    { asset: "USDT", usdtValue: 500 },
    { asset: "ETH", usdtValue: 0 },
  ]),
  {
    totalUsdtValue: 1500,
    slices: [
      { asset: "BTC", usdtValue: 1000, share: 66.66666666666666 },
      { asset: "USDT", usdtValue: 500, share: 33.33333333333333 },
    ],
  },
);

console.log("ok - holding futures analytics");
