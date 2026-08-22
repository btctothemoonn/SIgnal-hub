import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createBinanceFuturesHistoryClient } from "./binance-holdings.ts";
import type {
  BinanceFuturesHistoryClient,
  BinanceFuturesPosition,
  BinanceHoldingSnapshot,
} from "./binance-holdings";

const BINANCE_POSITION_PEAK_TRACKING_PATH = resolve(
  /* turbopackIgnore: true */ process.cwd(),
  ".signal-hub",
  "binance-position-peak-tracking.json",
);

export type BinanceFuturesUserTrade = {
  time: number;
  side: "BUY" | "SELL";
  positionSide: "BOTH" | "LONG" | "SHORT";
  qty: number;
};

export type BinanceMarkPriceCandle = {
  openTime: number;
  closeTime: number;
  high: number;
  low: number;
};

export type BinancePositionPeakTracking = {
  symbol: string;
  side: BinanceFuturesPosition["side"];
  openedAt: string;
  openedAtSource: "trades" | "position-update" | "first-seen";
  favorablePrice: number;
  drawdownPercent: number;
  checkedAt: string;
  status: "live" | "cached";
  error?: string;
};

type PositionWithUpdateTime = BinanceFuturesPosition & {
  positionUpdatedAt?: string | null;
};

function isPositionPeakTracking(
  value: unknown,
): value is BinancePositionPeakTracking {
  if (!value || typeof value !== "object") return false;
  const tracking = value as Partial<BinancePositionPeakTracking>;
  return (
    typeof tracking.symbol === "string" &&
    (tracking.side === "LONG" || tracking.side === "SHORT") &&
    validTime(tracking.openedAt) !== null &&
    (tracking.openedAtSource === "trades" ||
      tracking.openedAtSource === "position-update" ||
      tracking.openedAtSource === "first-seen") &&
    typeof tracking.favorablePrice === "number" &&
    Number.isFinite(tracking.favorablePrice) &&
    tracking.favorablePrice > 0 &&
    typeof tracking.drawdownPercent === "number" &&
    Number.isFinite(tracking.drawdownPercent) &&
    validTime(tracking.checkedAt) !== null &&
    (tracking.status === "live" || tracking.status === "cached") &&
    (tracking.error === undefined || typeof tracking.error === "string")
  );
}

export async function readPersistedBinancePositionPeakTrackings({
  path = BINANCE_POSITION_PEAK_TRACKING_PATH,
}: {
  path?: string;
} = {}): Promise<BinancePositionPeakTracking[] | null> {
  try {
    const content = await readFile(/* turbopackIgnore: true */ path, "utf8");
    const parsed = JSON.parse(content) as { trackings?: unknown };
    return Array.isArray(parsed.trackings)
      ? parsed.trackings.filter(isPositionPeakTracking)
      : null;
  } catch {
    return null;
  }
}

export async function writePersistedBinancePositionPeakTrackings(
  trackings: BinancePositionPeakTracking[],
  {
    path = BINANCE_POSITION_PEAK_TRACKING_PATH,
  }: {
    path?: string;
  } = {},
): Promise<void> {
  await mkdir(dirname(/* turbopackIgnore: true */ path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    /* turbopackIgnore: true */ temporaryPath,
    JSON.stringify({ trackings, savedAt: new Date().toISOString() }),
    "utf8",
  );
  await rename(
    /* turbopackIgnore: true */ temporaryPath,
    /* turbopackIgnore: true */ path,
  );
}

function validTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isTradeForPosition(
  trade: BinanceFuturesUserTrade,
  position: BinanceFuturesPosition,
) {
  return (
    trade.positionSide === "BOTH" || trade.positionSide === position.side
  );
}

export function inferCurrentPositionOpenedAt({
  position,
  trades,
}: {
  position: BinanceFuturesPosition;
  trades: BinanceFuturesUserTrade[];
}): number | null {
  const direction = Math.sign(position.amount);
  if (direction === 0) return null;

  let remaining = position.amount;
  const tolerance = Math.max(1, Math.abs(position.amount)) * 1e-8;
  const relevantTrades = trades
    .filter((trade) => isTradeForPosition(trade, position))
    .filter(
      (trade) =>
        Number.isFinite(trade.time) &&
        trade.time > 0 &&
        Number.isFinite(trade.qty) &&
        trade.qty > 0,
    )
    .sort((left, right) => right.time - left.time);

  for (const trade of relevantTrades) {
    const delta = trade.side === "BUY" ? trade.qty : -trade.qty;
    const previous = remaining - delta;
    if (
      Math.abs(previous) <= tolerance ||
      (Math.sign(previous) !== 0 && Math.sign(previous) !== direction)
    ) {
      return trade.time;
    }
    remaining = previous;
  }

  return null;
}

function peakDrawdownPercent({
  side,
  favorablePrice,
  markPrice,
}: {
  side: BinanceFuturesPosition["side"];
  favorablePrice: number;
  markPrice: number;
}) {
  if (favorablePrice <= 0 || markPrice <= 0) return 0;
  const value =
    side === "SHORT"
      ? ((markPrice - favorablePrice) / favorablePrice) * 100
      : ((favorablePrice - markPrice) / favorablePrice) * 100;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildBinancePositionPeakTracking({
  position,
  trades,
  candles,
  previous,
  now,
  status = "live",
  error,
}: {
  position: PositionWithUpdateTime;
  trades: BinanceFuturesUserTrade[];
  candles: BinanceMarkPriceCandle[];
  previous: BinancePositionPeakTracking | null;
  now: number;
  status?: BinancePositionPeakTracking["status"];
  error?: string;
}): BinancePositionPeakTracking {
  const inferredOpenedAt = inferCurrentPositionOpenedAt({ position, trades });
  const previousOpenedAt =
    previous?.symbol === position.symbol && previous.side === position.side
      ? validTime(previous.openedAt)
      : null;
  const positionUpdatedAt = validTime(position.positionUpdatedAt);
  const openedAt = inferredOpenedAt ?? previousOpenedAt ?? positionUpdatedAt ?? now;
  const openedAtSource: BinancePositionPeakTracking["openedAtSource"] =
    inferredOpenedAt !== null
      ? "trades"
      : previousOpenedAt !== null && previous
        ? previous.openedAtSource
        : positionUpdatedAt !== null
          ? "position-update"
          : "first-seen";
  const openedAtIso = new Date(openedAt).toISOString();
  const canReusePrevious =
    previous?.symbol === position.symbol &&
    previous.side === position.side &&
    previous.openedAt === openedAtIso &&
    Number.isFinite(previous.favorablePrice) &&
    previous.favorablePrice > 0;
  const validCandles = candles.filter(
    (candle) =>
      candle.closeTime >= openedAt &&
      Number.isFinite(candle.high) &&
      candle.high > 0 &&
      Number.isFinite(candle.low) &&
      candle.low > 0,
  );
  const priceCandidates = [position.markPrice];
  if (canReusePrevious && previous) {
    priceCandidates.push(previous.favorablePrice);
  }
  for (const candle of validCandles) {
    priceCandidates.push(position.side === "SHORT" ? candle.low : candle.high);
  }
  const positivePrices = priceCandidates.filter(
    (price) => Number.isFinite(price) && price > 0,
  );
  const favorablePrice =
    positivePrices.length === 0
      ? 0
      : position.side === "SHORT"
        ? Math.min(...positivePrices)
        : Math.max(...positivePrices);

  return {
    symbol: position.symbol,
    side: position.side,
    openedAt: openedAtIso,
    openedAtSource,
    favorablePrice,
    drawdownPercent: peakDrawdownPercent({
      side: position.side,
      favorablePrice,
      markPrice: position.markPrice,
    }),
    checkedAt: new Date(now).toISOString(),
    status,
    ...(error ? { error } : {}),
  };
}

type PeakCandleRequest = Parameters<
  BinanceFuturesHistoryClient["getMarkPriceCandles"]
>[0];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_CANDLES = 1500;

function utcDayStart(time: number) {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

function dailyCandleRequests({
  symbol,
  startTime,
  endTime,
}: {
  symbol: string;
  startTime: number;
  endTime: number;
}): PeakCandleRequest[] {
  const requests: PeakCandleRequest[] = [];
  let cursor = startTime;
  const maxSpan = MAX_DAILY_CANDLES * DAY_MS - 1;
  while (cursor <= endTime) {
    const windowEnd = Math.min(endTime, cursor + maxSpan);
    requests.push({
      symbol,
      interval: "1d",
      startTime: cursor,
      endTime: windowEnd,
    });
    cursor = windowEnd + 1;
  }
  return requests;
}

function buildPeakCandleRequests({
  symbol,
  openedAt,
  previousCheckedAt,
  endTime,
}: {
  symbol: string;
  openedAt: number;
  previousCheckedAt: number | null;
  endTime: number;
}): PeakCandleRequest[] {
  if (openedAt > endTime) return [];

  if (previousCheckedAt !== null && previousCheckedAt >= openedAt) {
    return dailyCandleRequests({
      symbol,
      startTime: utcDayStart(previousCheckedAt),
      endTime,
    });
  }

  const nextDay = utcDayStart(openedAt) + DAY_MS;
  if (endTime < nextDay) {
    return [
      {
        symbol,
        interval: "1m",
        startTime: openedAt,
        endTime,
      },
    ];
  }

  return [
    {
      symbol,
      interval: "1m",
      startTime: openedAt,
      endTime: nextDay - 1,
    },
    ...dailyCandleRequests({
      symbol,
      startTime: nextDay,
      endTime,
    }),
  ];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Binance 历史行情获取失败";
}

export async function refreshBinancePositionPeakTrackings({
  snapshot,
  previous,
  client,
  now,
}: {
  snapshot: BinanceHoldingSnapshot;
  previous: BinancePositionPeakTracking[];
  client: BinanceFuturesHistoryClient;
  now: number;
}): Promise<BinancePositionPeakTracking[]> {
  const previousByPosition = new Map(
    previous.map((tracking) => [
      `${tracking.symbol}:${tracking.side}`,
      tracking,
    ]),
  );

  return await Promise.all(
    snapshot.futuresPositions.map(async (position) => {
      const previousTracking =
        previousByPosition.get(`${position.symbol}:${position.side}`) ?? null;
      let trades: BinanceFuturesUserTrade[] = [];
      try {
        trades = await client.getUserTrades(position.symbol);
      } catch {
        trades = [];
      }

      const preliminary = buildBinancePositionPeakTracking({
        position,
        trades,
        candles: [],
        previous: previousTracking,
        now,
      });
      const openedAt = Date.parse(preliminary.openedAt);
      const canContinuePrevious =
        previousTracking?.openedAt === preliminary.openedAt;
      const previousCheckedAt = canContinuePrevious
        ? validTime(previousTracking.checkedAt)
        : null;
      const requests = buildPeakCandleRequests({
        symbol: position.symbol,
        openedAt,
        previousCheckedAt,
        endTime: now,
      });

      try {
        const candleGroups = await Promise.all(
          requests.map((request) => client.getMarkPriceCandles(request)),
        );
        return buildBinancePositionPeakTracking({
          position,
          trades,
          candles: candleGroups.flat(),
          previous: canContinuePrevious ? previousTracking : null,
          now,
        });
      } catch (error) {
        const fallback = buildBinancePositionPeakTracking({
          position,
          trades,
          candles: [],
          previous: canContinuePrevious ? previousTracking : null,
          now,
          status: "cached",
          error: errorMessage(error),
        });
        return {
          ...fallback,
          checkedAt: previousTracking?.checkedAt ?? fallback.checkedAt,
        };
      }
    }),
  );
}

export type BinancePositionPeakTrackingCache = {
  get: (
    snapshot: BinanceHoldingSnapshot,
    options?: { force?: boolean },
  ) => Promise<BinancePositionPeakTracking[]>;
  invalidate: () => void;
};

export function createBinancePositionPeakTrackingCache({
  refresh,
  read,
  write,
  ttlMs,
  now = Date.now,
}: {
  refresh: (
    snapshot: BinanceHoldingSnapshot,
    previous: BinancePositionPeakTracking[],
  ) => Promise<BinancePositionPeakTracking[]>;
  read: () => Promise<BinancePositionPeakTracking[] | null>;
  write: (trackings: BinancePositionPeakTracking[]) => Promise<void>;
  ttlMs: number;
  now?: () => number;
}): BinancePositionPeakTrackingCache {
  let value: BinancePositionPeakTracking[] | null = null;
  let fetchedAt = 0;
  let pending: Promise<BinancePositionPeakTracking[]> | null = null;

  const refreshValue = (
    snapshot: BinanceHoldingSnapshot,
    previous: BinancePositionPeakTracking[],
  ) => {
    if (pending) return pending;
    pending = refresh(snapshot, previous).then(
      async (next) => {
        value = next;
        fetchedAt = now();
        pending = null;
        await write(next);
        return next;
      },
      (error) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  return {
    async get(snapshot, { force = false } = {}) {
      if (force) {
        return await refreshValue(snapshot, value ?? []);
      }

      if (value !== null) {
        if (now() - fetchedAt >= ttlMs) {
          void refreshValue(snapshot, value).catch(() => undefined);
        }
        return value;
      }

      const persisted = await read();
      if (persisted !== null) {
        value = persisted;
        fetchedAt = now();
        return persisted;
      }

      return await refreshValue(snapshot, []);
    },
    invalidate() {
      value = null;
      fetchedAt = 0;
    },
  };
}

export function attachBinancePositionPeakTrackings(
  snapshot: BinanceHoldingSnapshot,
  trackings: BinancePositionPeakTracking[],
): BinanceHoldingSnapshot {
  const byPosition = new Map(
    trackings.map((tracking) => [
      `${tracking.symbol}:${tracking.side}`,
      tracking,
    ]),
  );
  return {
    ...snapshot,
    futuresPositions: snapshot.futuresPositions.map((position) => ({
      ...position,
      peakTracking: byPosition.get(`${position.symbol}:${position.side}`),
    })),
  };
}

function getBinancePositionPeakTrackingTtlMs(
  env: NodeJS.ProcessEnv = process.env,
) {
  const parsed = Number(env.BINANCE_POSITION_DRAWDOWN_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function buildCachedFallbackTrackings({
  snapshot,
  previous,
  now,
  error,
}: {
  snapshot: BinanceHoldingSnapshot;
  previous: BinancePositionPeakTracking[];
  now: number;
  error: unknown;
}) {
  const previousByPosition = new Map(
    previous.map((tracking) => [
      `${tracking.symbol}:${tracking.side}`,
      tracking,
    ]),
  );
  return snapshot.futuresPositions.map((position) => {
    const previousTracking =
      previousByPosition.get(`${position.symbol}:${position.side}`) ?? null;
    const fallback = buildBinancePositionPeakTracking({
      position,
      trades: [],
      candles: [],
      previous: previousTracking,
      now,
      status: "cached",
      error: errorMessage(error),
    });
    return {
      ...fallback,
      checkedAt: previousTracking?.checkedAt ?? fallback.checkedAt,
    };
  });
}

const sharedBinancePositionPeakTrackingCache =
  createBinancePositionPeakTrackingCache({
    refresh: async (snapshot, previous) => {
      const now = Date.now();
      if (snapshot.futuresPositions.length === 0) return [];
      try {
        const client = await createBinanceFuturesHistoryClient({
          accountMode: snapshot.accountMode,
        });
        return await refreshBinancePositionPeakTrackings({
          snapshot,
          previous,
          client,
          now,
        });
      } catch (error) {
        return buildCachedFallbackTrackings({
          snapshot,
          previous,
          now,
          error,
        });
      }
    },
    read: readPersistedBinancePositionPeakTrackings,
    write: writePersistedBinancePositionPeakTrackings,
    ttlMs: getBinancePositionPeakTrackingTtlMs(),
  });

export function getCachedBinancePositionPeakTrackings(
  snapshot: BinanceHoldingSnapshot,
  options?: { force?: boolean },
) {
  return sharedBinancePositionPeakTrackingCache.get(snapshot, options);
}

export async function clearPersistedBinancePositionPeakTrackings() {
  sharedBinancePositionPeakTrackingCache.invalidate();
  await unlink(
    /* turbopackIgnore: true */ BINANCE_POSITION_PEAK_TRACKING_PATH,
  ).catch(() => undefined);
}
