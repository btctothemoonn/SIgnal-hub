import assert from "node:assert/strict";
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
export async function saveStoredBinanceCredentials() {}
export function invalidateCachedBinanceHoldingSnapshot() {}
export async function clearPersistedBinancePositionPeakTrackings() {}

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

  const { GET } = await import(
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
} finally {
  rmSync(temporaryRoutePath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}
