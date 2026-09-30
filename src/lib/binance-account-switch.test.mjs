import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "binance-account-switch-"));
const moduleUrl = new URL("./binance-holdings-cache.ts", import.meta.url);
process.chdir(directory);
const { createBinanceHoldingSnapshotCache, invalidateCachedBinanceHoldingSnapshot,
  readPersistedBinanceHoldingSnapshot, readPersistedBinanceFuturesEquityHistory } = await import(moduleUrl.href);

const snapshot = (balance) => ({ exchange: "binance", accountMode: "standard",
  updatedAt: "2026-09-30T02:00:00Z", spotBalances: [], futuresPositions: [], warnings: [],
  summary: { futuresMarginBalance: balance } });
try {
  await test("switching credentials archives the old snapshot and equity history", async () => {
    const runtime = join(directory, ".signal-hub");
    await mkdir(runtime, { recursive: true });
    const oldSnapshot = JSON.stringify({ snapshot: snapshot(1000) });
    const oldHistory = JSON.stringify({ points: [{ at: "2026-09-30T01:00:00Z", walletBalance: 1000,
      unrealizedPnl: 0, marginBalance: 1000, availableBalance: 1000 }] });
    await writeFile(join(runtime, "binance-holdings-snapshot.json"), oldSnapshot);
    await writeFile(join(runtime, "binance-futures-equity-history.json"), oldHistory);
    await invalidateCachedBinanceHoldingSnapshot();
    assert.equal(await readPersistedBinanceHoldingSnapshot(), null);
    assert.deepEqual(await readPersistedBinanceFuturesEquityHistory(), []);
    const archiveRoot = join(runtime, "binance-account-archive");
    const [archive] = await readdir(archiveRoot);
    assert.equal(await readFile(join(archiveRoot, archive, "binance-holdings-snapshot.json"), "utf8"), oldSnapshot);
    assert.equal(await readFile(join(archiveRoot, archive, "binance-futures-equity-history.json"), "utf8"), oldHistory);
  });
  await test("cache invalidation cannot reload the old persisted account", async () => {
    let persisted = snapshot(1000);
    const cache = createBinanceHoldingSnapshotCache({ fetcher: async () => snapshot(100000), ttlMs: 60000,
      readSnapshot: async () => persisted, writeSnapshot: async next => { persisted = next; },
      writeEquityPoint: async () => {}, archiveSnapshot: async () => { persisted = null; } });
    await cache.invalidate();
    assert.equal((await cache.get()).summary.futuresMarginBalance, 100000);
  });
  await test("an in-flight old-account fetch cannot repopulate the new account cache", async () => {
    let release;
    let calls = 0;
    const persisted = [];
    const cache = createBinanceHoldingSnapshotCache({ fetcher: async () => {
      calls++;
      if (calls === 1) return await new Promise(resolve => { release = resolve; });
      return snapshot(100000);
    }, ttlMs: 60000, readSnapshot: async () => null,
    writeSnapshot: async next => { persisted.push(next.summary.futuresMarginBalance); },
    writeEquityPoint: async () => {}, archiveSnapshot: async () => {} });
    const oldRequest = cache.get();
    await new Promise(resolve => setImmediate(resolve));
    await cache.invalidate();
    const current = cache.get({ force: true });
    release(snapshot(1000));
    assert.equal((await current).summary.futuresMarginBalance, 100000);
    assert.equal((await oldRequest).summary.futuresMarginBalance, 100000);
    assert.ok(!persisted.includes(1000), "a superseded account snapshot must never be persisted");
  });
  await test("new fetches wait until the credential transition finishes", async () => {
    let release;
    let fetchStarted = false;
    const cache = createBinanceHoldingSnapshotCache({ fetcher: async () => {
      fetchStarted = true; return snapshot(100000);
    }, ttlMs: 60000, readSnapshot: async () => null, writeSnapshot: async () => {},
    writeEquityPoint: async () => {}, archiveSnapshot: async () => {} });
    const transition = cache.invalidate(async () => {
      await new Promise(resolve => { release = resolve; });
    });
    await new Promise(resolve => setImmediate(resolve));
    const request = cache.get({ force: true });
    await new Promise(resolve => setImmediate(resolve));
    try {
      assert.equal(fetchStarted, false, "no fetch may run with credentials mid-transition");
    } finally {
      release?.();
      await transition;
      await request;
    }
  });
  await test("a get started immediately before invalidation cannot bypass the transition", async () => {
    let release;
    let accountBalance = 1000;
    const persisted = [];
    const cache = createBinanceHoldingSnapshotCache({
      fetcher: async () => snapshot(accountBalance),
      ttlMs: 60000,
      readSnapshot: async () => null,
      writeSnapshot: async next => { persisted.push(next.summary.futuresMarginBalance); },
      writeEquityPoint: async () => {},
      archiveSnapshot: async () => {},
    });
    const old = cache.get({ force: true });
    const transition = cache.invalidate(async () => {
      await new Promise(resolve => { release = resolve; });
      accountBalance = 100000;
    });
    await new Promise(resolve => setImmediate(resolve));
    try {
      assert.deepEqual(persisted, [], "no old-account write may bypass the active transition");
    } finally {
      release();
      await transition;
      await old;
    }
    assert.equal((await cache.get()).summary.futuresMarginBalance, 100000);
  });
} finally {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
}
