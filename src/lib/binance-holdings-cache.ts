import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  getBinanceHoldingSnapshot,
  type BinanceFuturesEquityPoint,
  type BinanceHoldingSnapshot,
} from "./binance-holdings.ts";

const DEFAULT_BINANCE_HOLDINGS_CACHE_TTL_MS = 15_000;
const BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH = resolve(
  process.cwd(),
  ".signal-hub",
  "binance-holdings-snapshot.json",
);
const BINANCE_FUTURES_EQUITY_HISTORY_PATH = resolve(
  process.cwd(),
  ".signal-hub",
  "binance-futures-equity-history.json",
);
const DEFAULT_BINANCE_FUTURES_EQUITY_HISTORY_MAX_POINTS = 2880;

type PersistedBinanceHoldingSnapshot = {
  snapshot?: unknown;
};

type PersistedBinanceFuturesEquityHistory = {
  points?: unknown;
};

export type BinanceHoldingSnapshotCache = {
  get: (options?: { force?: boolean }) => Promise<BinanceHoldingSnapshot>;
  invalidate: () => void;
};

export function getBinanceHoldingSnapshotCacheTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(env.BINANCE_HOLDINGS_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BINANCE_HOLDINGS_CACHE_TTL_MS;
}

export function getBinanceFuturesEquityHistoryMaxPoints(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(env.BINANCE_FUTURES_EQUITY_HISTORY_MAX_POINTS);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BINANCE_FUTURES_EQUITY_HISTORY_MAX_POINTS;
}

export function createBinanceHoldingSnapshotCache({
  fetcher,
  ttlMs,
  now = Date.now,
  readSnapshot = readPersistedBinanceHoldingSnapshot,
  writeSnapshot = writePersistedBinanceHoldingSnapshot,
  writeEquityPoint = writePersistedBinanceFuturesEquityPoint,
}: {
  fetcher: () => Promise<BinanceHoldingSnapshot>;
  ttlMs: number;
  now?: () => number;
  readSnapshot?: () => Promise<BinanceHoldingSnapshot | null>;
  writeSnapshot?: (snapshot: BinanceHoldingSnapshot) => Promise<void>;
  writeEquityPoint?: (snapshot: BinanceHoldingSnapshot) => Promise<void>;
}): BinanceHoldingSnapshotCache {
  let value: BinanceHoldingSnapshot | null = null;
  let fetchedAt = 0;
  let pending: Promise<BinanceHoldingSnapshot> | null = null;

  const refresh = () => {
    if (pending) return pending;

    pending = fetcher().then(
      async (next) => {
        value = next;
        fetchedAt = now();
        pending = null;
        await writeSnapshot(next);
        await writeEquityPoint(next).catch(() => undefined);
        return next;
      },
      (error) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  const refreshInBackground = () => {
    void refresh().catch(() => undefined);
  };

  return {
    async get({ force = false }: { force?: boolean } = {}) {
      if (force) {
        value = null;
        fetchedAt = 0;
        return await refresh();
      }

      if (value !== null) {
        if (now() - fetchedAt < ttlMs) return value;
        refreshInBackground();
        return value;
      }

      const persisted = await readSnapshot();
      if (persisted) {
        value = persisted;
        fetchedAt = 0;
        refreshInBackground();
        return persisted;
      }

      return await refresh();
    },
    invalidate() {
      value = null;
      fetchedAt = 0;
    },
  };
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBinanceFuturesEquityPoint(
  value: unknown,
): value is BinanceFuturesEquityPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<BinanceFuturesEquityPoint>;
  return (
    typeof point.at === "string" &&
    Number.isFinite(new Date(point.at).getTime()) &&
    typeof point.walletBalance === "number" &&
    Number.isFinite(point.walletBalance) &&
    typeof point.unrealizedPnl === "number" &&
    Number.isFinite(point.unrealizedPnl) &&
    typeof point.marginBalance === "number" &&
    Number.isFinite(point.marginBalance) &&
    typeof point.availableBalance === "number" &&
    Number.isFinite(point.availableBalance)
  );
}

function equityMinuteBucket(at: string) {
  const time = new Date(at).getTime();
  return Number.isFinite(time) ? Math.floor(time / 60_000) : null;
}

export function buildBinanceFuturesEquityPoint(
  snapshot: BinanceHoldingSnapshot,
): BinanceFuturesEquityPoint {
  return {
    at: snapshot.updatedAt,
    walletBalance: snapshot.summary.futuresWalletBalance,
    unrealizedPnl: snapshot.summary.futuresUnrealizedPnl,
    marginBalance: snapshot.summary.futuresMarginBalance,
    availableBalance: snapshot.summary.futuresAvailableBalance,
  };
}

export function mergeBinanceFuturesEquityHistory({
  history,
  point,
  maxPoints = DEFAULT_BINANCE_FUTURES_EQUITY_HISTORY_MAX_POINTS,
}: {
  history: BinanceFuturesEquityPoint[];
  point: BinanceFuturesEquityPoint;
  maxPoints?: number;
}): BinanceFuturesEquityPoint[] {
  if (!isBinanceFuturesEquityPoint(point)) {
    return history.filter(isBinanceFuturesEquityPoint);
  }
  const pointBucket = equityMinuteBucket(point.at);
  const points = history
    .filter(isBinanceFuturesEquityPoint)
    .filter((item) => equityMinuteBucket(item.at) !== pointBucket)
    .concat(point)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  return points.slice(-Math.max(1, maxPoints));
}

function isBinanceHoldingSnapshot(
  value: unknown,
): value is BinanceHoldingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<BinanceHoldingSnapshot>;
  return (
    snapshot.exchange === "binance" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.spotBalances) &&
    Array.isArray(snapshot.futuresPositions) &&
    Boolean(snapshot.summary)
  );
}

async function readPersistedBinanceHoldingSnapshot(): Promise<BinanceHoldingSnapshot | null> {
  try {
    const content = await readFile(BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(content) as PersistedBinanceHoldingSnapshot;
    return isBinanceHoldingSnapshot(parsed.snapshot) ? parsed.snapshot : null;
  } catch {
    return null;
  }
}

export async function readPersistedBinanceFuturesEquityHistory(): Promise<
  BinanceFuturesEquityPoint[]
> {
  try {
    const content = await readFile(BINANCE_FUTURES_EQUITY_HISTORY_PATH, "utf-8");
    const parsed = JSON.parse(content) as PersistedBinanceFuturesEquityHistory;
    return Array.isArray(parsed.points)
      ? parsed.points.filter(isBinanceFuturesEquityPoint)
      : [];
  } catch {
    return [];
  }
}

async function writePersistedBinanceHoldingSnapshot(
  snapshot: BinanceHoldingSnapshot,
): Promise<void> {
  await mkdir(dirname(BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH), { recursive: true });
  const tmpPath = `${BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    tmpPath,
    JSON.stringify({ snapshot, savedAt: new Date().toISOString() }),
    "utf-8",
  );
  await rename(tmpPath, BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH);
}

async function writePersistedBinanceFuturesEquityPoint(
  snapshot: BinanceHoldingSnapshot,
): Promise<void> {
  const point = buildBinanceFuturesEquityPoint(snapshot);
  if (
    numberValue(point.walletBalance) === null ||
    numberValue(point.unrealizedPnl) === null ||
    numberValue(point.marginBalance) === null ||
    numberValue(point.availableBalance) === null
  ) {
    return;
  }

  const points = mergeBinanceFuturesEquityHistory({
    history: await readPersistedBinanceFuturesEquityHistory(),
    point,
    maxPoints: getBinanceFuturesEquityHistoryMaxPoints(),
  });
  await mkdir(dirname(BINANCE_FUTURES_EQUITY_HISTORY_PATH), { recursive: true });
  const tmpPath = `${BINANCE_FUTURES_EQUITY_HISTORY_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    tmpPath,
    JSON.stringify({ points, savedAt: new Date().toISOString() }),
    "utf-8",
  );
  await rename(tmpPath, BINANCE_FUTURES_EQUITY_HISTORY_PATH);
}

const sharedBinanceHoldingSnapshotCache = createBinanceHoldingSnapshotCache({
  fetcher: () => getBinanceHoldingSnapshot(),
  ttlMs: getBinanceHoldingSnapshotCacheTtlMs(),
});

export function getCachedBinanceHoldingSnapshot(options?: {
  force?: boolean;
}): Promise<BinanceHoldingSnapshot> {
  return sharedBinanceHoldingSnapshotCache.get(options);
}

export function invalidateCachedBinanceHoldingSnapshot() {
  sharedBinanceHoldingSnapshotCache.invalidate();
}
