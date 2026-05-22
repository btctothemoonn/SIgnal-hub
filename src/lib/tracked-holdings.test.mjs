import assert from "node:assert/strict";
import {
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
            coin: "HYPE",
            szi: "12.5",
            entryPx: "30",
            positionValue: "500",
            unrealizedPnl: "125",
            returnOnEquity: "0.25",
            liquidationPx: "18",
            marginUsed: "50",
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
  assert.equal(snapshot.positions[0].side, "LONG");
  assert.equal(snapshot.positions[0].markPrice, 40);
  assert.equal(snapshot.positions[0].roePercent, 25);
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

console.log("ok - tracked holdings");
