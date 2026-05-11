import { join } from "node:path";
import { translateText, type TranslationNote } from "@/lib/translate";
import {
  getCachedRuntimeConfig,
  loadRuntimeConfig,
} from "@/lib/runtime-config";
import { createSnapshotCache } from "@/lib/snapshot-cache";
import { selectTelegramFeed } from "@/lib/telegram-feed-selection";
import { shouldSkipTelegramChannelTranslation } from "@/lib/telegram-translation-policy";
import { shouldDisplayTelegramWebPagePreview } from "@/lib/telegram-webpage-preview";
import { makeTelegramClientOptions } from "@/lib/telegram-client-options";
import {
  parseTelegramMediaPreviewLimit,
  shouldDownloadTelegramChannelAvatars,
  shouldDownloadTelegramMediaPreview,
} from "@/lib/telegram-media-preview-policy";
import {
  getFreshTelegramChannelAvatar,
  readTelegramChannelAvatarCache,
  setTelegramChannelAvatarCacheEntry,
  writeTelegramChannelAvatarCache,
  type TelegramChannelAvatarCache,
} from "@/lib/telegram-channel-avatar-cache";
import {
  parseTelegramEntityResolveConcurrency,
  parseTelegramEntityResolveTimeoutMs,
} from "@/lib/telegram-entity-resolve-policy";
import { parseTelegramIdleResetMs } from "@/lib/telegram-idle-reset-policy";
import { chooseTelegramRefreshResult } from "@/lib/telegram-refresh-fallback";
import { shouldResetTelegramClientAfterSnapshot } from "@/lib/telegram-refresh-health";
import { createTelegramRefreshCoordinator } from "@/lib/telegram-refresh-coordinator";
import { withTelegramRefreshMeta } from "@/lib/telegram-refresh-meta";
import {
  compactTelegramSnapshot,
  deletePersistedTelegramSnapshot,
  mergePersistedRealtimeTelegramUpdate,
  readPersistedTelegramSnapshot,
  readPersistedTelegramSnapshotRecord,
  writePersistedTelegramSnapshot,
} from "@/lib/telegram-snapshot-cache";
import {
  applyResolvedTelegramChannelRefresh,
  type ResolvedTelegramChannelCache,
} from "./telegram-resolved-channel-cache";

const DEFAULT_MESSAGES_PER_CHANNEL = 30;
const DEFAULT_FEED_ITEMS = 100;
const RESOLVED_CHANNEL_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_INITIAL_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MEMORY_CACHE_TTL_MS = 5 * 1000;
const DEFAULT_BACKGROUND_REFRESH_MIN_MS = 120 * 1000;
const DEFAULT_CHANNEL_AVATAR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SEEN_REALTIME_IDS = 200;
const MAX_INLINE_MEDIA_BYTES = 900 * 1024;

async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超时 (${ms}ms)`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

type JsonRecord = Record<string, unknown>;
type TelegramEventMessage = JsonRecord & {
  getChat?: () => Promise<unknown>;
};
type TelegramNewMessageEvent = {
  message: TelegramEventMessage;
};
type TelegramMessageCandidate = {
  fallback: TelegramFeedItem;
  message: unknown;
  channel: ResolvedTelegramChannel;
};
type TelegramClientInstance = {
  connect(): Promise<void>;
  checkAuthorization(): Promise<boolean>;
  getMe(): Promise<unknown>;
  disconnect(): Promise<void>;
  getEntity(entity: string | number): Promise<unknown>;
  getMessages(
    entity: unknown,
    options: {
      limit: number;
    },
  ): Promise<Iterable<unknown>>;
  downloadMedia(
    messageOrMedia: unknown,
    downloadParams?: {
      outputFile?: unknown;
      thumb?: number;
    },
  ): Promise<Buffer | string | undefined>;
  downloadProfilePhoto(
    entity: unknown,
    downloadParams?: { isBig?: boolean },
  ): Promise<Buffer | string | undefined>;
  addEventHandler(
    handler: (event: TelegramNewMessageEvent) => void | Promise<void>,
    eventBuilder: unknown,
  ): void;
};
type TelegramModules = {
  TelegramClient: new (
    session: unknown,
    apiId: number,
    apiHash: string,
    options: {
      connectionRetries: number;
      reconnectRetries?: number;
      retryDelay?: number;
      autoReconnect?: boolean;
      maxConcurrentDownloads?: number;
    },
  ) => TelegramClientInstance;
  NewMessage: new (options?: unknown) => unknown;
  StringSession: new (session?: string) => unknown;
};

type TelegramRealtimeEnvelope =
  | {
      type: "status";
      payload: TelegramRealtimeStatus;
    }
  | {
      type: "message";
      payload: TelegramRealtimeUpdate;
    };

type ConfiguredChannelTarget = {
  lookup: string | number;
  ref: string;
};

type ResolvedTelegramChannel = {
  entity: unknown;
  lookup: string | number;
  ref: string;
  title: string;
  username: string;
  channelId: string;
  link: string;
  avatar: string | null;
};

export type TelegramChannelWatch = {
  ref: string;
  title: string;
  username: string;
  channelId: string;
  link: string;
  access: "mtproto";
  note: string;
  avatar: string | null;
};

export type TelegramMediaPreview = {
  kind: "image" | "sticker" | "video" | "gif";
  mimeType: string;
  previewUrl: string;
  label: string;
  width: number | null;
  height: number | null;
};

export type TelegramQuotedMessage = {
  id: string;
  text: string;
  createdAt: string;
  channelTitle: string;
  channelUsername: string;
  messageUrl: string;
  media: TelegramMediaPreview | null;
};

export type TelegramFeedItem = {
  id: string;
  channelRef: string;
  channelTitle: string;
  channelUsername: string;
  channelId: string;
  channelLink: string;
  channelAvatar: string | null;
  messageUrl: string;
  text: string;
  createdAt: string;
  views: number;
  forwards: number;
  origin: "history" | "realtime";
  media: TelegramMediaPreview | null;
  translation: TranslationNote | null;
  quotedMessage: TelegramQuotedMessage | null;
};

export type TelegramRefreshMeta = {
  source: "initial" | "cache" | "refresh";
  servedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  cacheFetchedAt: string | null;
};

export type TelegramDashboardSnapshot = {
  provider: "telegram";
  mode: "mtproto";
  isConfigured: boolean;
  isConnected: boolean;
  status: "needs_config" | "limited" | "live" | "error";
  channels: TelegramChannelWatch[];
  feed: TelegramFeedItem[];
  note: string;
  errors: string[];
  refresh?: TelegramRefreshMeta;
};

export function getInitialTelegramDashboardSnapshot(): TelegramDashboardSnapshot {
  const setupErrors = getSetupErrors();

  if (setupErrors.length > 0) {
    return compactTelegramSnapshot({
      provider: "telegram",
      mode: "mtproto",
      isConfigured: false,
      isConnected: false,
      status: "needs_config",
      channels: [],
      feed: [],
      note: "Telegram channel 更适合用 MTProto 用户会话监控。Bot API 适合接收 bot 能看到的新消息，但不擅长稳定回补频道历史。",
      errors: setupErrors,
    });
  }

  return {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: false,
    status: "limited",
    channels: [],
    feed: [],
    note: "Telegram 历史消息会在页面加载后异步补齐，避免首屏被 MTProto 拉取阻塞。",
    errors: [],
  };
}

export type TelegramRealtimeStatus = {
  state:
    | "needs_config"
    | "connecting"
    | "connected"
    | "subscribed"
    | "closed"
    | "error";
  message: string;
  at: string;
};

export type TelegramRealtimeUpdate = {
  channel: string;
  channelTitle: string;
  createdAt: string;
  feedItem: TelegramFeedItem;
};

const realtimeListeners = new Set<
  (event: TelegramRealtimeEnvelope) => void | Promise<void>
>();

let telegramClientPromise: Promise<TelegramClientInstance | null> | null = null;
let telegramRealtimeStartPromise: Promise<TelegramRealtimeStatus> | null = null;
let telegramRealtimeAttached = false;
let telegramIdleResetTimer: ReturnType<typeof setTimeout> | null = null;

const TELEGRAM_CB_COOLDOWN_MS = 60_000;
let telegramConnectBlockedUntil = 0;
let telegramLastConnectError: string | null = null;
let telegramModulesPromise: Promise<TelegramModules> | null = null;
let resolvedChannelCache: ResolvedTelegramChannelCache<ResolvedTelegramChannel> | null =
  null;
let currentResolvedChannels: ResolvedTelegramChannel[] = [];
const telegramRefreshCoordinator =
  createTelegramRefreshCoordinator<TelegramDashboardSnapshot>({
    minIntervalMs: getTelegramBackgroundRefreshMinMs(),
  });
const seenRealtimeIds = new Set<string>();
const seenRealtimeQueue: string[] = [];
const MAX_MEDIA_PREVIEW_CACHE = 200;
const mediaPreviewCache = new Map<string, TelegramMediaPreview | null>();

function mediaPreviewCacheSet(key: string, value: TelegramMediaPreview | null) {
  if (mediaPreviewCache.size >= MAX_MEDIA_PREVIEW_CACHE) {
    const firstKey = mediaPreviewCache.keys().next().value;
    if (firstKey !== undefined) {
      mediaPreviewCache.delete(firstKey);
    }
  }
  mediaPreviewCache.set(key, value);
}
let lastRealtimeStatus: TelegramRealtimeStatus = {
  state: "needs_config",
  message: "还未配置 Telegram 频道监控。",
  at: new Date().toISOString(),
};

function makeStatus(
  state: TelegramRealtimeStatus["state"],
  message: string,
): TelegramRealtimeStatus {
  return {
    state,
    message,
    at: new Date().toISOString(),
  };
}

function broadcast(event: TelegramRealtimeEnvelope) {
  for (const listener of realtimeListeners) {
    try {
      void listener(event);
    } catch {
      continue;
    }
  }
}

function pushStatus(
  state: TelegramRealtimeStatus["state"],
  message: string,
): TelegramRealtimeStatus {
  const status = makeStatus(state, message);
  lastRealtimeStatus = status;
  broadcast({
    type: "status",
    payload: status,
  });
  return status;
}

async function loadTelegramModules(): Promise<TelegramModules> {
  if (!telegramModulesPromise) {
    telegramModulesPromise = (async () => {
      const telegramModule = await import("telegram");
      const eventsModule = await import("telegram/events");
      const sessionsModule = await import("telegram/sessions");

      return {
        TelegramClient:
          telegramModule.TelegramClient as unknown as TelegramModules["TelegramClient"],
        NewMessage:
          eventsModule.NewMessage as unknown as TelegramModules["NewMessage"],
        StringSession:
          sessionsModule.StringSession as unknown as TelegramModules["StringSession"],
      };
    })();
  }

  const modules = telegramModulesPromise;
  if (!modules) {
    throw new Error("Telegram modules failed to initialize.");
  }

  return modules;
}

function getTelegramApiId(): number {
  const raw = process.env.TELEGRAM_API_ID?.trim();
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function getTelegramApiHash(): string {
  return process.env.TELEGRAM_API_HASH?.trim() || "";
}

function getTelegramSession(): string {
  return process.env.TELEGRAM_SESSION?.trim() || "";
}

function parseList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeChannelTarget(raw: string): ConfiguredChannelTarget | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const normalizedUrl = value
    .replace(/^https?:\/\/telegram\.me\//i, "https://t.me/")
    .replace(/^t\.me\//i, "https://t.me/");

  if (/^-?\d+$/.test(value)) {
    return {
      lookup: Number(value),
      ref: value,
    };
  }

  if (/^https?:\/\/t\.me\//i.test(normalizedUrl)) {
    const path = normalizedUrl
      .replace(/^https?:\/\/t\.me\//i, "")
      .split(/[?#]/, 1)[0];
    const [first = "", second = ""] = path.split("/").filter(Boolean);

    if (first === "s" && second) {
      return {
        lookup: second.replace(/^@+/, ""),
        ref: second.replace(/^@+/, ""),
      };
    }

    if (first.startsWith("+")) {
      return {
        lookup: normalizedUrl,
        ref: first,
      };
    }

    if (first) {
      const sanitized = first.replace(/^@+/, "");
      return {
        lookup: sanitized,
        ref: sanitized,
      };
    }
  }

  const sanitized = value.replace(/^@+/, "");
  return sanitized
    ? {
        lookup: sanitized,
        ref: sanitized,
      }
    : null;
}

function getConfiguredChannelTargets(): ConfiguredChannelTarget[] {
  const deduped = new Map<string, ConfiguredChannelTarget>();

  const runtime = getCachedRuntimeConfig();
  const merged = [
    ...parseList(process.env.TELEGRAM_CHANNELS),
    ...runtime.telegramChannels.map((item) => item.ref),
  ];

  for (const item of merged) {
    const target = normalizeChannelTarget(item);
    if (!target) {
      continue;
    }

    deduped.set(target.ref.toLowerCase(), target);
  }

  return Array.from(deduped.values());
}

function getMessagesPerChannel(): number {
  const parsed = Number(process.env.TELEGRAM_MESSAGES_PER_CHANNEL?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MESSAGES_PER_CHANNEL;
}

function getPriorityMessagesPerChannel(): number {
  const parsed = Number(process.env.TELEGRAM_PRIORITY_MESSAGES_PER_CHANNEL?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : Math.max(100, getMessagesPerChannel());
}

function getTelegramFeedBuildConcurrency(): number {
  const parsed = Number(process.env.TELEGRAM_FEED_BUILD_CONCURRENCY?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function getTelegramMediaPreviewLimit(): number {
  return parseTelegramMediaPreviewLimit(process.env.TELEGRAM_MEDIA_PREVIEW_ITEMS);
}

function getFeedItemLimit(): number {
  const parsed = Number(process.env.TELEGRAM_FEED_ITEMS?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_FEED_ITEMS;
}

function getPriorityTelegramMatchers(): string[] {
  const configured = parseList(process.env.TELEGRAM_PRIORITY_CHANNELS);
  return configured.length > 0 ? configured : ["6551"];
}

function isPriorityTelegramChannel(channel: ResolvedTelegramChannel): boolean {
  const haystack = [
    channel.ref,
    channel.title,
    channel.username,
    channel.channelId,
  ]
    .join("\n")
    .toLowerCase();

  return getPriorityTelegramMatchers().some((matcher) => {
    const needle = matcher.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

function getMessagesLimitForChannel(channel: ResolvedTelegramChannel): number {
  return isPriorityTelegramChannel(channel)
    ? getPriorityMessagesPerChannel()
    : getMessagesPerChannel();
}

function getPositiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getTelegramBackgroundRefreshMinMs(): number {
  return getPositiveEnvNumber(
    "TELEGRAM_BACKGROUND_REFRESH_MIN_MS",
    DEFAULT_BACKGROUND_REFRESH_MIN_MS,
  );
}

function getTelegramChannelAvatarCacheFilePath(): string {
  return (
    process.env.TELEGRAM_CHANNEL_AVATAR_CACHE_FILE?.trim() ||
    join(process.cwd(), ".signal-hub", "telegram-channel-avatar-cache.json")
  );
}

function getTelegramChannelAvatarCacheTtlMs(): number {
  return getPositiveEnvNumber(
    "TELEGRAM_CHANNEL_AVATAR_CACHE_TTL_MS",
    DEFAULT_CHANNEL_AVATAR_CACHE_TTL_MS,
  );
}

function getTelegramIdleResetMs(): number {
  return parseTelegramIdleResetMs(process.env.TELEGRAM_IDLE_RESET_MS);
}

function getTelegramEntityResolveTimeoutMs(): number {
  return parseTelegramEntityResolveTimeoutMs(
    process.env.TELEGRAM_ENTITY_RESOLVE_TIMEOUT_MS,
  );
}

function getTelegramEntityResolveConcurrency(): number {
  return parseTelegramEntityResolveConcurrency(
    process.env.TELEGRAM_ENTITY_RESOLVE_CONCURRENCY,
  );
}

function getTelegramSnapshotCacheFilePath(): string {
  return (
    process.env.TELEGRAM_SNAPSHOT_CACHE_FILE?.trim() ||
    join(process.cwd(), ".signal-hub", "telegram-snapshot-cache.json")
  );
}

function getTelegramSnapshotCacheTtlMs(): number {
  return getPositiveEnvNumber(
    "TELEGRAM_SNAPSHOT_CACHE_TTL_MS",
    DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  );
}

function getTelegramInitialSnapshotMaxAgeMs(): number {
  return getPositiveEnvNumber(
    "TELEGRAM_INITIAL_SNAPSHOT_MAX_AGE_MS",
    DEFAULT_INITIAL_SNAPSHOT_MAX_AGE_MS,
  );
}

function getTelegramSnapshotMemoryTtlMs(): number {
  return getPositiveEnvNumber(
    "TELEGRAM_SNAPSHOT_MEMORY_TTL_MS",
    DEFAULT_MEMORY_CACHE_TTL_MS,
  );
}

function isTranslationEnabled(): boolean {
  const raw = process.env.TELEGRAM_TRANSLATE_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return !["0", "false", "no", "off"].includes(raw);
}

function getTranslationTargetLanguage(): string {
  return process.env.TELEGRAM_TRANSLATE_TARGET?.trim() || "zh-CN";
}

function getSetupErrors(): string[] {
  const errors: string[] = [];

  if (!getTelegramApiId()) {
    errors.push("缺少 TELEGRAM_API_ID。");
  }

  if (!getTelegramApiHash()) {
    errors.push("缺少 TELEGRAM_API_HASH。");
  }

  if (!getTelegramSession()) {
    errors.push("缺少 TELEGRAM_SESSION。");
  }

  if (getConfiguredChannelTargets().length === 0) {
    errors.push("缺少 TELEGRAM_CHANNELS，至少配置一个要监控的频道。");
  }

  return errors;
}

function isConfiguredForChannelMonitoring(): boolean {
  return getSetupErrors().length === 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return 0;
}

function toId(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (
    isRecord(value) &&
    typeof value.toString === "function" &&
    value.toString !== Object.prototype.toString
  ) {
    const text = String(value);
    if (text && text !== "[object Object]") {
      return text;
    }
  }

  return "";
}

function normalizeChannelId(value: unknown): string {
  const raw = toId(value);
  if (!raw) {
    return "";
  }

  return raw.replace(/^-100/, "").replace(/^-/, "");
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

function detectBufferMime(buffer: Buffer): string {
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return "image/gif";
  }

  return "application/octet-stream";
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function getMediaRecord(message: JsonRecord): JsonRecord | null {
  return isRecord(message.media) ? message.media : null;
}

function getWebPageRecord(message: JsonRecord): JsonRecord | null {
  const media = getMediaRecord(message);
  if (!media || !isRecord(media.webpage)) {
    return null;
  }

  return media.webpage;
}

function getWebPageUrl(message: JsonRecord): string {
  const webpage = getWebPageRecord(message);
  return webpage ? pickString(webpage.url, webpage.displayUrl) : "";
}

function getWebPagePhotoRecord(message: JsonRecord): JsonRecord | null {
  const webpage = getWebPageRecord(message);
  if (!webpage || !isRecord(webpage.photo)) {
    return null;
  }

  return webpage.photo;
}

function getDocumentRecord(message: JsonRecord): JsonRecord | null {
  const media = getMediaRecord(message);
  if (!media || !isRecord(media.document)) {
    return null;
  }

  return media.document;
}

function getMediaClassName(message: JsonRecord): string {
  const media = getMediaRecord(message);
  return media ? pickString(media.className) : "";
}

function getDocumentMimeType(message: JsonRecord): string {
  const document = getDocumentRecord(message);
  return document ? pickString(document.mimeType) : "";
}

type MediaDimensions = {
  width: number;
  height: number;
};

function toPositiveNumber(value: unknown): number {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : 0;
}

function toMediaDimensions(value: unknown): MediaDimensions | null {
  if (!isRecord(value)) {
    return null;
  }

  const width = toPositiveNumber(value.w ?? value.width);
  const height = toPositiveNumber(value.h ?? value.height);

  if (!width || !height) {
    return null;
  }

  return {
    width,
    height,
  };
}

function pickLargestDimensions(values: unknown[]): MediaDimensions | null {
  let largest: MediaDimensions | null = null;

  for (const value of values) {
    const dimensions = toMediaDimensions(value);
    if (!dimensions) {
      continue;
    }

    if (
      !largest ||
      dimensions.width * dimensions.height > largest.width * largest.height
    ) {
      largest = dimensions;
    }
  }

  return largest;
}

function getPhotoDimensions(message: JsonRecord): MediaDimensions | null {
  const media = getMediaRecord(message);
  const photo = media && isRecord(media.photo) ? media.photo : null;
  const sizes = photo && Array.isArray(photo.sizes) ? photo.sizes : [];

  return pickLargestDimensions(sizes);
}

function getDocumentDimensions(message: JsonRecord): MediaDimensions | null {
  const document = getDocumentRecord(message);
  if (!document) {
    return null;
  }

  const attributes = Array.isArray(document.attributes) ? document.attributes : [];
  const thumbs = Array.isArray(document.thumbs) ? document.thumbs : [];

  return pickLargestDimensions([...attributes, ...thumbs]);
}

function getInlineMediaDimensions(message: JsonRecord): MediaDimensions | null {
  if (getMediaClassName(message) === "MessageMediaPhoto") {
    return getPhotoDimensions(message);
  }

  const webpagePhoto = getWebPagePhotoRecord(message);
  if (webpagePhoto) {
    const sizes = Array.isArray(webpagePhoto.sizes) ? webpagePhoto.sizes : [];
    return pickLargestDimensions(sizes);
  }

  return getDocumentDimensions(message);
}

function getDefaultMediaLabel(message: JsonRecord): string {
  const mediaClass = getMediaClassName(message);
  const mimeType = getDocumentMimeType(message);

  if (mediaClass === "MessageMediaPhoto") {
    return "图片消息";
  }

  if (mimeType === "image/webp") {
    return "贴纸消息";
  }

  if (mimeType === "application/x-tgsticker") {
    return "动画贴纸";
  }

  if (mimeType.startsWith("image/")) {
    return "图片消息";
  }

  if (mimeType.startsWith("video/")) {
    return "视频消息";
  }

  if (mimeType === "image/gif") {
    return "GIF 消息";
  }

  if (mediaClass === "MessageMediaWebPage") {
    return "链接消息";
  }

  if (message.media) {
    return "媒体消息";
  }

  return "无文字内容";
}

async function downloadMediaPreviewTarget(
  client: TelegramClientInstance,
  target: unknown,
): Promise<Buffer | string | undefined> {
  try {
    const thumb = await client.downloadMedia(target, {
      outputFile: undefined,
      thumb: 0,
    });

    if (
      Buffer.isBuffer(thumb) &&
      thumb.length > 0 &&
      thumb.length <= MAX_INLINE_MEDIA_BYTES
    ) {
      return thumb;
    }
  } catch {
    // fall through to a direct download for small media without thumbnails
  }

  try {
    const full = await client.downloadMedia(target, {
      outputFile: undefined,
    });

    if (
      Buffer.isBuffer(full) &&
      full.length > 0 &&
      full.length <= MAX_INLINE_MEDIA_BYTES
    ) {
      return full;
    }
  } catch {
    // ignore media preview failures
  }

  return undefined;
}

async function downloadPhotoPreview(
  client: TelegramClientInstance,
  message: JsonRecord,
): Promise<Buffer | string | undefined> {
  return downloadMediaPreviewTarget(client, message);
}

async function downloadWebPagePhotoPreview(
  client: TelegramClientInstance,
  message: JsonRecord,
): Promise<Buffer | string | undefined> {
  const webpagePhoto = getWebPagePhotoRecord(message);
  if (webpagePhoto) {
    const downloaded = await downloadMediaPreviewTarget(client, webpagePhoto);
    if (downloaded) {
      return downloaded;
    }
  }

  return downloadMediaPreviewTarget(client, message);
}

async function downloadInlineMedia(
  client: TelegramClientInstance,
  cacheKey: string,
  message: JsonRecord,
): Promise<TelegramMediaPreview | null> {
  if (mediaPreviewCache.has(cacheKey)) {
    return mediaPreviewCache.get(cacheKey) ?? null;
  }

  const mediaClass = getMediaClassName(message);
  const mimeType = getDocumentMimeType(message);
  const dimensions = getInlineMediaDimensions(message);
  let downloaded: Buffer | string | undefined;
  let kind: TelegramMediaPreview["kind"] | null = null;
  let label = getDefaultMediaLabel(message);
  let mimeHint = mimeType;

  try {
    if (mediaClass === "MessageMediaPhoto") {
      downloaded = await downloadPhotoPreview(client, message);
      kind = "image";
      label = "图片预览";
      mimeHint = "image/jpeg";
    } else if (
      mediaClass === "MessageMediaWebPage" &&
      getWebPagePhotoRecord(message) &&
      shouldDisplayTelegramWebPagePreview({
        url: getWebPageUrl(message),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      })
    ) {
      downloaded = await downloadWebPagePhotoPreview(client, message);
      kind = "image";
      label = "閾炬帴棰勮";
      mimeHint = "image/jpeg";
      label = "链接预览";
    } else if (mimeType === "image/webp") {
      downloaded = await downloadMediaPreviewTarget(client, message);
      kind = "sticker";
      label = "贴纸预览";
    } else if (mimeType.startsWith("image/")) {
      downloaded = await downloadMediaPreviewTarget(client, message);
      kind = "image";
      label = "图片预览";
    } else if (mimeType === "application/x-tgsticker") {
      downloaded = await client.downloadMedia(message, {
        outputFile: undefined,
        thumb: 0,
      });
      kind = "sticker";
      label = "动画贴纸预览";
      mimeHint = "";
    } else if (mimeType.startsWith("video/")) {
      downloaded = await client.downloadMedia(message, {
        outputFile: undefined,
        thumb: 0,
      });
      kind = "video";
      label = "视频预览";
      mimeHint = "";
    } else if (mimeType === "image/gif") {
      downloaded = await downloadMediaPreviewTarget(client, message);
      kind = "gif";
      label = "GIF 预览";
    }
  } catch {
    downloaded = undefined;
  }

  if (!kind || !Buffer.isBuffer(downloaded) || downloaded.length === 0) {
    mediaPreviewCacheSet(cacheKey, null);
    return null;
  }

  if (downloaded.length > MAX_INLINE_MEDIA_BYTES) {
    mediaPreviewCacheSet(cacheKey, null);
    return null;
  }

  const resolvedMimeType =
    mimeHint && mimeHint !== "application/x-tgsticker"
      ? mimeHint
      : detectBufferMime(downloaded);

  if (!resolvedMimeType.startsWith("image/")) {
    mediaPreviewCacheSet(cacheKey, null);
    return null;
  }

  const preview: TelegramMediaPreview = {
    kind,
    mimeType: resolvedMimeType,
    previewUrl: toDataUrl(downloaded, resolvedMimeType),
    label,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };

  mediaPreviewCacheSet(cacheKey, preview);
  return preview;
}

const MAX_CHANNEL_AVATAR_CACHE = 500;
const channelAvatarCache = new Map<string, string | null>();

function channelAvatarCacheSet(key: string, value: string | null) {
  if (channelAvatarCache.has(key)) {
    channelAvatarCache.delete(key);
  } else if (channelAvatarCache.size >= MAX_CHANNEL_AVATAR_CACHE) {
    const firstKey = channelAvatarCache.keys().next().value;
    if (firstKey !== undefined) {
      channelAvatarCache.delete(firstKey);
    }
  }
  channelAvatarCache.set(key, value);
}

async function downloadChannelAvatar(
  client: TelegramClientInstance,
  entity: unknown,
  cacheKey: string,
): Promise<string | null> {
  if (channelAvatarCache.has(cacheKey)) {
    return channelAvatarCache.get(cacheKey) ?? null;
  }

  try {
    const buffer = (await client.downloadProfilePhoto(entity as never)) as
      | Buffer
      | string
      | undefined;

    if (Buffer.isBuffer(buffer) && buffer.length > 0) {
      const dataUrl = toDataUrl(buffer, "image/jpeg");
      channelAvatarCacheSet(cacheKey, dataUrl);
      return dataUrl;
    }
  } catch {
    // ignore — channels without a photo, or download errors
  }

  channelAvatarCacheSet(cacheKey, null);
  return null;
}

function buildTelegramChannelLink(username: string, channelId: string): string {
  if (username) {
    return `https://t.me/${username}`;
  }

  if (channelId) {
    return `https://t.me/c/${channelId}`;
  }

  return "https://telegram.org/";
}

function buildTelegramMessageLink(
  username: string,
  channelId: string,
  messageId: number,
): string {
  if (username) {
    return `https://t.me/${username}/${messageId}`;
  }

  if (channelId) {
    return `https://t.me/c/${channelId}/${messageId}`;
  }

  return "https://telegram.org/";
}

function normalizeResolvedChannel(
  entity: unknown,
  target: ConfiguredChannelTarget,
): ResolvedTelegramChannel | null {
  if (!isRecord(entity)) {
    return null;
  }

  const username = pickString(entity.username).replace(/^@+/, "");
  const channelId = normalizeChannelId(entity.id);
  const title = pickString(entity.title, entity.firstName, entity.lastName, target.ref);

  return {
    entity,
    lookup: target.lookup,
    ref: target.ref,
    title,
    username,
    channelId,
    link: buildTelegramChannelLink(username, channelId),
    avatar: null,
  };
}

function toWatchChannel(channel: ResolvedTelegramChannel): TelegramChannelWatch {
  return {
    ref: channel.ref,
    title: channel.title,
    username: channel.username,
    channelId: channel.channelId,
    link: channel.link,
    access: "mtproto",
    note: channel.username
      ? "使用 MTProto 用户会话读取频道历史和实时更新。"
      : "已通过 MTProto 解析到私有频道，仅当前会话可访问。",
    avatar: channel.avatar,
  };
}

function normalizeMessageText(message: JsonRecord): string {
  const text = pickString(message.message);
  if (text) {
    return text;
  }

  if (message.media) {
    return "媒体消息";
  }

  return "无文字内容";
}

function normalizeFeedItem(
  message: unknown,
  channel: ResolvedTelegramChannel,
  origin: TelegramFeedItem["origin"],
): TelegramFeedItem | null {
  if (!isRecord(message)) {
    return null;
  }

  const messageId = toNumber(message.id);
  if (!messageId) {
    return null;
  }

  return {
    id: `${channel.channelId || channel.ref}:${messageId}`,
    channelRef: channel.ref,
    channelTitle: channel.title,
    channelUsername: channel.username,
    channelId: channel.channelId,
    channelLink: channel.link,
    channelAvatar: channel.avatar,
    messageUrl: buildTelegramMessageLink(
      channel.username,
      channel.channelId,
      messageId,
    ),
    text: normalizeMessageText(message),
    createdAt: normalizeTimestamp(message.date),
    views: toNumber(message.views),
    forwards: toNumber(message.forwards),
    origin,
    media: null,
    translation: null,
    quotedMessage: null,
  };
}

function normalizeMessageTextWithMedia(
  message: JsonRecord,
  mediaPreview: TelegramMediaPreview | null,
): string {
  const text = pickString(message.message);
  if (text) {
    return text;
  }

  if (message.media) {
    return mediaPreview?.label || getDefaultMediaLabel(message);
  }

  return "无文字内容";
}

async function buildFeedItem(
  client: TelegramClientInstance,
  message: unknown,
  channel: ResolvedTelegramChannel,
  origin: TelegramFeedItem["origin"],
  options: { includeMediaPreview?: boolean } = {},
): Promise<TelegramFeedItem | null> {
  const fallback = normalizeFeedItem(message, channel, origin);
  if (!fallback || !isRecord(message)) {
    return null;
  }
  const cacheKey = fallback.id;
  let mediaPreview: TelegramMediaPreview | null = null;
  if (options.includeMediaPreview !== false) {
    try {
      mediaPreview = await downloadInlineMedia(client, cacheKey, message);
    } catch {
      mediaPreview = null;
    }
  }
  const normalizedText = normalizeMessageTextWithMedia(message, mediaPreview);

  const [translation] = await Promise.all([
    translateText(normalizedText, {
      enabled:
        isTranslationEnabled() &&
        !shouldSkipTelegramChannelTranslation({
          channelUsername: fallback.channelUsername,
          channelRef: fallback.channelRef,
          channelTitle: fallback.channelTitle,
        }),
      targetLanguage: getTranslationTargetLanguage(),
      cacheNamespace: "telegram",
    }),
  ]);

  return {
    ...fallback,
    text: normalizedText,
    media: mediaPreview,
    translation,
  };
}

function mergeFeed(feed: TelegramFeedItem[]): TelegramFeedItem[] {
  return selectTelegramFeed(feed, {
    limit: getFeedItemLimit(),
    priorityMatchers: getPriorityTelegramMatchers(),
  });
}

async function resetTelegramClient(): Promise<void> {
  if (telegramIdleResetTimer) {
    clearTimeout(telegramIdleResetTimer);
    telegramIdleResetTimer = null;
  }
  const pending = telegramClientPromise;
  telegramClientPromise = null;
  telegramRealtimeStartPromise = null;
  telegramRealtimeAttached = false;
  resolvedChannelCache = null;
  currentResolvedChannels = [];
  if (!pending) return;
  try {
    const client = await pending;
    if (client) {
      await client.disconnect();
    }
  } catch {
    // ignore — we're tearing it down
  }
}

function scheduleTelegramIdleReset() {
  if (realtimeListeners.size > 0) {
    return;
  }

  const idleResetMs = getTelegramIdleResetMs();
  if (idleResetMs <= 0) {
    return;
  }

  if (telegramIdleResetTimer) {
    clearTimeout(telegramIdleResetTimer);
    telegramIdleResetTimer = null;
  }

  telegramIdleResetTimer = setTimeout(() => {
    telegramIdleResetTimer = null;
    if (realtimeListeners.size === 0) {
      void resetTelegramClient();
    }
  }, idleResetMs);
}

function cancelTelegramIdleReset() {
  if (!telegramIdleResetTimer) {
    return;
  }

  clearTimeout(telegramIdleResetTimer);
  telegramIdleResetTimer = null;
}

function getTelegramChannelAvatarCacheKey(channel: ResolvedTelegramChannel): string {
  return `${channel.channelId || channel.ref}:${channel.username}`;
}

async function getTelegramClient(): Promise<TelegramClientInstance | null> {
  if (!isConfiguredForChannelMonitoring()) {
    return null;
  }

  if (Date.now() < telegramConnectBlockedUntil) {
    const remainingMs = telegramConnectBlockedUntil - Date.now();
    const seconds = Math.ceil(remainingMs / 1000);
    throw new Error(
      `Telegram 连接在冷却中（${seconds}s 后重试）${telegramLastConnectError ? `：${telegramLastConnectError}` : "。"}`,
    );
  }

  if (!telegramClientPromise) {
    telegramClientPromise = (async () => {
      const { TelegramClient, StringSession } = await loadTelegramModules();
      const client = new TelegramClient(
        new StringSession(getTelegramSession()),
        getTelegramApiId(),
        getTelegramApiHash(),
        makeTelegramClientOptions(),
      );

      let retries = 3;
      while (retries > 0) {
        try {
          await withTimeout(client.connect(), 15_000, "Telegram 连接");

          const authorized = await withTimeout(
            client.checkAuthorization(),
            10_000,
            "Telegram 校验会话",
          );
          if (!authorized) {
            throw new Error(
              "TELEGRAM_SESSION 无效，请运行 npm run telegram:setup 重新登录。",
            );
          }

          await withTimeout(client.getMe(), 10_000, "Telegram 获取自身信息");
          telegramLastConnectError = null;
          return client;
        } catch (error) {
          retries--;
          if (retries === 0) {
            telegramClientPromise = null;
            telegramLastConnectError =
              error instanceof Error ? error.message : String(error);
            telegramConnectBlockedUntil = Date.now() + TELEGRAM_CB_COOLDOWN_MS;
            try {
              await client.disconnect();
            } catch {}
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      throw new Error("Telegram 连接失败");
    })();
  }

  return telegramClientPromise;
}

async function resolveChannels(
  client: TelegramClientInstance,
  options?: { refresh?: boolean },
): Promise<{
  channels: ResolvedTelegramChannel[];
  errors: string[];
}> {
  const shouldReuseCache =
    !options?.refresh &&
    resolvedChannelCache &&
    Date.now() - resolvedChannelCache.loadedAt < RESOLVED_CHANNEL_CACHE_MS;

  if (shouldReuseCache) {
    const cachedChannels = resolvedChannelCache?.channels ?? [];
    return {
      channels: cachedChannels,
      errors: [],
    };
  }

  const channels: ResolvedTelegramChannel[] = [];
  const errors: string[] = [];

  const targets = getConfiguredChannelTargets();
  const downloadAvatars = shouldDownloadTelegramChannelAvatars(
    process.env.TELEGRAM_CHANNEL_AVATARS,
  );
  let avatarCache: TelegramChannelAvatarCache = downloadAvatars
    ? await readTelegramChannelAvatarCache(getTelegramChannelAvatarCacheFilePath())
    : {};
  let avatarCacheChanged = false;
  const avatarCacheTtlMs = getTelegramChannelAvatarCacheTtlMs();
  const avatarCacheNow = Date.now();
  const resolveTimeoutMs = getTelegramEntityResolveTimeoutMs();
  const results = await mapWithConcurrency(
    targets,
    getTelegramEntityResolveConcurrency(),
    async (target) => {
      try {
        const entity = await withTimeout(
          client.getEntity(target.lookup),
          resolveTimeoutMs,
          `解析 ${target.ref}`,
        );
        const normalized = normalizeResolvedChannel(entity, target);
        if (!normalized) {
          throw new Error(`Telegram 频道 ${target.ref} 解析失败。`);
        }
        if (downloadAvatars) {
          const cacheKey = getTelegramChannelAvatarCacheKey(normalized);
          const cachedAvatar = getFreshTelegramChannelAvatar(
            avatarCache,
            cacheKey,
            avatarCacheTtlMs,
            avatarCacheNow,
          );

          if (cachedAvatar !== undefined) {
            normalized.avatar = cachedAvatar;
          } else {
            const previousAvatar = avatarCache[cacheKey]?.avatar ?? null;
            const downloadedAvatar = await downloadChannelAvatar(
              client,
              entity,
              cacheKey,
            );
            normalized.avatar = downloadedAvatar ?? previousAvatar;
            avatarCache = setTelegramChannelAvatarCacheEntry(
              avatarCache,
              cacheKey,
              normalized.avatar,
              avatarCacheNow,
            );
            avatarCacheChanged = true;
          }
        }
        return {
          status: "fulfilled" as const,
          value: normalized,
        };
      } catch (reason) {
        return {
          status: "rejected" as const,
          reason,
        };
      }
    },
  );

  if (downloadAvatars && avatarCacheChanged) {
    try {
      await writeTelegramChannelAvatarCache(
        getTelegramChannelAvatarCacheFilePath(),
        avatarCache,
      );
    } catch (error) {
      console.warn(
        "Telegram channel avatar cache write failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      channels.push(result.value);
    } else {
      const target = targets[i];
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : `Telegram 频道 ${target.ref} 解析失败。`,
      );
    }
  }

  const refreshResult = applyResolvedTelegramChannelRefresh({
    previous: resolvedChannelCache,
    channels,
    errors,
    targetCount: targets.length,
    now: Date.now(),
  });
  resolvedChannelCache = refreshResult.cache;

  return {
    channels: refreshResult.channels,
    errors: refreshResult.errors,
  };
}

function matchResolvedChannel(
  channels: ResolvedTelegramChannel[],
  message: unknown,
  chat: unknown,
): ResolvedTelegramChannel | null {
  const messageRecord = isRecord(message) ? message : {};
  const chatRecord = isRecord(chat) ? chat : {};

  const username = pickString(chatRecord.username).replace(/^@+/, "").toLowerCase();
  const rawChatId =
    normalizeChannelId(chatRecord.id) || normalizeChannelId(messageRecord.chatId);

  for (const channel of channels) {
    if (username && channel.username.toLowerCase() === username) {
      return channel;
    }

    if (rawChatId && channel.channelId === rawChatId) {
      return channel;
    }
  }

  return null;
}

function rememberRealtimeItem(id: string) {
  if (seenRealtimeIds.has(id)) {
    return;
  }

  seenRealtimeIds.add(id);
  seenRealtimeQueue.push(id);

  while (seenRealtimeQueue.length > MAX_SEEN_REALTIME_IDS) {
    const removed = seenRealtimeQueue.shift();
    if (removed) {
      seenRealtimeIds.delete(removed);
    }
  }
}

async function attachRealtimeHandler(client: TelegramClientInstance) {
  if (telegramRealtimeAttached) {
    return;
  }

  telegramRealtimeAttached = true;
  const { NewMessage } = await loadTelegramModules();

  client.addEventHandler(async (event: TelegramNewMessageEvent) => {
    try {
      const message = event.message as unknown;
      if (!isRecord(message)) {
        return;
      }

      const chat = typeof event.message.getChat === "function"
        ? await event.message.getChat()
        : null;

      const matchedChannel = matchResolvedChannel(
        currentResolvedChannels,
        message,
        chat,
      );
      if (!matchedChannel) {
        return;
      }

      const feedItem = await buildFeedItem(
        client,
        message,
        matchedChannel,
        "realtime",
      );
      if (!feedItem || seenRealtimeIds.has(feedItem.id)) {
        return;
      }

      rememberRealtimeItem(feedItem.id);

      pushStatus(
        "subscribed",
        `已收到 ${matchedChannel.title} 的新频道消息。`,
      );

      broadcast({
        type: "message",
        payload: {
          channel: matchedChannel.ref,
          channelTitle: matchedChannel.title,
          createdAt: feedItem.createdAt,
          feedItem,
        },
      });
    } catch (error) {
      pushStatus(
        "error",
        error instanceof Error
          ? `Telegram 实时事件解析失败：${error.message}`
          : "Telegram 实时事件解析失败。",
      );
    }
  }, new NewMessage({}));
}

export async function ensureTelegramRealtime(): Promise<TelegramRealtimeStatus> {
  await loadRuntimeConfig();
  if (!isConfiguredForChannelMonitoring()) {
    return pushStatus(
      "needs_config",
      "Telegram 频道监控需要 TELEGRAM_API_ID、TELEGRAM_API_HASH、TELEGRAM_SESSION 和 TELEGRAM_CHANNELS。",
    );
  }

  if (!telegramRealtimeStartPromise) {
    telegramRealtimeStartPromise = (async () => {
      pushStatus("connecting", "正在连接 Telegram MTProto 会话...");

      try {
        const client = await getTelegramClient();
        if (!client) {
          return pushStatus(
            "needs_config",
            "Telegram 频道监控配置还不完整。",
          );
        }

        const { channels, errors } = await resolveChannels(client, {
          refresh: true,
        });

        if (errors.length > 0) {
          pushStatus("error", errors[0]);
        }

        if (channels.length === 0) {
          return pushStatus(
            "error",
            "没有解析到可监控的 Telegram 频道，请检查 TELEGRAM_CHANNELS 和会话权限。",
          );
        }

        currentResolvedChannels = channels;
        pushStatus("connected", `已连接 Telegram，会话可访问 ${channels.length} 个频道。`);
        await attachRealtimeHandler(client);

        return pushStatus(
          "subscribed",
          `Telegram 实时监控已启动，当前监听 ${channels.length} 个频道。`,
        );
      } catch (error) {
        telegramRealtimeStartPromise = null;
        telegramRealtimeAttached = false;

        return pushStatus(
          "error",
          error instanceof Error
            ? `Telegram 连接失败：${error.message}`
            : "Telegram 连接失败。",
        );
      }
    })();
  }

  return telegramRealtimeStartPromise;
}

export async function reloadTelegramChannels(): Promise<{
  channels: TelegramChannelWatch[];
  errors: string[];
}> {
  await loadRuntimeConfig();
  resolvedChannelCache = null;
  sharedTelegramSnapshotCache.invalidate();
  await deletePersistedTelegramSnapshot(getTelegramSnapshotCacheFilePath());

  if (!isConfiguredForChannelMonitoring()) {
    currentResolvedChannels = [];
    return { channels: [], errors: getSetupErrors() };
  }

  try {
    const client = await getTelegramClient();
    if (!client) {
      return { channels: [], errors: ["Telegram 会话尚未初始化。"] };
    }

    const { channels, errors } = await resolveChannels(client, {
      refresh: true,
    });
    currentResolvedChannels = channels;

    if (channels.length > 0) {
      pushStatus(
        "subscribed",
        `Telegram 监听已更新，当前 ${channels.length} 个频道。`,
      );
    }

    return {
      channels: channels.map(toWatchChannel),
      errors,
    };
  } catch (error) {
    return {
      channels: [],
      errors: [
        error instanceof Error ? error.message : "Telegram 热重载失败。",
      ],
    };
  }
}

export function subscribeTelegramRealtime(
  listener: (event: TelegramRealtimeEnvelope) => void | Promise<void>,
): () => void {
  cancelTelegramIdleReset();
  realtimeListeners.add(listener);

  if (lastRealtimeStatus) {
    void listener({
      type: "status",
      payload: lastRealtimeStatus,
    });
  }

  return () => {
    realtimeListeners.delete(listener);
    scheduleTelegramIdleReset();
  };
}

export async function getTelegramDashboardSnapshot(): Promise<TelegramDashboardSnapshot> {
  await loadRuntimeConfig();
  const setupErrors = getSetupErrors();

  if (setupErrors.length > 0) {
    return {
      provider: "telegram",
      mode: "mtproto",
      isConfigured: false,
      isConnected: false,
      status: "needs_config",
      channels: [],
      feed: [],
      note: "Telegram channel 更适合用 MTProto 用户会话监控。Bot API 适合接收 bot 能看到的新消息，但不擅长稳定回补频道历史。",
      errors: setupErrors,
    };
  }

  try {
    return await withTimeout(
      (async () => {
    const client = await getTelegramClient();
    if (!client) {
      return {
        provider: "telegram",
        mode: "mtproto",
        isConfigured: false,
        isConnected: false,
        status: "needs_config",
        channels: [],
        feed: [],
        note: "Telegram MTProto 会话还没有准备好。",
        errors: ["Telegram 会话尚未初始化。"],
      };
    }

    const { channels, errors } = await resolveChannels(client);
    currentResolvedChannels = channels;

    const channelResults = await Promise.allSettled(
      channels.map(async (channel) => {
        const messages = await withTimeout(
          client.getMessages(channel.entity as never, {
            limit: getMessagesLimitForChannel(channel),
          }),
          12_000,
          `读取 ${channel.title}`,
        );

        return Array.from(messages)
          .map((message): TelegramMessageCandidate | null => {
            const fallback = normalizeFeedItem(message, channel, "history");
            return fallback
              ? {
                  fallback,
                  message,
                  channel,
                }
              : null;
          })
          .filter(Boolean) as TelegramMessageCandidate[];
      }),
    );

    const candidates: TelegramMessageCandidate[] = [];
    for (let i = 0; i < channelResults.length; i++) {
      const result = channelResults[i];
      if (result.status === "fulfilled") {
        for (const candidate of result.value) {
          candidates.push(candidate);
        }
      } else {
        errors.push(
          `读取 Telegram 频道 ${channels[i].title} 失败：${
            result.reason instanceof Error ? result.reason.message : "未知错误"
          }`,
        );
      }
    }

    const candidateById = new Map(
      candidates.map((candidate) => [candidate.fallback.id, candidate]),
    );
    const selectedFallbacks = mergeFeed(
      candidates.map((candidate) => candidate.fallback),
    );
    const selectedCandidates = selectedFallbacks
      .map((item) => candidateById.get(item.id))
      .filter(Boolean) as TelegramMessageCandidate[];
    const mediaPreviewLimit = getTelegramMediaPreviewLimit();
    const builtFeed = await mapWithConcurrency(
      selectedCandidates,
      getTelegramFeedBuildConcurrency(),
      async (candidate, index) =>
        (await buildFeedItem(
          client,
          candidate.message,
          candidate.channel,
          "history",
          {
            includeMediaPreview: shouldDownloadTelegramMediaPreview(
              index,
              mediaPreviewLimit,
            ),
          },
        )) ?? candidate.fallback,
    );

    for (const item of builtFeed) {
      rememberRealtimeItem(item.id);
    }

    const mergedFeed = mergeFeed(builtFeed);

    return compactTelegramSnapshot({
      provider: "telegram",
      mode: "mtproto",
      isConfigured: true,
      isConnected: true,
      status: channels.length > 0 ? "live" : "limited",
      channels: channels.map(toWatchChannel),
      feed: mergedFeed,
      note: "当前按 Telegram 官方 MTProto 用户会话读取你已加入的频道，适合 public channel，也能覆盖你账号可见的 private channel。",
      errors,
    });
      })(),
      30_000,
      "Telegram 快照",
    );
  } catch (error) {
    void resetTelegramClient();
    return {
      provider: "telegram",
      mode: "mtproto",
      isConfigured: true,
      isConnected: false,
      status: "error",
      channels: [],
      feed: [],
      note: "Telegram MTProto 会话已配置，但当前还没有成功连上。",
      errors: [
        error instanceof Error ? error.message : "Telegram 初始化失败。",
      ],
    };
  }
}

async function getTelegramDashboardSnapshotWithPersistentCache(): Promise<TelegramDashboardSnapshot> {
  await loadRuntimeConfig();

  if (!isConfiguredForChannelMonitoring()) {
    return getTelegramDashboardSnapshot();
  }

  const cacheFilePath = getTelegramSnapshotCacheFilePath();
  const cachedRecord = await readPersistedTelegramSnapshotRecord(cacheFilePath);
  if (
    cachedRecord &&
    Date.now() - cachedRecord.fetchedAt <= getTelegramSnapshotCacheTtlMs()
  ) {
    return withTelegramRefreshMeta(cachedRecord.snapshot, {
      source: "cache",
      cacheFetchedAtMs: cachedRecord.fetchedAt,
    });
  }

  const startedAtMs = Date.now();
  const snapshot = await getTelegramDashboardSnapshot();
  const finishedAtMs = Date.now();
  if (shouldResetTelegramClientAfterSnapshot(snapshot)) {
    void resetTelegramClient();
  } else {
    scheduleTelegramIdleReset();
  }
  if (
    snapshot.isConfigured &&
    snapshot.status !== "needs_config" &&
    snapshot.feed.length > 0
  ) {
    await writePersistedTelegramSnapshot(cacheFilePath, snapshot);
  }

  return withTelegramRefreshMeta(snapshot, {
    source: "refresh",
    startedAtMs,
    finishedAtMs,
    cacheFetchedAtMs: finishedAtMs,
  });
}

const sharedTelegramSnapshotCache = createSnapshotCache(
  () => getTelegramDashboardSnapshotWithPersistentCache(),
  getTelegramSnapshotMemoryTtlMs(),
);

export function getCachedTelegramDashboardSnapshot(): Promise<TelegramDashboardSnapshot> {
  return sharedTelegramSnapshotCache.get();
}

export async function refreshTelegramDashboardSnapshotNow(): Promise<TelegramDashboardSnapshot> {
  return telegramRefreshCoordinator.run(async () => {
    sharedTelegramSnapshotCache.invalidate();
    const cacheFilePath = getTelegramSnapshotCacheFilePath();
    const cachedRecord = await readPersistedTelegramSnapshotRecord(cacheFilePath);
    const startedAtMs = Date.now();
    const snapshot = await getTelegramDashboardSnapshot();
    const finishedAtMs = Date.now();
    const cached = cachedRecord?.snapshot ?? null;
    const result = chooseTelegramRefreshResult(snapshot, cached);
    let cacheFetchedAtMs = cachedRecord?.fetchedAt ?? null;
    const shouldResetClient = shouldResetTelegramClientAfterSnapshot(snapshot);

    if (
      snapshot.isConfigured &&
      snapshot.status !== "needs_config" &&
      snapshot.status !== "error" &&
      snapshot.feed.length > 0
    ) {
      try {
        await writePersistedTelegramSnapshot(cacheFilePath, snapshot);
        cacheFetchedAtMs = finishedAtMs;
      } catch (error) {
        console.warn(
          "Telegram snapshot cache write failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (shouldResetClient) {
      void resetTelegramClient();
    } else {
      scheduleTelegramIdleReset();
    }
    return withTelegramRefreshMeta(result, {
      source: "refresh",
      startedAtMs,
      finishedAtMs,
      cacheFetchedAtMs,
    });
  });
}

export function refreshTelegramDashboardSnapshotInBackground(): void {
  if (!telegramRefreshCoordinator.shouldStartBackgroundRefresh()) {
    return;
  }

  void refreshTelegramDashboardSnapshotNow()
    .then(() => undefined)
    .catch((error) => {
      console.warn(
        "Telegram background refresh failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
}

export async function getInitialCachedTelegramDashboardSnapshot(): Promise<TelegramDashboardSnapshot> {
  await loadRuntimeConfig();

  if (!isConfiguredForChannelMonitoring()) {
    return getInitialTelegramDashboardSnapshot();
  }

  const cachedRecord = await readPersistedTelegramSnapshotRecord(
    getTelegramSnapshotCacheFilePath(),
  );

  if (
    cachedRecord &&
    Date.now() - cachedRecord.fetchedAt <= getTelegramInitialSnapshotMaxAgeMs()
  ) {
    return withTelegramRefreshMeta(cachedRecord.snapshot, {
      source: "cache",
      cacheFetchedAtMs: cachedRecord.fetchedAt,
    });
  }

  return withTelegramRefreshMeta(getInitialTelegramDashboardSnapshot(), {
    source: "initial",
  });
}

export async function invalidateTelegramDashboardSnapshot(): Promise<void> {
  sharedTelegramSnapshotCache.invalidate();
  await deletePersistedTelegramSnapshot(getTelegramSnapshotCacheFilePath());
}

export async function mergeTelegramRealtimeUpdateIntoSnapshotCache(
  update: TelegramRealtimeUpdate,
): Promise<void> {
  sharedTelegramSnapshotCache.invalidate();
  const cacheFilePath = getTelegramSnapshotCacheFilePath();
  const cached = await readPersistedTelegramSnapshot(cacheFilePath);
  if (!cached) {
    return;
  }

  await mergePersistedRealtimeTelegramUpdate(
    cacheFilePath,
    update,
    getFeedItemLimit(),
  );
}
