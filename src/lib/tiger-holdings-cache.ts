import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getTigerHoldingData,
  type TigerEquityPoint,
  type TigerHoldingData,
} from "./tiger-holdings.ts";

const CACHE_DIR = path.join(process.cwd(), ".signal-hub");
const SNAPSHOT_FILE = path.join(CACHE_DIR, "tiger-holdings-snapshot.json");
const EQUITY_HISTORY_FILE = path.join(CACHE_DIR, "tiger-equity-history.json");

type PersistedTigerHoldingData = {
  savedAt: string;
  data: TigerHoldingData;
};

export type TigerHoldingDataCache = {
  get: (options?: { force?: boolean }) => Promise<TigerHoldingData>;
  invalidate: () => void;
};

export function getTigerHoldingDataCacheTtlMs(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = Number(env.TIGER_HOLDINGS_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 15000;
}

function equityMinuteBucket(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  date.setSeconds(0, 0);
  return date.toISOString();
}

function isTigerEquityPoint(value: unknown): value is TigerEquityPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<TigerEquityPoint>;
  return (
    typeof point.at === "string" &&
    !Number.isNaN(new Date(point.at).getTime()) &&
    typeof point.netLiquidation === "number" &&
    Number.isFinite(point.netLiquidation) &&
    typeof point.holdingValue === "number" &&
    Number.isFinite(point.holdingValue) &&
    typeof point.cashBalance === "number" &&
    Number.isFinite(point.cashBalance) &&
    typeof point.pnl === "number" &&
    Number.isFinite(point.pnl)
  );
}

function isTigerHoldingData(value: unknown): value is TigerHoldingData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TigerHoldingData>;
  const snapshot = data.snapshot;
  return (
    Boolean(snapshot) &&
    snapshot?.source === "tiger" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.positions) &&
    Array.isArray(data.equityHistory)
  );
}

export function mergeTigerEquityHistory({
  history,
  points,
  maxPoints = 240,
}: {
  history: TigerEquityPoint[];
  points: TigerEquityPoint[];
  maxPoints?: number;
}) {
  const merged = new Map<string, TigerEquityPoint>();
  for (const point of history) {
    if (isTigerEquityPoint(point)) merged.set(equityMinuteBucket(point.at), point);
  }
  for (const point of points) {
    if (isTigerEquityPoint(point)) merged.set(equityMinuteBucket(point.at), point);
  }

  return [...merged.values()]
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .slice(-maxPoints);
}

async function ensureCacheDir() {
  await mkdir(CACHE_DIR, { recursive: true });
}

export async function readPersistedTigerHoldingData(): Promise<TigerHoldingData | null> {
  try {
    const content = await readFile(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(content) as PersistedTigerHoldingData;
    return isTigerHoldingData(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readPersistedTigerEquityHistory(): Promise<TigerEquityPoint[]> {
  try {
    const content = await readFile(EQUITY_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(content) as { history?: unknown };
    return Array.isArray(parsed.history)
      ? parsed.history.filter((point): point is TigerEquityPoint =>
          isTigerEquityPoint(point),
        )
      : [];
  } catch {
    return [];
  }
}

async function writePersistedTigerEquityHistory(points: TigerEquityPoint[]) {
  await ensureCacheDir();
  const current = await readPersistedTigerEquityHistory();
  const history = mergeTigerEquityHistory({ history: current, points });
  await writeFile(
    EQUITY_HISTORY_FILE,
    `${JSON.stringify({ savedAt: new Date().toISOString(), history }, null, 2)}\n`,
    "utf8",
  );
}

export async function writePersistedTigerHoldingData(data: TigerHoldingData) {
  await ensureCacheDir();
  const history = await readPersistedTigerEquityHistory();
  const equityHistory = mergeTigerEquityHistory({
    history,
    points: data.equityHistory,
  });
  const mergedData: TigerHoldingData = {
    ...data,
    equityHistory,
  };
  await writeFile(
    SNAPSHOT_FILE,
    `${JSON.stringify(
      { savedAt: new Date().toISOString(), data: mergedData },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writePersistedTigerEquityHistory(data.equityHistory);
}

export function createTigerHoldingDataCache({
  fetcher,
  ttlMs,
  now = () => Date.now(),
  readData = readPersistedTigerHoldingData,
  writeData = writePersistedTigerHoldingData,
}: {
  fetcher: () => Promise<TigerHoldingData>;
  ttlMs: number;
  now?: () => number;
  readData?: () => Promise<TigerHoldingData | null>;
  writeData?: (data: TigerHoldingData) => Promise<void>;
}): TigerHoldingDataCache {
  let value: TigerHoldingData | null = null;
  let refreshedAt = 0;
  let pending: Promise<TigerHoldingData> | null = null;

  async function refresh() {
    const data = await fetcher();
    value = data;
    refreshedAt = now();
    await writeData(data);
    return data;
  }

  return {
    async get({ force = false }: { force?: boolean } = {}) {
      const expired = !value || now() - refreshedAt > ttlMs;
      if (!force && value && !expired) return value;

      if (!pending) {
        pending = refresh().finally(() => {
          pending = null;
        });
      }

      if (force || !value) {
        const persisted = await readData();
        if (persisted && !force) {
          value = persisted;
          return persisted;
        }
        return await pending;
      }

      void pending.catch(() => {});
      return value;
    },
    invalidate() {
      value = null;
      refreshedAt = 0;
      pending = null;
    },
  };
}

const sharedTigerHoldingDataCache = createTigerHoldingDataCache({
  fetcher: () => getTigerHoldingData(),
  ttlMs: getTigerHoldingDataCacheTtlMs(),
});

export function getCachedTigerHoldingData(options?: {
  force?: boolean;
}): Promise<TigerHoldingData> {
  return sharedTigerHoldingDataCache.get(options);
}

export function invalidateCachedTigerHoldingData() {
  sharedTigerHoldingDataCache.invalidate();
}
