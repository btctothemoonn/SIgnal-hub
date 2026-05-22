import assert from "node:assert/strict";
import {
  getTrackedHoldingSnapshot,
  normalizeHyperliquidClearinghouseState,
  TRACKED_HOLDING_PROFILES,
} from "./tracked-holdings.ts";

const [alex] = TRACKED_HOLDING_PROFILES;

assert.equal(alex.id, "alex");
assert.equal(alex.name, "Alex");
assert.equal(alex.source, "Hyperdash / Hyperliquid");
assert.equal(
  alex.address,
  "0x87d76b68d81a3cec086e6c34afed49dbf378af8b",
);
assert.equal(alex.dex, "xyz");

{
  const snapshot = normalizeHyperliquidClearinghouseState({
    profile: alex,
    updatedAt: "2026-05-22T00:00:00.000Z",
    raw: {
      marginSummary: {
        accountValue: "10000",
        totalNtlPos: "1500",
        totalRawUsd: "8500",
        totalMarginUsed: "300",
      },
      withdrawable: "7000",
      assetPositions: [
        {
          type: "oneWay",
          position: {
            coin: "xyz:SKHX",
            szi: "12.5",
            entryPx: "30",
            positionValue: "500",
            unrealizedPnl: "125",
            returnOnEquity: "0.25",
            liquidationPx: "18",
            marginUsed: "50",
            cumFunding: { allTime: "12.34" },
            leverage: { type: "cross", value: 10 },
          },
        },
        {
          type: "oneWay",
          position: {
            coin: "BTC",
            szi: "-0.1",
            entryPx: "100000",
            positionValue: "9500",
            unrealizedPnl: "500",
            returnOnEquity: "0.5",
            liquidationPx: "120000",
            marginUsed: "950",
            leverage: { type: "isolated", value: 10 },
          },
        },
      ],
    },
  });

  assert.equal(snapshot.source, "hyperliquid");
  assert.equal(snapshot.positions.length, 2);
  assert.equal(snapshot.positions[0].coin, "SKHX");
  assert.equal(snapshot.positions[0].side, "LONG");
  assert.equal(snapshot.positions[0].markPrice, 40);
  assert.equal(snapshot.positions[0].roePercent, 25);
  assert.equal(snapshot.positions[0].fundingAllTime, 12.34);
  assert.equal(snapshot.positions[1].side, "SHORT");
  assert.equal(snapshot.summary.positionCount, 2);
  assert.equal(snapshot.summary.longNotional, 500);
  assert.equal(snapshot.summary.shortNotional, 9500);
  assert.equal(snapshot.summary.unrealizedPnl, 625);
}

{
  const snapshot = normalizeHyperliquidClearinghouseState({
    profile: alex,
    updatedAt: "2026-05-22T00:00:00.000Z",
    raw: {
      marginSummary: {
        accountValue: "0",
        totalNtlPos: "0",
        totalRawUsd: "0",
        totalMarginUsed: "0",
      },
      withdrawable: "0",
      assetPositions: [],
    },
  });

  assert.deepEqual(snapshot.positions, []);
  assert.equal(snapshot.summary.accountValue, 0);
  assert.equal(snapshot.summary.positionCount, 0);
}

{
  let requestBody = null;
  const snapshot = await getTrackedHoldingSnapshot({
    now: () => "2026-05-22T01:23:45.000Z",
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          marginSummary: {
            accountValue: "510840.302331",
            totalNtlPos: "411187.66387",
            totalRawUsd: "99652.638461",
            totalMarginUsed: "409869.107831",
          },
          withdrawable: "972.0945",
          assetPositions: [
            {
              type: "oneWay",
              position: {
                coin: "xyz:LITE",
                szi: "87.479",
                entryPx: "914.5",
                positionValue: "85408.37207",
                unrealizedPnl: "5408.82657",
                returnOnEquity: "0.0676107162",
                liquidationPx: "1.4004992717",
                marginUsed: "85291.983508",
                leverage: { type: "isolated", value: 1 },
                cumFunding: { allTime: "114.084631" },
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(requestBody, {
    type: "clearinghouseState",
    user: alex.address,
    dex: "xyz",
  });
  assert.equal(snapshot.updatedAt, "2026-05-22T01:23:45.000Z");
  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.positions[0].coin, "LITE");
  assert.equal(snapshot.summary.accountValue, 510840.302331);
}

console.log("ok - tracked holdings");
