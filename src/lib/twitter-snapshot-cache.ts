import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  TwitterDashboardSnapshot,
  TwitterFeedItem,
  TwitterRealtimeUpdate,
  TwitterWatchAccount,
} from "@/lib/6551-twitter";

const CACHE_VERSION = 1;

export type PersistedTwitterSnapshot = {
  version: typeof CACHE_VERSION;
  fetchedAt: number;
  snapshot: TwitterDashboardSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPersistedTwitterSnapshotFresh(
  value: unknown,
  ttlMs: number,
  nowMs = Date.now(),
): value is PersistedTwitterSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== CACHE_VERSION) {
    return false;
  }

  if (typeof value.fetchedAt !== "number" || !Number.isFinite(value.fetchedAt)) {
    return false;
  }

  if (!isRecord(value.snapshot) || value.snapshot.provider !== "6551") {
    return false;
  }

  return ttlMs > 0 && nowMs - value.fetchedAt <= ttlMs;
}

function sortFeed(feed: TwitterFeedItem[], maxFeedItems: number) {
  return [...feed]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .slice(0, maxFeedItems);
}

function uniqueFeed(items: TwitterFeedItem[]) {
  const map = new Map<string, TwitterFeedItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function isRetriableReplaceError(error: unknown) {
  if (!isRecord(error)) {
    return false;
  }

  return (
    error.code === "EPERM" ||
    error.code === "EACCES" ||
    error.code === "EBUSY"
  );
}

async function replaceSnapshotFile(
  tmpPath: string,
  filePath: string,
  contents: string,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (error) {
      if (!isRetriableReplaceError(error)) {
        throw error;
      }
    }

    try {
      await rm(filePath, { force: true });
      await rename(tmpPath, filePath);
      return;
    } catch (error) {
      if (!isRetriableReplaceError(error)) {
        throw error;
      }
    }

    await delay(50 * (attempt + 1));
  }

  try {
    await writeFile(filePath, contents, "utf8");
  } finally {
    await rm(tmpPath, { force: true });
  }
}

function mergeRealtimeWatchAccount(
  watchAccounts: TwitterWatchAccount[],
  update: TwitterRealtimeUpdate,
) {
  const key = update.account.toLowerCase();
  if (watchAccounts.some((account) => account.username.toLowerCase() === key)) {
    return watchAccounts;
  }

  return [
    {
      id: null,
      username: update.account,
      name: update.displayName || update.account,
      profileUrl: update.profileUrl || update.feedItem.profileUrl,
      avatar: update.feedItem.userAvatar,
      note: "from 6551 realtime event",
    },
    ...watchAccounts,
  ];
}

export function mergeRealtimeUpdateIntoTwitterSnapshot(
  snapshot: TwitterDashboardSnapshot,
  update: TwitterRealtimeUpdate,
  maxFeedItems = 100,
): TwitterDashboardSnapshot {
  return {
    ...snapshot,
    isConfigured: true,
    isConnected: true,
    status: "live",
    errors: [],
    watchAccounts: mergeRealtimeWatchAccount(snapshot.watchAccounts, update),
    feed: sortFeed(uniqueFeed([update.feedItem, ...snapshot.feed]), maxFeedItems),
  };
}

async function readPersistedRecord(
  filePath: string,
): Promise<PersistedTwitterSnapshot | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== CACHE_VERSION) {
      return null;
    }
    if (typeof raw.fetchedAt !== "number" || !isRecord(raw.snapshot)) {
      return null;
    }
    return raw as PersistedTwitterSnapshot;
  } catch {
    return null;
  }
}

export async function readFreshPersistedTwitterSnapshot(
  filePath: string,
  ttlMs: number,
): Promise<TwitterDashboardSnapshot | null> {
  const record = await readPersistedRecord(filePath);
  return isPersistedTwitterSnapshotFresh(record, ttlMs) ? record.snapshot : null;
}

export async function writePersistedTwitterSnapshot(
  filePath: string,
  snapshot: TwitterDashboardSnapshot,
  fetchedAt = Date.now(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  const payload: PersistedTwitterSnapshot = {
    version: CACHE_VERSION,
    fetchedAt,
    snapshot,
  };
  const contents = `${JSON.stringify(payload)}\n`;
  await writeFile(tmpPath, contents, "utf8");
  await replaceSnapshotFile(tmpPath, filePath, contents);
}

export async function deletePersistedTwitterSnapshot(
  filePath: string,
): Promise<void> {
  await rm(filePath, { force: true });
}

export async function mergePersistedRealtimeTwitterUpdate(
  filePath: string,
  update: TwitterRealtimeUpdate,
  maxFeedItems: number,
): Promise<void> {
  const record = await readPersistedRecord(filePath);
  if (!record) {
    return;
  }

  await writePersistedTwitterSnapshot(
    filePath,
    mergeRealtimeUpdateIntoTwitterSnapshot(record.snapshot, update, maxFeedItems),
    Date.now(),
  );
}
