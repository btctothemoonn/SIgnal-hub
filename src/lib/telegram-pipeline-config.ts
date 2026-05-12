import { getRuntimeDataPath } from "./runtime-storage.ts";

const DEFAULT_BACKFILL_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MESSAGES_PER_CHANNEL = 80;
const DEFAULT_INCREMENTAL_MESSAGES_PER_CHANNEL = 300;
const DEFAULT_MEDIA_PREVIEW_ITEMS = 24;
const DEFAULT_CHANNEL_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TELEGRAM_PROXY_TIMEOUT_SECONDS = 8;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type TelegramPipelineConfig = {
  dbPath: string;
  mediaDir: string;
  mediaRouteBase: string;
  backfillIntervalMs: number;
  messagesPerChannel: number;
  incrementalMessagesPerChannel: number;
  mediaPreviewItems: number;
  channelAvatarTtlMs: number;
  proxy?: TelegramPipelineProxyConfig;
};

export type TelegramPipelineProxyConfig = {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
  timeout: number;
};

function parseSocksType(raw: string | undefined): 4 | 5 {
  const value = raw?.trim().toLowerCase();
  return value === "4" || value === "socks4" ? 4 : 5;
}

function decodeUrlPart(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseProxyUrl(
  raw: string,
  timeout: number,
): TelegramPipelineProxyConfig | undefined {
  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(":", "").toLowerCase();
    if (!["socks", "socks4", "socks5", "socks5h"].includes(protocol)) {
      return undefined;
    }
    const port = Number(url.port);
    if (!url.hostname || !Number.isInteger(port) || port <= 0) {
      return undefined;
    }
    return {
      ip: url.hostname,
      port,
      socksType: protocol === "socks4" ? 4 : 5,
      username: decodeUrlPart(url.username),
      password: decodeUrlPart(url.password),
      timeout,
    };
  } catch {
    return undefined;
  }
}

function getTelegramProxyConfig(
  env: NodeJS.ProcessEnv,
): TelegramPipelineProxyConfig | undefined {
  const timeout = positiveInt(
    env.TELEGRAM_PROXY_TIMEOUT_SECONDS,
    DEFAULT_TELEGRAM_PROXY_TIMEOUT_SECONDS,
  );
  const proxyUrl = env.TELEGRAM_PROXY_URL?.trim();
  if (proxyUrl) {
    return parseProxyUrl(proxyUrl, timeout);
  }

  const ip = env.TELEGRAM_PROXY_HOST?.trim();
  const port = positiveInt(env.TELEGRAM_PROXY_PORT, 0);
  if (!ip || !port) {
    return undefined;
  }

  return {
    ip,
    port,
    socksType: parseSocksType(env.TELEGRAM_PROXY_TYPE),
    username: env.TELEGRAM_PROXY_USERNAME?.trim() || undefined,
    password: env.TELEGRAM_PROXY_PASSWORD?.trim() || undefined,
    timeout,
  };
}

export function getTelegramPipelineConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramPipelineConfig {
  return {
    dbPath:
      env.TELEGRAM_PIPELINE_DB?.trim() ||
      getRuntimeDataPath(env, "telegram-pipeline.sqlite"),
    mediaDir:
      env.TELEGRAM_PIPELINE_MEDIA_DIR?.trim() ||
      getRuntimeDataPath(env, "telegram-media"),
    mediaRouteBase: env.TELEGRAM_PIPELINE_MEDIA_ROUTE?.trim() || "/api/telegram/media",
    backfillIntervalMs: positiveInt(
      env.TELEGRAM_PIPELINE_BACKFILL_INTERVAL_MS,
      DEFAULT_BACKFILL_INTERVAL_MS,
    ),
    messagesPerChannel: positiveInt(
      env.TELEGRAM_PIPELINE_MESSAGES_PER_CHANNEL,
      DEFAULT_MESSAGES_PER_CHANNEL,
    ),
    incrementalMessagesPerChannel: positiveInt(
      env.TELEGRAM_PIPELINE_INCREMENTAL_MESSAGES_PER_CHANNEL,
      DEFAULT_INCREMENTAL_MESSAGES_PER_CHANNEL,
    ),
    mediaPreviewItems: positiveInt(
      env.TELEGRAM_PIPELINE_MEDIA_PREVIEW_ITEMS,
      DEFAULT_MEDIA_PREVIEW_ITEMS,
    ),
    channelAvatarTtlMs: positiveInt(
      env.TELEGRAM_PIPELINE_AVATAR_TTL_MS,
      DEFAULT_CHANNEL_AVATAR_TTL_MS,
    ),
    proxy: getTelegramProxyConfig(env),
  };
}
