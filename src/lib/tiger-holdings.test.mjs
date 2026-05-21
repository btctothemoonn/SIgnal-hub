import assert from "node:assert/strict";

const {
  buildTigerHoldingData,
  normalizeTigerPosition,
  parseTigerOpenApiProperties,
} = await import("./tiger-holdings.ts");

const parsed = parseTigerOpenApiProperties(`
# Tiger OpenAPI test config
tiger_id=12345678
account=9000000
license=TBNZ
env=PROD
private_key_pk8=-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----
`);

assert.equal(parsed.tigerId, "12345678");
assert.equal(parsed.account, "9000000");
assert.equal(parsed.license, "TBNZ");
assert.equal(parsed.env, "PROD");
assert.equal(
  parsed.privateKey,
  "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
);

const equity = normalizeTigerPosition({
  symbol: "ARM",
  secType: "STK",
  market: "US",
  currency: "USD",
  position: 15,
  marketValue: 3808.88,
  latestPrice: 254.13,
  averageCost: 221.68,
  unrealizedPnl: 137.71,
  name: "ARM Holdings",
});

assert.equal(equity?.kind, "equity");
assert.equal(equity?.symbol, "ARM");
assert.equal(equity?.quantity, 15);
assert.equal(equity?.marketValue, 3808.88);
assert.equal(equity?.unrealizedPnl, 137.71);
assert.equal(equity?.theme, "Semiconductor");

const nokEquity = normalizeTigerPosition({
  symbol: "NOK",
  secType: "STK",
  market: "US",
  currency: "USD",
  position: 137,
  marketValue: 1841.27,
  latestPrice: 13.44,
  averageCost: 14.5,
  unrealizedPnl: -144.37,
  name: "Nokia",
});

assert.equal(nokEquity?.kind, "equity");
assert.equal(nokEquity?.symbol, "NOK");
assert.equal(nokEquity?.theme, "Optical");

const option = normalizeTigerPosition({
  symbol: "PLTR",
  secType: "OPT",
  market: "US",
  currency: "USD",
  positionQty: 1,
  marketValue: 136,
  latestPrice: 1.36,
  averageCost: 5.18,
  unrealizedPnl: -382.21,
  expiry: "20260717",
  strike: 105,
  right: "PUT",
  name: "PLTR PUT",
});

assert.equal(option?.kind, "option");
assert.equal(option?.symbol, "PLTR 20260717 105P");
assert.equal(option?.option?.underlying, "PLTR");
assert.equal(option?.option?.type, "PUT");
assert.equal(option?.option?.expiry, "2026-07-17");

const tigerData = buildTigerHoldingData({
  updatedAt: "2026-05-21T02:00:00.000Z",
  accountId: "9000000",
  positions: [equity, option],
  assets: [
    {
      account: "9000000",
      currency: "USD",
      cashValue: 25166.87,
      netLiquidation: 51554.73,
      unrealizedPnL: -1762.85,
      segments: [
        {
          category: "S",
          grossPositionValue: 26387.86,
          cashValue: 25166.87,
          netLiquidation: 51554.73,
        },
      ],
    },
  ],
  analytics: [
    {
      date: "2026-05-20",
      holdingValue: 26387.86,
      cashBalance: 25166.87,
      pnl: -1762.85,
      pnlRate: -0.032,
      netValueIndex: 0.968,
      currency: "USD",
    },
  ],
});

assert.equal(tigerData.snapshot.source, "tiger");
assert.equal(tigerData.snapshot.accountId, "9000000");
assert.equal(tigerData.snapshot.reportedPositionCount, 2);
assert.equal(tigerData.snapshot.reportedMarketValue, 26387.86);
assert.equal(tigerData.snapshot.reportedPnl, -1762.85);
assert.equal(tigerData.snapshot.netLiquidation, 51554.73);
assert.equal(tigerData.snapshot.cashValue, 25166.87);
assert.equal(tigerData.equityHistory.length, 1);
assert.equal(tigerData.equityHistory[0].netLiquidation, 51554.73);

console.log("ok - tiger holdings normalize and config parsing");
