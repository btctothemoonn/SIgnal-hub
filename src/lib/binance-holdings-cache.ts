import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  getBinanceHoldingSnapshot,
  type BinanceHoldingSnapshot,
} from "./binance-holdings.ts";

const DEFAULT_BINANCE_HOLDINGS_CACHE_TTL_MS = 15_000;
const BINANCE_HOLDINGS_SNAPSHOT_CACHE_PATH = resolve(
  process.cwd(),
  ".signal-hub",
  "binance-holdings-snapshot.json",
);

type PersistedBinanceHoldingSnapshot = {
  snapshot?: unknown;
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

export function createBinanceHoldingSnapshotCache({
  fetcher,
  ttlMs,
  now = Date.now,
  readSnapshot = readPersistedBinanceHoldingSnapshot,
  writeSnapshot = writePersistedBinanceHoldingSnapshot,
}: {
  fetcher: () => Promise<BinanceHoldingSnapshot>;
  ttlMs: number;
  now?: () => number;
  readSnapshot?: () => Promise<BinanceHoldingSnapshot | null>;
  writeSnapshot?: (snapshot: BinanceHoldingSnapshot) => Promise<void>;
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
