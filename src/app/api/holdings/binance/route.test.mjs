import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
const routePath = join(directory, "route.ts");
const temporaryRoutePath = join(directory, `route.runtime-${process.pid}.mjs`);
const temporaryStubsPath = join(directory, `route.stubs-${process.pid}.mjs`);
const temporaryStubsImport = `./route.stubs-${process.pid}.mjs`;

try {
  writeFileSync(
    temporaryStubsPath,
    `
export class BinanceConfigError extends Error {}
export class BinanceNetworkError extends Error {}
export class BinanceUpstreamError extends Error {}

export function resetBinanceHoldingRuntimeHints() {}
export const accountEvents = [];
export let accountKey = "old-key";
export let archiveFails = false;
let archiveBarrier = null;
export function blockNextArchive() {
  let release;
  archiveBarrier = new Promise(resolve => { release = resolve; });
  return release;
}
export function setArchiveFailure(value) { archiveFails = value; }
export function setAccountKey(value) { accountKey = value; }
export async function getBinanceConfig() { return { apiKey: accountKey }; }
export function resolveBinanceConfig({storedCredentials}) { return storedCredentials; }
export async function saveStoredBinanceCredentials(credentials) { accountKey = credentials.apiKey; accountEvents.push("save"); }
export async function invalidateCachedBinanceHoldingSnapshot(updateAccount) {
  await new Promise(resolve => setImmediate(resolve));
  if (archiveFails) throw new Error("EACCES: cannot archive");
  accountEvents.push("archive");
  const barrier = archiveBarrier;
  archiveBarrier = null;
  if (barrier) await barrier;
  if (updateAccount) await updateAccount();
}
export async function clearPersistedBinancePositionPeakTrackings() { accountEvents.push("clear-peaks"); }

export async function getCachedBinanceHoldingSnapshot() {
  return {
    exchange: "binance",
    accountMode: "standard",
    updatedAt: "2026-08-23T08:00:00.000Z",
    spotBalances: [],
    futuresPositions: [
      {
        symbol: "BTCUSDT",
        side: "LONG",
        amount: 1,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: 10,
        liquidationPrice: 60,
        leverage: 5,
        marginType: "cross",
        notional: 110,
      },
    ],
    summary: {},
    warnings: [],
  };
}

export async function readPersistedBinanceFuturesEquityHistory() {
  return [];
}

export async function getCachedBinancePositionPeakTrackings() {
  return [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      openedAt: "2026-08-22T06:00:00.000Z",
      openedAtSource: "trades",
      favorablePrice: 130,
      drawdownPercent: 15.38,
      checkedAt: "2026-08-23T08:00:00.000Z",
      status: "live",
    },
  ];
}

export function attachBinancePositionPeakTrackings(snapshot, trackings) {
  const byPosition = new Map(
    trackings.map((tracking) => [
      tracking.symbol + ":" + tracking.side,
      tracking,
    ]),
  );
  return {
    ...snapshot,
    futuresPositions: snapshot.futuresPositions.map((position) => ({
      ...position,
      peakTracking: byPosition.get(position.symbol + ":" + position.side),
    })),
  };
}
`,
    "utf8",
  );

  const routeOutput = ts
    .transpileModule(readFileSync(routePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: routePath,
    })
    .outputText.replaceAll(
      /from "@\/[^"]+";/g,
      `from "${temporaryStubsImport}";`,
    )
    .replace('from "next/server";', 'from "next/server.js";');
  writeFileSync(temporaryRoutePath, routeOutput, "utf8");

  const { GET, POST } = await import(
    `${pathToFileURL(temporaryRoutePath).href}?run=${Date.now()}`
  );
  const response = await GET(
    new Request("http://localhost/api/holdings/binance?refresh=1"),
  );
  const payload = await response.json();
  const peakTracking = payload.snapshot.futuresPositions[0].peakTracking;

  assert.equal(response.status, 200);
  assert.ok(peakTracking, "route should attach peak tracking to each position");
  assert.equal(
    peakTracking.favorablePrice,
    130,
  );
  assert.equal(
    peakTracking.drawdownPercent,
    15.38,
  );

  console.log("ok - Binance holdings route enriches positions with peak drawdown");
  const stubs = await import(pathToFileURL(temporaryStubsPath).href);
  await test("saving a new account waits for history archival before reporting success", async () => {
    stubs.accountEvents.length = 0;
    const saved = await POST(new Request("http://localhost/api/holdings/binance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "new-key", apiSecret: "new-secret" }),
    }));
    assert.equal(saved.status, 200);
    assert.deepEqual(stubs.accountEvents, ["archive", "clear-peaks", "save"]);
    await new Promise(resolve => setImmediate(resolve));
  });
  await test("archive failure keeps the previous account credentials active", async () => {
    stubs.setArchiveFailure(true);
    stubs.accountEvents.length = 0;
    try {
      const failed = await POST(new Request("http://localhost/api/holdings/binance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "failed-key", apiSecret: "failed-secret" }),
      }));
      assert.equal(failed.status, 500);
      assert.equal((await stubs.getBinanceConfig()).apiKey, "new-key");
      assert.deepEqual(stubs.accountEvents, []);
    } finally {
      stubs.setArchiveFailure(false);
      stubs.setAccountKey("new-key");
    }
  });
  await test("saving the same account again preserves its existing history", async () => {
    await new Promise(resolve => setImmediate(resolve));
    stubs.accountEvents.length = 0;
    await POST(new Request("http://localhost/api/holdings/binance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "new-key", apiSecret: "rotated-secret" }),
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(stubs.accountEvents, ["save"]);
  });
  await test("concurrent credential saves compare against the completed account transition", async () => {
    stubs.setAccountKey("account-a");
    stubs.accountEvents.length = 0;
    const release = stubs.blockNextArchive();
    const save = apiKey => POST(new Request("http://localhost/api/holdings/binance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, apiSecret: "secret" }),
    }));
    const first = save("account-b");
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const second = save("account-a");
    await new Promise(resolve => setImmediate(resolve));
    try {
      assert.equal(stubs.accountEvents.includes("save"), false,
        "the second save must not bypass the first transition");
    } finally {
      release();
      assert.equal((await first).status, 200);
      assert.equal((await second).status, 200);
    }
    assert.equal(stubs.accountKey, "account-a");
    assert.deepEqual(stubs.accountEvents,
      ["archive", "clear-peaks", "save", "archive", "clear-peaks", "save"]);
  });
} finally {
  rmSync(temporaryRoutePath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}
