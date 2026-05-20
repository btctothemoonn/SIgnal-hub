import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  get6551TwitterTweetById,
} from "../src/lib/6551-twitter.ts";
import {
  mergeFullTweetIntoMonitor985Update,
  shouldRefreshMonitor985FeedItem,
} from "../src/lib/monitor985-enrichment.ts";
import {
  getXPipelineConfiguredAccounts,
  getXPipelineConfiguredTruthAccounts,
} from "../src/lib/x-pipeline-accounts.ts";
import { isMonitor985Enabled } from "../src/lib/x-pipeline-config.ts";
import {
  disableXPipelineAccountsExcept,
  setXPipelineHealth,
  upsertXPipelineAccount,
  upsertXPipelineRealtimeUpdate,
} from "../src/lib/x-pipeline-store.ts";
import {
  backfillMissingXTranslations,
  ensureXFeedItemTranslation,
} from "../src/lib/x-translation-backfill.ts";
import {
  extractMonitor985Events,
  normalizeMonitor985Event,
} from "../src/lib/monitor985.ts";
import {
  buildMonitor985RequestHeaders,
  buildMonitor985RequestUrl,
  describeMonitor985AuthMode,
} from "../src/lib/monitor985-auth.ts";
import {
  parseMonitor985WatchConfig,
  toMonitor985XPipelineAccounts,
} from "../src/lib/monitor985-watch-config.ts";
import {
  getMonitor985AccountSyncIntervalMs,
  shouldRefreshMonitor985Accounts,
} from "../src/lib/monitor985-sync-policy.ts";

const RUNTIME_CONFIG_PATH = resolve(process.cwd(), ".signal-hub", "runtime-config.json");
const DEFAULT_BASE_URL = "https://985monitor.xyz";
const DEFAULT_RECONNECT_MS = 5_000;
const DEFAULT_CATCHUP_INTERVAL_MS = 60_000;
const SSE_EVENT_TYPES = new Set(["twitter", "truth"]);

let accountSyncTimer = null;
let catchupTimer = null;
let catchupInFlight = false;
let translationBackfillInFlight = false;
let stopRequested = false;
let accountSyncCache = null;

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function positiveInt(raw, fallback) {
  const parsed = Number(String(raw || "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getBaseUrl() {
  return process.env.MONITOR985_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function getBootstrapLimit() {
  return positiveInt(process.env.MONITOR985_BOOTSTRAP_LIMIT, 30);
}

function getReconnectMs() {
  return positiveInt(process.env.MONITOR985_RECONNECT_MS, DEFAULT_RECONNECT_MS);
}

function getCatchupIntervalMs() {
  return positiveInt(
    process.env.MONITOR985_CATCHUP_INTERVAL_MS,
    DEFAULT_CATCHUP_INTERVAL_MS,
  );
}

function getAccountSyncIntervalMs() {
  return getMonitor985AccountSyncIntervalMs(process.env);
}

function getFilterMode() {
  const raw = process.env.MONITOR985_FILTER_MODE?.trim().toLowerCase();
  return raw === "all" ? "all" : "configured";
}

function isXTranslationEnabled() {
  const raw = process.env.TWITTER_TRANSLATE_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

function getXTranslationTarget() {
  return (
    process.env.TWITTER_TRANSLATE_TARGET?.trim() ||
    process.env.TELEGRAM_TRANSLATE_TARGET?.trim() ||
    "zh-CN"
  );
}

function accountKey(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function normalizeRuntimeConfig(raw) {
  const items = Array.isArray(raw?.twitterAccounts) ? raw.twitterAccounts : [];
  return {
    telegramChannels: [],
    twitterAccounts: items
      .map((item) => {
        if (typeof item === "string") {
          return { ref: item, tags: [] };
        }
        if (item && typeof item.ref === "string") {
          return {
            ref: item.ref,
            tags: Array.isArray(item.tags)
              ? item.tags.filter((tag) => typeof tag === "string")
              : [],
          };
        }
        return null;
      })
      .filter(Boolean),
  };
}

async function readRuntimeConfigFile() {
  try {
    return normalizeRuntimeConfig(JSON.parse(await readFile(RUNTIME_CONFIG_PATH, "utf8")));
  } catch {
    return { telegramChannels: [], twitterAccounts: [] };
  }
}

async function refreshConfiguredAccounts() {
  const runtimeConfig = await readRuntimeConfigFile();
  const localAccounts = getXPipelineConfiguredAccounts(runtimeConfig);
  const truthAccounts = getXPipelineConfiguredTruthAccounts();
  let accounts = [...localAccounts, ...truthAccounts];
  let source = "local";

  if (describeMonitor985AuthMode() !== "public") {
    try {
      const payload = await fetchJson("/api/watch-config");
      const remoteAccounts = toMonitor985XPipelineAccounts(
        parseMonitor985WatchConfig(payload),
      );
      if (remoteAccounts.length > 0) {
        accounts = [...remoteAccounts, ...truthAccounts];
        source = "985";
      }
    } catch (error) {
      log("monitor985_watch_config_sync_failed", {
        error: String(error),
        fallback: "local",
      });
    }
  }

  for (const account of accounts) {
    upsertXPipelineAccount(account);
  }
  disableXPipelineAccountsExcept(accounts.map((account) => account.username));
  return {
    count: accounts.length,
    localCount: localAccounts.length,
    source,
    allowedAccountKeys: new Set(accounts.map((account) => accountKey(account.username))),
  };
}

async function syncConfiguredAccounts(options = {}) {
  const intervalMs = getAccountSyncIntervalMs();
  if (
    accountSyncCache &&
    !shouldRefreshMonitor985Accounts({
      force: Boolean(options.force),
      intervalMs,
      lastSyncedAtMs: accountSyncCache.syncedAtMs,
      nowMs: Date.now(),
    })
  ) {
    return {
      ...accountSyncCache.result,
      allowedAccountKeys: new Set(accountSyncCache.allowedAccountKeys),
    };
  }

  const result = await refreshConfiguredAccounts();
  accountSyncCache = {
    allowedAccountKeys: Array.from(result.allowedAccountKeys),
    result: {
      count: result.count,
      localCount: result.localCount,
      source: result.source,
    },
    syncedAtMs: Date.now(),
  };
  return result;
}

function markHealth(status, detail) {
  setXPipelineHealth({ scope: "collector", status, detail });
}

function requestUrl(path) {
  return buildMonitor985RequestUrl(path, getBaseUrl());
}

function requestHeaders() {
  return buildMonitor985RequestHeaders();
}

async function fetchJson(path) {
  const response = await fetch(requestUrl(path), {
    cache: "no-store",
    headers: requestHeaders(),
  });
  if (!response.ok) {
    throw new Error(`985monitor HTTP ${response.status}`);
  }
  return response.json();
}

function shouldAcceptUpdate(update, allowedAccountKeys) {
  if (getFilterMode() === "all") return true;
  return allowedAccountKeys.has(accountKey(update.account));
}

async function refreshMonitor985Update(update) {
  if (!shouldRefreshMonitor985FeedItem(update.feedItem)) return update;
  try {
    const fullTweet = await get6551TwitterTweetById(update.feedItem.id);
    const merged = mergeFullTweetIntoMonitor985Update(update, fullTweet);
    if (merged !== update) {
      log("monitor985_full_tweet_refreshed", {
        tweetId: update.feedItem.id,
        oldLength: update.feedItem.text.length,
        newLength: merged.feedItem.text.length,
      });
    }
    return merged;
  } catch (error) {
    log("monitor985_full_tweet_refresh_failed", {
      tweetId: update.feedItem.id,
      error: String(error),
    });
    return update;
  }
}

async function translateMonitor985Update(update) {
  return {
    ...update,
    feedItem: await ensureXFeedItemTranslation(update.feedItem, {
      enabled: isXTranslationEnabled(),
      targetLanguage: getXTranslationTarget(),
      cacheNamespace: "monitor985",
    }),
  };
}

async function runTranslationBackfill(reason) {
  if (translationBackfillInFlight) return;
  translationBackfillInFlight = true;
  try {
    const stats = await backfillMissingXTranslations({
      enabled: isXTranslationEnabled(),
      targetLanguage: getXTranslationTarget(),
      cacheNamespace: "x-pipeline",
      log,
    });
    if (stats.translated > 0 || stats.failed > 0) {
      log("monitor985_translation_backfill", {
        reason,
        ...stats,
      });
    }
  } catch (error) {
    log("monitor985_translation_backfill_failed", {
      reason,
      error: String(error),
    });
  } finally {
    translationBackfillInFlight = false;
  }
}

async function ingestRawEvent(rawEvent, allowedAccountKeys) {
  let update = normalizeMonitor985Event(rawEvent);
  if (!update) return { accepted: false, reason: "not-normalized" };
  if (!shouldAcceptUpdate(update, allowedAccountKeys)) {
    return { accepted: false, reason: `not-configured:${update.account}` };
  }

  update = await translateMonitor985Update(await refreshMonitor985Update(update));
  upsertXPipelineRealtimeUpdate({
    ...update,
    remark: "985monitor",
    feedItem: {
      ...update.feedItem,
      queryLabel: update.feedItem.queryLabel || "985monitor",
    },
  });
  markHealth("live", `985monitor received ${update.eventType} from @${update.account}`);
  return {
    accepted: true,
    account: update.account,
    eventType: update.eventType,
    id: update.feedItem.id,
  };
}

async function bootstrapRecentEvents(allowedAccountKeys, reason = "bootstrap") {
  const payloads = await Promise.all([
    fetchJson(`/api/twitter-live-events?limit=${getBootstrapLimit()}`),
    fetchJson(`/api/truth-social-events?limit=${getBootstrapLimit()}`),
  ]);
  const events = payloads.flatMap((payload) => extractMonitor985Events(payload));
  let accepted = 0;
  let ignored = 0;
  for (const rawEvent of events.slice().reverse()) {
    const result = await ingestRawEvent(rawEvent, allowedAccountKeys);
    if (result.accepted) accepted += 1;
    else ignored += 1;
  }
  log("monitor985_catchup", { reason, fetched: events.length, accepted, ignored });
  void runTranslationBackfill(reason);
  return { fetched: events.length, accepted, ignored };
}

async function runRestCatchup(reason) {
  if (catchupInFlight) {
    log("monitor985_catchup_skipped", { reason, skipped: "previous catchup running" });
    return;
  }

  catchupInFlight = true;
  try {
    const synced = await syncConfiguredAccounts();
    await bootstrapRecentEvents(synced.allowedAccountKeys, reason);
  } catch (error) {
    markHealth("error", `985monitor REST catchup failed: ${String(error)}`);
    log("monitor985_catchup_failed", { reason, error: String(error) });
  } finally {
    catchupInFlight = false;
  }
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colonIndex = rawLine.indexOf(":");
    const field = colonIndex === -1 ? rawLine : rawLine.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : rawLine.slice(colonIndex + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  return { event, data: data.join("\n") };
}

async function readSseStream(response, allowedAccountKeys) {
  if (!response.body) throw new Error("985monitor SSE response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accepted = 0;
  let ignored = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(boundary + (match ? match[0].length : 2));

      const message = parseSseBlock(block);
      if (message.event === "ready") {
        markHealth("connected", "985monitor SSE connected");
      } else if (SSE_EVENT_TYPES.has(message.event) && message.data) {
        const payload = JSON.parse(message.data);
        const result = await ingestRawEvent(payload?.event, allowedAccountKeys);
        if (result.accepted) {
          accepted += 1;
          log("monitor985_event", result);
        } else {
          ignored += 1;
        }
      }

      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }

  return { accepted, ignored };
}

async function connectSse(allowedAccountKeys) {
  const response = await fetch(requestUrl("/api/events-stream"), {
    cache: "no-store",
    headers: {
      ...requestHeaders(),
      Accept: "text/event-stream",
    },
  });
  if (!response.ok) {
    throw new Error(`985monitor SSE HTTP ${response.status}`);
  }
  markHealth("connected", "985monitor SSE connected");
  return readSseStream(response, allowedAccountKeys);
}

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  const once = process.argv.includes("--once");
  if (!isMonitor985Enabled()) {
    markHealth("paused", "MONITOR985_ENABLED is false");
    log("monitor985_disabled");
    return;
  }

  const synced = await syncConfiguredAccounts({ force: true });
  markHealth(
    "starting",
    `985monitor worker starting with ${synced.count} ${synced.source} accounts`,
  );

  if (getFilterMode() === "configured" && synced.count === 0) {
    markHealth("paused", "985monitor has no configured local X accounts to accept");
    log("monitor985_no_configured_accounts");
    return;
  }

  await runRestCatchup("bootstrap");
  if (once) return;

  accountSyncTimer = setInterval(() => {
    void syncConfiguredAccounts({ force: true }).catch((error) => {
      markHealth("error", `985monitor account sync failed: ${String(error)}`);
      log("monitor985_account_sync_failed", { error: String(error) });
    });
  }, getAccountSyncIntervalMs());

  catchupTimer = setInterval(() => {
    void runRestCatchup("interval");
  }, getCatchupIntervalMs());

  log("monitor985_worker_started", {
    baseUrl: getBaseUrl(),
    bootstrapLimit: getBootstrapLimit(),
    filterMode: getFilterMode(),
    authMode: describeMonitor985AuthMode(),
    accountSource: synced.source,
    localAccountCount: synced.localCount,
    reconnectMs: getReconnectMs(),
    catchupIntervalMs: getCatchupIntervalMs(),
    accountSyncIntervalMs: getAccountSyncIntervalMs(),
  });

  while (!stopRequested) {
    try {
      const current = await syncConfiguredAccounts();
      try {
        await bootstrapRecentEvents(current.allowedAccountKeys, "before-sse-connect");
      } catch (error) {
        markHealth("error", `985monitor pre-SSE catchup failed: ${String(error)}`);
        log("monitor985_catchup_failed", {
          reason: "before-sse-connect",
          error: String(error),
        });
      }
      await connectSse(current.allowedAccountKeys);
      markHealth("closed", "985monitor SSE ended");
    } catch (error) {
      markHealth("error", `985monitor SSE failed: ${String(error)}`);
      log("monitor985_sse_failed", { error: String(error) });
    }
    if (!stopRequested) {
      await new Promise((resolve) => setTimeout(resolve, getReconnectMs()));
    }
  }
}

function shutdown() {
  stopRequested = true;
  if (accountSyncTimer) clearInterval(accountSyncTimer);
  if (catchupTimer) clearInterval(catchupTimer);
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

main().catch((error) => {
  markHealth("error", String(error));
  log("monitor985_worker_failed", { error: String(error) });
  process.exit(1);
});
