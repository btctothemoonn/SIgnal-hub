import { NextResponse } from "next/server.js";
import {
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  fetchBinanceHynixPremiumSnapshot,
  getBinanceHynixPremiumStartTimeMs,
  type BinanceHynixPremiumSnapshot,
  type BinanceHynixPremiumInterval,
} from "../../../lib/binance-hynix-premium.ts";
import {
  createSnapshotCache,
  type SnapshotCache,
} from "../../../lib/snapshot-cache.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PREMIUM_SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PREMIUM_SNAPSHOT_CACHES = 4;
const premiumSnapshotCaches = new Map<
  string,
  SnapshotCache<BinanceHynixPremiumSnapshot>
>();
const lastHealthyPremiumSnapshots = new Map<
  BinanceHynixPremiumInterval,
  BinanceHynixPremiumSnapshot
>();

function retainHealthyPremiumSnapshot(snapshot: BinanceHynixPremiumSnapshot) {
  if (snapshot.points.length > 1) {
    lastHealthyPremiumSnapshots.set(snapshot.interval, snapshot);
    return snapshot;
  }
  const lastHealthy = lastHealthyPremiumSnapshots.get(snapshot.interval);
  return snapshot.errors.length > 0 && lastHealthy
    ? { ...lastHealthy, errors: snapshot.errors }
    : snapshot;
}

function snapshotCacheKey({
  interval,
  startTime,
  endTime,
  limit,
}: {
  interval: BinanceHynixPremiumInterval;
  startTime: number;
  endTime?: number;
  limit: number;
}) {
  const rollingStartBucket = Math.floor(
    startTime / PREMIUM_SNAPSHOT_CACHE_TTL_MS,
  );
  return `${interval}:${rollingStartBucket}:${endTime ?? "latest"}:${limit}`;
}

function getPremiumSnapshotCache(
  key: string,
  interval: BinanceHynixPremiumInterval,
  fetcher: () => Promise<BinanceHynixPremiumSnapshot>,
) {
  const existing = premiumSnapshotCaches.get(key);
  if (existing) return existing;

  for (const candidateKey of premiumSnapshotCaches.keys()) {
    if (candidateKey.startsWith(`${interval}:`)) {
      premiumSnapshotCaches.delete(candidateKey);
    }
  }

  while (premiumSnapshotCaches.size >= MAX_PREMIUM_SNAPSHOT_CACHES) {
    const oldestKey = premiumSnapshotCaches.keys().next().value;
    if (oldestKey === undefined) break;
    premiumSnapshotCaches.delete(oldestKey);
  }
  const cache = createSnapshotCache(fetcher, PREMIUM_SNAPSHOT_CACHE_TTL_MS);
  premiumSnapshotCaches.set(key, cache);
  return cache;
}

function requestedLimit(url: URL) {
  const parsed = Number(url.searchParams.get("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1500) : 1500;
}

function requestedInterval(url: URL): BinanceHynixPremiumInterval {
  const interval = url.searchParams.get("interval");
  return interval === "1m" ||
    interval === "5m" ||
    interval === "1h" ||
    interval === "1d"
    ? interval
    : "1m";
}

function requestedTimestamp(url: URL, key: string, fallback?: number) {
  const parsed = Number(url.searchParams.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const interval = requestedInterval(url);
  const endTime = requestedTimestamp(url, "endTime");
  const limit = requestedLimit(url);
  const requestedStartTime =
    requestedTimestamp(
      url,
      "startTime",
      BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
    ) ?? BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS;
  const startTime = Math.max(
    requestedStartTime,
    getBinanceHynixPremiumStartTimeMs(interval, endTime ?? Date.now()),
  );
  const cache = getPremiumSnapshotCache(
    snapshotCacheKey({ interval, startTime, endTime, limit }),
    interval,
    async () =>
      retainHealthyPremiumSnapshot(await fetchBinanceHynixPremiumSnapshot({
        interval,
        startTime,
        endTime,
        limit,
      })),
  );
  const snapshot = await cache.get();
  return NextResponse.json(snapshot);
}
