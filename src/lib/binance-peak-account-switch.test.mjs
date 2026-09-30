import assert from "node:assert/strict";
import test from "node:test";
import { createBinancePositionPeakTrackingCache } from "./binance-position-drawdown.ts";

test("old-account position peaks cannot repopulate a cleared cache", async () => {
  let release;
  const writes = [];
  const cache = createBinancePositionPeakTrackingCache({
    refresh: async (snapshot) => {
      if (snapshot.account === "old") {
        return await new Promise(resolve => { release = resolve; });
      }
      return [{ favorablePrice: 120 }];
    },
    read: async () => null,
    write: async next => { writes.push(next); },
    ttlMs: 60000,
  });
  const old = cache.get({ account: "old" });
  await new Promise(resolve => setImmediate(resolve));
  await cache.invalidate();
  const current = cache.get({ account: "new" });
  release([{ favorablePrice: 500 }]);
  assert.equal((await current)[0].favorablePrice, 120);
  assert.deepEqual(await old, [], "the old request cannot rebuild peaks against its superseded snapshot");
  assert.equal((await cache.get({ account: "new" }))[0].favorablePrice, 120);
  assert.ok(!writes.some(next => next.some(item => item.favorablePrice === 500)));
});

test("a pending old-account disk read cannot restore cleared peaks", async () => {
  let release;
  let reads = 0;
  const cache = createBinancePositionPeakTrackingCache({
    refresh: async () => [{ favorablePrice: 120 }],
    read: async () => {
      if (++reads === 1) return await new Promise(resolve => { release = resolve; });
      return null;
    },
    write: async () => {},
    ttlMs: 60000,
  });
  const old = cache.get({ account: "old" });
  await new Promise(resolve => setImmediate(resolve));
  await cache.invalidate();
  release([{ favorablePrice: 500 }]);
  assert.deepEqual(await old, []);
  assert.equal((await cache.get({ account: "new" }))[0].favorablePrice, 120);
});

test("clearing account peaks waits for an already-started write", async () => {
  let release;
  let persisted = null;
  const cache = createBinancePositionPeakTrackingCache({
    refresh: async () => [{ favorablePrice: 500 }],
    read: async () => persisted,
    write: async next => {
      await new Promise(resolve => { release = resolve; });
      persisted = next;
    },
    ttlMs: 60000,
  });
  const old = cache.get({ account: "old" });
  await new Promise(resolve => setImmediate(resolve));
  const cleared = cache.invalidate(async () => { persisted = null; });
  release();
  await cleared;
  assert.deepEqual(await old, []);
  assert.equal(persisted, null, "the late write must finish before old account data is cleared");
});

test("an old snapshot submitted during clearing cannot recreate account peaks", async () => {
  let release;
  const writes = [];
  const cache = createBinancePositionPeakTrackingCache({
    refresh: async () => [{ favorablePrice: 500 }],
    read: async () => null,
    write: async next => { writes.push(next); },
    ttlMs: 60000,
  });
  const transition = cache.invalidate(async () => {
    await new Promise(resolve => { release = resolve; });
  });
  await new Promise(resolve => setImmediate(resolve));
  const old = cache.get({ account: "old" });
  release();
  await transition;
  assert.deepEqual(await old, []);
  assert.deepEqual(writes, []);
});
