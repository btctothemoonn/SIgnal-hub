import assert from "node:assert/strict";
import * as holdingDisplay from "./holding-display.ts";

const { formatUsdtPrice } = holdingDisplay;

assert.equal(formatUsdtPrice(65000), "$65,000.00");
assert.equal(formatUsdtPrice(1.23456), "$1.2346");
assert.equal(formatUsdtPrice(0.123456), "$0.123456");
assert.equal(formatUsdtPrice(0.00001234), "$0.00001234");
assert.equal(formatUsdtPrice(0), "-");

assert.equal(typeof holdingDisplay.getBinanceDisplayTotalEquity, "function");
const { getBinanceDisplayTotalEquity } = holdingDisplay;
assert.equal(
  getBinanceDisplayTotalEquity({
    accountMode: "portfolioMargin",
    futuresMarginBalance: 125_000,
    spotTotal: 25_000,
  }),
  125_000,
);
assert.equal(
  getBinanceDisplayTotalEquity({
    accountMode: "standard",
    futuresMarginBalance: 125_000,
    spotTotal: 25_000,
  }),
  150_000,
);
assert.equal(
  getBinanceDisplayTotalEquity({
    accountMode: "standard",
    futuresMarginBalance: 0,
    spotTotal: 0,
  }),
  0,
);

assert.equal(typeof holdingDisplay.getUsHoldingEquityMetric, "function");
const { getUsHoldingEquityMetric } = holdingDisplay;
assert.deepEqual(
  getUsHoldingEquityMetric({
    source: "tiger",
    netLiquidation: 0,
    holdingMarketValue: 42_000,
  }),
  { label: "账户净值", value: 0 },
);
assert.deepEqual(
  getUsHoldingEquityMetric({
    source: "tiger",
    netLiquidation: -500,
    holdingMarketValue: 42_000,
  }),
  { label: "账户净值", value: -500 },
);
assert.deepEqual(
  getUsHoldingEquityMetric({
    source: "snapshot",
    netLiquidation: 0,
    holdingMarketValue: 42_000,
  }),
  { label: "持仓市值", value: 42_000 },
);

const validTigerSnapshot = {
  source: "tiger",
  accountId: "test-account",
  accountLabel: "Tiger test",
  currency: "USD",
  updatedAt: "2026-07-29T00:00:00.000Z",
  positions: [],
  reportedPositionCount: 0,
  reportedMarketValue: 42_000,
  reportedPnl: -500,
  netLiquidation: 0,
  cashValue: -100,
  buyingPower: null,
  warnings: [],
};

assert.equal(typeof holdingDisplay.isFiniteTigerHoldingSnapshot, "function");
const { isFiniteTigerHoldingSnapshot } = holdingDisplay;
assert.equal(isFiniteTigerHoldingSnapshot(validTigerSnapshot), true);
assert.equal(
  isFiniteTigerHoldingSnapshot({
    ...validTigerSnapshot,
    netLiquidation: Number.NaN,
  }),
  false,
);
assert.equal(
  isFiniteTigerHoldingSnapshot({
    ...validTigerSnapshot,
    cashValue: Number.POSITIVE_INFINITY,
  }),
  false,
);

console.log("ok - holding display metrics and guards");
