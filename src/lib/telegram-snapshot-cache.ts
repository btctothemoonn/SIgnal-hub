import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  TelegramDashboardSnapshot,
  TelegramFeedItem,
  TelegramRealtimeUpdate,
} from "@/lib/telegram-channels";

const CACHE_VERSION = 1;

export type PersistedTelegramSnapshot = {
  version: typeof CACHE_VERSION;
  fetchedAt: number;
  snapshot: TelegramDashboardSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPersistedTelegramSnapshotFresh(
  value: unknown,
  ttlMs: number,
  nowMs = Date.now(),
): value is PersistedTelegramSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== CACHE_VERSION) {
    return false;
  }

  if (typeof value.fetchedAt !== "number" || !Number.isFinite(value.fetchedAt)) {
    return false;
  }

  if (!isRecord(value.snapshot) || value.snapshot.provider !== "telegram") {
    return false;
  }

  return ttlMs > 0 && nowMs - value.fetchedAt <= ttlMs;
}

function sortFeed(feed: TelegramFeedItem[], maxFeedItems: number) {
  return [...feed]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .slice(0, maxFeedItems);
}

function uniqueFeed(items: TelegramFeedItem[]) {
  const map = new Map<string, TelegramFeedItem>();
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

export function mergeRealtimeUpdateIntoTelegramSnapshot(
  snapshot: TelegramDashboardSnapshot,
  update: TelegramRealtimeUpdate,
  maxFeedItems = 100,
): TelegramDashboardSnapshot {
  return {
    ...snapshot,
    isConfigured: true,
    isConnected: true,
    status: "live",
    errors: [],
    feed: sortFeed(uniqueFeed([update.feedItem, ...snapshot.feed]), maxFeedItems),
  };
}

export function compactTelegramSnapshot(
  snapshot: TelegramDashboardSnapshot,
): TelegramDashboardSnapshot {
  const avatarByChannel = new Map<string, string>();
  for (const channel of snapshot.channels) {
    if (!channel.avatar) {
      continue;
    }
    if (channel.channelId) {
      avatarByChannel.set(`id:${channel.channelId}`, channel.avatar);
    }
    if (channel.username) {
      avatarByChannel.set(`username:${channel.username.toLowerCase()}`, channel.avatar);
    }
    avatarByChannel.set(`ref:${channel.ref.toLowerCase()}`, channel.avatar);
  }

  return {
    ...snapshot,
    feed: snapshot.feed.map((item) => {
      const expectedAvatar =
        (item.channelId && avatarByChannel.get(`id:${item.channelId}`)) ||
        (item.channelUsername &&
          avatarByChannel.get(`username:${item.channelUsername.toLowerCase()}`)) ||
        avatarByChannel.get(`ref:${item.channelRef.toLowerCase()}`);

      if (!expectedAvatar || item.channelAvatar !== expectedAvatar) {
        return item;
      }

      return {
        ...item,
        channelAvatar: null,
      };
    }),
  };
}

function parsePersistedRecord(value: unknown): PersistedTelegramSnapshot | null {
  if (!isRecord(value) || value.version !== CACHE_VERSION) {
    return null;
  }
  if (typeof value.fetchedAt !== "number" || !isRecord(value.snapshot)) {
    return null;
  }
  return value as PersistedTelegramSnapshot;
}

async function readPersistedRecordFile(
  filePath: string,
): Promise<PersistedTelegramSnapshot | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return parsePersistedRecord(raw);
  } catch {
    return null;
  }
}

async function readLatestTemporaryPersistedRecord(
  filePath: string,
): Promise<PersistedTelegramSnapshot | null> {
  let entries: string[];
  try {
    entries = await readdir(dirname(filePath));
  } catch {
    return null;
  }

  const prefix = `${basename(filePath)}.`;
  const candidates = entries.filter(
    (entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"),
  );
  let latest: PersistedTelegramSnapshot | null = null;

  for (const candidate of candidates) {
    const record = await readPersistedRecordFile(join(dirname(filePath), candidate));
    if (!record) {
      continue;
    }
    if (!latest || record.fetchedAt > latest.fetchedAt) {
      latest = record;
    }
  }

  return latest;
}

async function readPersistedRecord(
  filePath: string,
): Promise<PersistedTelegramSnapshot | null> {
  return (
    (await readPersistedRecordFile(filePath)) ||
    (await readLatestTemporaryPersistedRecord(filePath))
  );
}

export function readPersistedTelegramSnapshotRecord(
  filePath: string,
): Promise<PersistedTelegramSnapshot | null> {
  return readPersistedRecord(filePath);
}

export async function readFreshPersistedTelegramSnapshot(
  filePath: string,
  ttlMs: number,
): Promise<TelegramDashboardSnapshot | null> {
  const record = await readPersistedRecord(filePath);
  return isPersistedTelegramSnapshotFresh(record, ttlMs) ? record.snapshot : null;
}

export async function readPersistedTelegramSnapshot(
  filePath: string,
): Promise<TelegramDashboardSnapshot | null> {
  const record = await readPersistedRecord(filePath);
  return record?.snapshot ?? null;
}

export async function writePersistedTelegramSnapshot(
  filePath: string,
  snapshot: TelegramDashboardSnapshot,
  fetchedAt = Date.now(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  const payload: PersistedTelegramSnapshot = {
    version: CACHE_VERSION,
    fetchedAt,
    snapshot: compactTelegramSnapshot(snapshot),
  };
  const contents = `${JSON.stringify(payload)}\n`;
  await writeFile(tmpPath, contents, "utf8");
  await replaceSnapshotFile(tmpPath, filePath, contents);
}

export async function deletePersistedTelegramSnapshot(
  filePath: string,
): Promise<void> {
  await rm(filePath, { force: true });
}

export async function mergePersistedRealtimeTelegramUpdate(
  filePath: string,
  update: TelegramRealtimeUpdate,
  maxFeedItems: number,
): Promise<void> {
  const record = await readPersistedRecord(filePath);
  if (!record) {
    return;
  }

  await writePersistedTelegramSnapshot(
    filePath,
    mergeRealtimeUpdateIntoTelegramSnapshot(record.snapshot, update, maxFeedItems),
    Date.now(),
  );
}
