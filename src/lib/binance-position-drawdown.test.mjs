import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const drawdownModule = await import("./binance-position-drawdown.ts").catch(
  () => null,
);

assert.ok(
  drawdownModule,
  "Binance position drawdown module should implement the approved feature",
);

const {
  buildBinancePositionPeakTracking,
  createBinancePositionPeakTrackingCache,
  readPersistedBinancePositionPeakTrackings,
  refreshBinancePositionPeakTrackings,
  writePersistedBinancePositionPeakTrackings,
} = drawdownModule;

const longTracking = buildBinancePositionPeakTracking({
  position: {
    symbol: "BTCUSDT",
    side: "LONG",
    amount: 3,
    entryPrice: 90,
    markPrice: 100,
    unrealizedPnl: 30,
    liquidationPrice: 60,
    leverage: 5,
    marginType: "cross",
    notional: 300,
    positionUpdatedAt: "1970-01-01T00:00:00.500Z",
  },
  trades: [
    { time: 1_000, side: "BUY", positionSide: "BOTH", qty: 1 },
    { time: 2_000, side: "BUY", positionSide: "BOTH", qty: 2 },
  ],
  candles: [
    { openTime: 1_000, closeTime: 1_999, high: 105, low: 95 },
    { openTime: 2_000, closeTime: 2_999, high: 120, low: 100 },
  ],
  previous: null,
  now: 3_000,
});

assert.equal(longTracking.openedAt, "1970-01-01T00:00:01.000Z");
assert.equal(longTracking.openedAtSource, "trades");
assert.equal(longTracking.favorablePrice, 120);
assert.equal(longTracking.drawdownPercent.toFixed(2), "16.67");

const shortTracking = buildBinancePositionPeakTracking({
  position: {
    symbol: "ETHUSDT",
    side: "SHORT",
    amount: -2,
    entryPrice: 95,
    markPrice: 100,
    unrealizedPnl: -10,
    liquidationPrice: 130,
    leverage: 5,
    marginType: "cross",
    notional: -200,
    positionUpdatedAt: null,
  },
  trades: [
    { time: 5_000, side: "SELL", positionSide: "SHORT", qty: 2 },
  ],
  candles: [
    { openTime: 5_000, closeTime: 5_999, high: 105, low: 80 },
  ],
  previous: null,
  now: 6_000,
});

assert.equal(shortTracking.openedAt, "1970-01-01T00:00:05.000Z");
assert.equal(shortTracking.favorablePrice, 80);
assert.equal(shortTracking.drawdownPercent.toFixed(2), "25.00");

const preservedTracking = buildBinancePositionPeakTracking({
  position: {
    symbol: "SOLUSDT",
    side: "LONG",
    amount: 10,
    entryPrice: 100,
    markPrice: 110,
    unrealizedPnl: 100,
    liquidationPrice: 70,
    leverage: 3,
    marginType: "cross",
    notional: 1_100,
    positionUpdatedAt: null,
  },
  trades: [],
  candles: [],
  previous: {
    symbol: "SOLUSDT",
    side: "LONG",
    openedAt: "2026-08-20T00:00:00.000Z",
    openedAtSource: "trades",
    favorablePrice: 150,
    drawdownPercent: 20,
    checkedAt: "2026-08-22T00:00:00.000Z",
  },
  now: Date.parse("2026-08-23T00:00:00.000Z"),
});

assert.equal(preservedTracking.openedAt, "2026-08-20T00:00:00.000Z");
assert.equal(preservedTracking.openedAtSource, "trades");
assert.equal(preservedTracking.favorablePrice, 150);
assert.equal(preservedTracking.drawdownPercent.toFixed(2), "26.67");

assert.equal(
  typeof refreshBinancePositionPeakTrackings,
  "function",
  "position tracking should backfill candles through the history client",
);

const openedAt = Date.parse("2026-08-22T06:00:00.000Z");
const refreshedAt = Date.parse("2026-08-23T08:00:00.000Z");
const candleRequests = [];
const refreshed = await refreshBinancePositionPeakTrackings({
  snapshot: {
    exchange: "binance",
    accountMode: "standard",
    updatedAt: new Date(refreshedAt).toISOString(),
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
  },
  previous: [],
  client: {
    async getUserTrades() {
      return [
        { time: openedAt, side: "BUY", positionSide: "BOTH", qty: 1 },
      ];
    },
    async getMarkPriceCandles(request) {
      candleRequests.push(request);
      return request.interval === "1m"
        ? [
            {
              openTime: openedAt,
              closeTime: openedAt + 59_999,
              high: 130,
              low: 90,
            },
          ]
        : [
            {
              openTime: Date.parse("2026-08-23T00:00:00.000Z"),
              closeTime: refreshedAt,
              high: 125,
              low: 100,
            },
          ];
    },
  },
  now: refreshedAt,
});

assert.deepEqual(
  candleRequests.map(({ interval, startTime, endTime }) => ({
    interval,
    startTime,
    endTime,
  })),
  [
    {
      interval: "1m",
      startTime: openedAt,
      endTime: Date.parse("2026-08-22T23:59:59.999Z"),
    },
    {
      interval: "1d",
      startTime: Date.parse("2026-08-23T00:00:00.000Z"),
      endTime: refreshedAt,
    },
  ],
);
assert.equal(refreshed[0].favorablePrice, 130);
assert.equal(refreshed[0].drawdownPercent.toFixed(2), "15.38");
assert.equal(refreshed[0].status, "live");

const cachedAfterFailure = await refreshBinancePositionPeakTrackings({
  snapshot: {
    exchange: "binance",
    accountMode: "standard",
    updatedAt: "2026-08-23T09:00:00.000Z",
    spotBalances: [],
    futuresPositions: [
      {
        symbol: "SOLUSDT",
        side: "LONG",
        amount: 10,
        entryPrice: 100,
        markPrice: 120,
        unrealizedPnl: 200,
        liquidationPrice: 70,
        leverage: 3,
        marginType: "cross",
        notional: 1_200,
      },
    ],
    summary: {},
    warnings: [],
  },
  previous: [
    {
      symbol: "SOLUSDT",
      side: "LONG",
      openedAt: "2026-08-20T00:00:00.000Z",
      openedAtSource: "trades",
      favorablePrice: 150,
      drawdownPercent: 20,
      checkedAt: "2026-08-22T00:00:00.000Z",
      status: "live",
    },
  ],
  client: {
    async getUserTrades() {
      return [];
    },
    async getMarkPriceCandles() {
      throw new Error("market data unavailable");
    },
  },
  now: Date.parse("2026-08-23T09:00:00.000Z"),
});

assert.equal(cachedAfterFailure[0].favorablePrice, 150);
assert.equal(cachedAfterFailure[0].drawdownPercent.toFixed(2), "20.00");
assert.equal(cachedAfterFailure[0].checkedAt, "2026-08-22T00:00:00.000Z");
assert.equal(cachedAfterFailure[0].status, "cached");
assert.match(cachedAfterFailure[0].error, /market data unavailable/);

assert.equal(
  typeof createBinancePositionPeakTrackingCache,
  "function",
  "position tracking should survive process restarts through persistence",
);

let persistedTrackings = null;
let refreshCalls = 0;
let clock = refreshedAt;
const cachedTracking = {
  symbol: "BTCUSDT",
  side: "LONG",
  openedAt: new Date(openedAt).toISOString(),
  openedAtSource: "trades",
  favorablePrice: 130,
  drawdownPercent: 15.38,
  checkedAt: new Date(refreshedAt).toISOString(),
  status: "live",
};
const trackingCache = createBinancePositionPeakTrackingCache({
  refresh: async () => {
    refreshCalls += 1;
    return [cachedTracking];
  },
  read: async () => persistedTrackings,
  write: async (trackings) => {
    persistedTrackings = trackings;
  },
  ttlMs: 60_000,
  now: () => clock,
});

assert.deepEqual(
  await trackingCache.get({
    exchange: "binance",
    accountMode: "standard",
    updatedAt: new Date(refreshedAt).toISOString(),
    spotBalances: [],
    futuresPositions: [],
    summary: {},
    warnings: [],
  }),
  [cachedTracking],
);
assert.equal(refreshCalls, 1);
assert.deepEqual(persistedTrackings, [cachedTracking]);

const restartedCache = createBinancePositionPeakTrackingCache({
  refresh: async () => {
    throw new Error("refresh should not run for fresh persisted data");
  },
  read: async () => persistedTrackings,
  write: async () => {},
  ttlMs: 60_000,
  now: () => clock,
});
assert.deepEqual(
  await restartedCache.get({
    exchange: "binance",
    accountMode: "standard",
    updatedAt: new Date(refreshedAt).toISOString(),
    spotBalances: [],
    futuresPositions: [],
    summary: {},
    warnings: [],
  }),
  [cachedTracking],
);

clock += 60_001;

assert.equal(typeof readPersistedBinancePositionPeakTrackings, "function");
assert.equal(typeof writePersistedBinancePositionPeakTrackings, "function");
const persistencePath = join(
  dirname(fileURLToPath(import.meta.url)),
  `binance-position-drawdown-${process.pid}.json`,
);
try {
  await writePersistedBinancePositionPeakTrackings([cachedTracking], {
    path: persistencePath,
  });
  assert.deepEqual(
    await readPersistedBinancePositionPeakTrackings({ path: persistencePath }),
    [cachedTracking],
  );
} finally {
  rmSync(persistencePath, { force: true });
}

console.log("ok - Binance position peak drawdown calculations");
