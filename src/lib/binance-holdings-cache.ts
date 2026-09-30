import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
  invalidate: (updateAccount?: () => Promise<void>) => Promise<void>;
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
  archiveSnapshot = archivePersistedBinanceHoldingAccountData,
}: {
  fetcher: () => Promise<BinanceHoldingSnapshot>;
  ttlMs: number;
  now?: () => number;
  readSnapshot?: () => Promise<BinanceHoldingSnapshot | null>;
  writeSnapshot?: (snapshot: BinanceHoldingSnapshot) => Promise<void>;
  writeEquityPoint?: (snapshot: BinanceHoldingSnapshot) => Promise<void>;
  archiveSnapshot?: () => Promise<void>;
}): BinanceHoldingSnapshotCache {
  let value: BinanceHoldingSnapshot | null = null;
  let fetchedAt = 0;
  let pending: Promise<BinanceHoldingSnapshot> | null = null;
  let generation = 0;
  let persistence: Promise<void> = Promise.resolve();
  let resetPromise: Promise<void> | null = null;

  const refresh = () => {
    if (pending) return pending;

    const requestGeneration = generation;
    const request = fetcher().then(
      async (next) => {
        if (requestGeneration !== generation) return get({ force: true });
        value = next;
        fetchedAt = now();
        const write = persistence.then(async () => {
          if (requestGeneration !== generation) return;
          await writeSnapshot(next);
          if (requestGeneration === generation) {
            await writeEquityPoint(next).catch(() => undefined);
          }
        });
        persistence = write.catch(() => undefined);
        await write;
        if (requestGeneration !== generation) return get({ force: true });
        return next;
      },
      (error) => {
        throw error;
      },
    ).finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return pending;
  };

  const refreshInBackground = () => {
    void refresh().catch(() => undefined);
  };

  async function get(
    { force = false }: { force?: boolean } = {},
  ): Promise<BinanceHoldingSnapshot> {
    while (resetPromise) await resetPromise;
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

    const readGeneration = generation;
    const persisted = await readSnapshot();
    if (readGeneration !== generation) return get({ force });
    if (persisted) {
      value = persisted;
      fetchedAt = 0;
      refreshInBackground();
      return persisted;
    }

    return await refresh();
  }
  return {
    get,
    invalidate(updateAccount) {
      generation += 1;
      value = null;
      fetchedAt = 0;
      pending = null;
      const reset = (resetPromise ?? Promise.resolve())
        .then(() => persistence)
        .then(archiveSnapshot)
        .then(updateAccount)
        .finally(() => {
          if (resetPromise === reset) resetPromise = null;
        });
      resetPromise = reset;
      return reset;
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

export async function readPersistedBinanceHoldingSnapshot(): Promise<BinanceHoldingSnapshot | null> {
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

async function archivePersistedBinanceHoldingAccountData(): Promise<void> {
  const archiveDir = resolve(
    dirname(BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH),
    "binance-account-archive",
    `${Date.now()}-${randomUUID()}`,
  );
  await mkdir(archiveDir, { recursive: true });
  for (const path of [
    BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH,
    BINANCE_FUTURES_EQUITY_HISTORY_PATH,
  ]) {
    try {
      await rename(path, resolve(archiveDir, basename(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function invalidateCachedBinanceHoldingSnapshot(
  updateAccount?: () => Promise<void>,
): Promise<void> {
  return sharedBinanceHoldingSnapshotCache.invalidate(updateAccount);
}
