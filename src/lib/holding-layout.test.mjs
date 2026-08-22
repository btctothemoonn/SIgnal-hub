import assert from "node:assert/strict";

const { buildFuturesExposureRows, summarizeFuturesExposure } = await import(
  "./holding-layout.ts"
);

assert.equal(
  typeof summarizeFuturesExposure,
  "function",
  "terminal layout needs a reusable long/short exposure summary",
);

const rows = buildFuturesExposureRows([
  {
    symbol: "ENAUSDT",
    side: "LONG",
    amount: 10,
    entryPrice: 1,
    markPrice: 1.2,
    unrealizedPnl: 2,
    liquidationPrice: 0.5,
    leverage: 5,
    marginType: "cross",
    notional: 12,
  },
  {
    symbol: "XAGUSDT",
    side: "SHORT",
    amount: -3,
    entryPrice: 40,
    markPrice: 38,
    unrealizedPnl: 6,
    liquidationPrice: 45,
    leverage: 10,
    marginType: "isolated",
    notional: -114,
  },
  {
    symbol: "BNBUSDT",
    side: "LONG",
    amount: 2,
    entryPrice: 600,
    markPrice: 650,
    unrealizedPnl: 100,
    liquidationPrice: 0,
    leverage: 10,
    marginType: "cross",
    notional: 1300,
  },
]);

assert.deepEqual(
  rows.map((row) => row.asset),
  ["BNB", "XAG", "ENA"],
);
assert.equal(rows[0].rank, 1);
assert.equal(rows[0].isTopExposure, true);
assert.equal(rows[0].direction, "多");
assert.equal(rows[1].direction, "空");
assert.equal(rows[0].exposurePercent.toFixed(1), "91.2");
assert.equal(rows[1].exposurePercent.toFixed(1), "8.0");
assert.equal(rows[2].exposurePercent.toFixed(1), "0.8");
assert.equal(rows[0].pnlPercent.toFixed(1), "8.3");
assert.equal(rows[0].liquidationDistancePercent, null);
assert.equal(rows[1].liquidationDistancePercent?.toFixed(1), "18.4");
assert.equal(rows[2].liquidationDistancePercent?.toFixed(1), "58.3");

const exposure = summarizeFuturesExposure(rows);
assert.deepEqual(
  {
    totalNotional: exposure.totalNotional,
    longNotional: exposure.longNotional,
    shortNotional: exposure.shortNotional,
    longPercent: exposure.longPercent.toFixed(1),
    shortPercent: exposure.shortPercent.toFixed(1),
    bias: exposure.bias,
  },
  {
    totalNotional: 1426,
    longNotional: 1312,
    shortNotional: 114,
    longPercent: "92.0",
    shortPercent: "8.0",
    bias: "净多头",
  },
);

console.log("ok - holding layout builds sorted futures exposure rows");
