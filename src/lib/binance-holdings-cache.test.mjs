import assert from "node:assert/strict";
import {
  createBinanceHoldingSnapshotCache,
  mergeBinanceFuturesEquityHistory,
  getBinanceHoldingSnapshotCacheTtlMs,
} from "./binance-holdings-cache.ts";

function buildSnapshot(updatedAt, marginBalance = 0) {
  return {
    exchange: "binance",
    accountMode: "portfolioMargin",
    updatedAt,
    spotBalances: [],
    futuresPositions: [],
    summary: {
      spotAssetCount: 0,
      futuresPositionCount: 0,
      futuresWalletBalance: 0,
      futuresUnrealizedPnl: 0,
      futuresMarginBalance: marginBalance,
      futuresAvailableBalance: 0,
      futuresLongNotional: 0,
      futuresShortNotional: 0,
      futuresGrossNotional: 0,
      futuresNetNotional: 0,
    },
    warnings: [],
  };
}

{
  let calls = 0;
  const cache = createBinanceHoldingSnapshotCache({
    fetcher: async () => buildSnapshot(`snapshot-${++calls}`),
    ttlMs: 60_000,
    readSnapshot: async () => null,
    writeSnapshot: async () => {},
  });

  const first = await cache.get();
  const second = await cache.get();

  assert.equal(calls, 1);
  assert.equal(first.updatedAt, "snapshot-1");
  assert.equal(second.updatedAt, "snapshot-1");

  const refreshed = await cache.get({ force: true });
  assert.equal(calls, 2);
  assert.equal(refreshed.updatedAt, "snapshot-2");
}

{
  let nowMs = 0;
  let calls = 0;
  let resolveRefresh = () => {};
  const cache = createBinanceHoldingSnapshotCache({
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return buildSnapshot("snapshot-1");
      return await new Promise((resolve) => {
        resolveRefresh = () => resolve(buildSnapshot("snapshot-2"));
      });
    },
    ttlMs: 10,
    now: () => nowMs,
    readSnapshot: async () => null,
    writeSnapshot: async () => {},
  });

  const first = await cache.get();
  nowMs = 20;
  const stale = await cache.get();

  assert.equal(calls, 2);
  assert.equal(first.updatedAt, "snapshot-1");
  assert.equal(stale.updatedAt, "snapshot-1");

  resolveRefresh();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const refreshed = await cache.get();
  assert.equal(refreshed.updatedAt, "snapshot-2");
}

{
  const history = mergeBinanceFuturesEquityHistory({
    history: [
      {
        at: "2026-05-15T01:02:10.000Z",
        walletBalance: 900,
        unrealizedPnl: 10,
        marginBalance: 910,
        availableBalance: 500,
      },
      {
        at: "2026-05-15T01:03:00.000Z",
        walletBalance: 950,
        unrealizedPnl: 20,
        marginBalance: 970,
        availableBalance: 520,
      },
    ],
    point: {
      at: "2026-05-15T01:02:50.000Z",
      walletBalance: 1000,
      unrealizedPnl: 30,
      marginBalance: 1030,
      availableBalance: 600,
    },
    maxPoints: 5,
  });

  assert.deepEqual(history.map((point) => point.marginBalance), [1030, 970]);
}

{
  let calls = 0;
  const recorded = [];
  const cache = createBinanceHoldingSnapshotCache({
    fetcher: async () => buildSnapshot(`snapshot-${++calls}`, calls * 100),
    ttlMs: 60_000,
    readSnapshot: async () => null,
    writeSnapshot: async () => {},
    writeEquityPoint: async (snapshot) => {
      recorded.push(snapshot.summary.futuresMarginBalance);
    },
  });

  await cache.get();
  await cache.get();
  await cache.get({ force: true });

  assert.deepEqual(recorded, [100, 200]);
}

{
  let calls = 0;
  const cache = createBinanceHoldingSnapshotCache({
    fetcher: async () => {
      calls += 1;
      return await new Promise(() => {});
    },
    ttlMs: 10,
    readSnapshot: async () => buildSnapshot("persisted"),
    writeSnapshot: async () => {},
  });

  const snapshot = await cache.get();

  assert.equal(snapshot.updatedAt, "persisted");
  assert.equal(calls, 1);
}

assert.equal(
  getBinanceHoldingSnapshotCacheTtlMs({
    BINANCE_HOLDINGS_CACHE_TTL_MS: "25000",
  }),
  25000,
);
assert.equal(
  getBinanceHoldingSnapshotCacheTtlMs({
    BINANCE_HOLDINGS_CACHE_TTL_MS: "-1",
  }),
  15000,
);

console.log("ok - binance holdings cache");
