import assert from "node:assert/strict";
import {
  createBinanceHoldingSnapshotCache,
  getBinanceHoldingSnapshotCacheTtlMs,
} from "./binance-holdings-cache.ts";

function buildSnapshot(updatedAt) {
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
      futuresMarginBalance: 0,
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
