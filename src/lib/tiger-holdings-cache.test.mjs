import assert from "node:assert/strict";
import {
  createTigerHoldingDataCache,
  mergeTigerEquityHistory,
  getTigerHoldingDataCacheTtlMs,
} from "./tiger-holdings-cache.ts";

function buildData(updatedAt, netLiquidation = 1000) {
  return {
    snapshot: {
      source: "tiger",
      accountId: "9000000",
      accountLabel: "Tiger 9000000",
      currency: "USD",
      updatedAt,
      reportedPositionCount: 0,
      reportedMarketValue: 0,
      reportedPnl: 0,
      positions: [],
      netLiquidation,
      cashValue: 0,
      buyingPower: null,
      warnings: [],
    },
    equityHistory: [
      {
        at: updatedAt,
        netLiquidation,
        holdingValue: 0,
        cashBalance: 0,
        pnl: 0,
        currency: "USD",
      },
    ],
  };
}

{
  let calls = 0;
  const cache = createTigerHoldingDataCache({
    fetcher: async () => buildData(`snapshot-${++calls}`),
    ttlMs: 60_000,
    readData: async () => null,
    writeData: async () => {},
  });

  const first = await cache.get();
  const second = await cache.get();

  assert.equal(calls, 1);
  assert.equal(first.snapshot.updatedAt, "snapshot-1");
  assert.equal(second.snapshot.updatedAt, "snapshot-1");

  const refreshed = await cache.get({ force: true });
  assert.equal(calls, 2);
  assert.equal(refreshed.snapshot.updatedAt, "snapshot-2");
}

{
  const history = mergeTigerEquityHistory({
    history: [
      {
        at: "2026-05-21T01:02:10.000Z",
        netLiquidation: 1000,
        holdingValue: 500,
        cashBalance: 500,
        pnl: 0,
        currency: "USD",
      },
    ],
    points: [
      {
        at: "2026-05-21T01:02:50.000Z",
        netLiquidation: 1200,
        holdingValue: 700,
        cashBalance: 500,
        pnl: 20,
        currency: "USD",
      },
    ],
    maxPoints: 5,
  });

  assert.deepEqual(
    history.map((point) => point.netLiquidation),
    [1200],
  );
}

{
  let calls = 0;
  const cache = createTigerHoldingDataCache({
    fetcher: async () => {
      calls += 1;
      return await new Promise(() => {});
    },
    ttlMs: 10,
    readData: async () => buildData("persisted"),
    writeData: async () => {},
  });

  const data = await cache.get();

  assert.equal(data.snapshot.updatedAt, "persisted");
  assert.equal(calls, 1);
}

assert.equal(
  getTigerHoldingDataCacheTtlMs({ TIGER_HOLDINGS_CACHE_TTL_MS: "45000" }),
  45000,
);
assert.equal(
  getTigerHoldingDataCacheTtlMs({ TIGER_HOLDINGS_CACHE_TTL_MS: "0" }),
  15000,
);

console.log("ok - tiger holdings cache");
