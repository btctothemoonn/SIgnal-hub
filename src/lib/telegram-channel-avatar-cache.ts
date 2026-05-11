import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CACHE_VERSION = 1;

export type TelegramChannelAvatarCacheEntry = {
  avatar: string | null;
  updatedAt: number;
};

export type TelegramChannelAvatarCache = Record<
  string,
  TelegramChannelAvatarCacheEntry
>;

type PersistedTelegramChannelAvatarCache = {
  version: typeof CACHE_VERSION;
  channels: TelegramChannelAvatarCache;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCacheEntry(value: unknown): value is TelegramChannelAvatarCacheEntry {
  return (
    isRecord(value) &&
    (typeof value.avatar === "string" || value.avatar === null) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

export function getFreshTelegramChannelAvatar(
  cache: TelegramChannelAvatarCache,
  key: string,
  ttlMs: number,
  nowMs = Date.now(),
): string | null | undefined {
  const entry = cache[key];
  if (!entry || nowMs - entry.updatedAt > ttlMs) {
    return undefined;
  }

  return entry.avatar;
}

export function setTelegramChannelAvatarCacheEntry(
  cache: TelegramChannelAvatarCache,
  key: string,
  avatar: string | null,
  updatedAt = Date.now(),
): TelegramChannelAvatarCache {
  return {
    ...cache,
    [key]: {
      avatar,
      updatedAt,
    },
  };
}

export async function readTelegramChannelAvatarCache(
  filePath: string,
): Promise<TelegramChannelAvatarCache> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION) {
      return {};
    }
    if (!isRecord(parsed.channels)) {
      return {};
    }

    const channels: TelegramChannelAvatarCache = {};
    for (const [key, value] of Object.entries(parsed.channels)) {
      if (isCacheEntry(value)) {
        channels[key] = value;
      }
    }
    return channels;
  } catch {
    return {};
  }
}

export async function writeTelegramChannelAvatarCache(
  filePath: string,
  cache: TelegramChannelAvatarCache,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const payload: PersistedTelegramChannelAvatarCache = {
    version: CACHE_VERSION,
    channels: cache,
  };
  await writeFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}
