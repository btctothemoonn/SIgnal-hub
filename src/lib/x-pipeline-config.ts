import { getRuntimeDataPath } from "./runtime-storage.ts";

const DEFAULT_FEED_ITEMS = 200;
const DEFAULT_EVENT_POLL_MS = 3000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_TWITTER_API_BASE = "https://ai.6551.io";

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type XPipelineConfig = {
  dbPath: string;
  maxFeedItems: number;
  eventPollMs: number;
  maxReconnectAttempts: number;
  baseUrl: string;
};

export function getXPipelineConfig(
  env: NodeJS.ProcessEnv = process.env,
): XPipelineConfig {
  return {
    dbPath:
      env.X_PIPELINE_DB?.trim() ||
      getRuntimeDataPath(env, "x-pipeline.sqlite"),
    maxFeedItems: positiveInt(env.X_PIPELINE_FEED_ITEMS, DEFAULT_FEED_ITEMS),
    eventPollMs: positiveInt(
      env.X_PIPELINE_EVENT_POLL_MS,
      DEFAULT_EVENT_POLL_MS,
    ),
    maxReconnectAttempts: positiveInt(
      env.X_PIPELINE_MAX_RECONNECT_ATTEMPTS,
      DEFAULT_MAX_RECONNECT_ATTEMPTS,
    ),
    baseUrl: env.TWITTER_API_BASE?.trim() || DEFAULT_TWITTER_API_BASE,
  };
}

export function hasXPipelineToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.TWITTER_TOKEN?.trim() || env.OPENNEWS_TOKEN?.trim() || "",
  );
}

export function isMonitor985Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.MONITOR985_ENABLED?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw || "");
}

export function isXHybridEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.X_HYBRID_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off", "paused"].includes(raw);
}

export function hasXPipelineDataSource(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasXPipelineToken(env) || isMonitor985Enabled(env);
}

export function isXPipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TWITTER_CONNECTOR_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return !["0", "false", "no", "off", "paused"].includes(raw);
}

export function getXPipelineTrackedKeywords(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.TWITTER_SEARCH_KEYWORDS;
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw.split(/[\n,，]/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
