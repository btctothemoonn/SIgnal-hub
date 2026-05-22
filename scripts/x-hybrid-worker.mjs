import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  get6551TwitterTweetById,
  get6551TwitterUserTweets,
} from "../src/lib/6551-twitter.ts";
import {
  getXPipelineConfiguredAccounts,
  getXPipelineConfiguredTruthAccounts,
} from "../src/lib/x-pipeline-accounts.ts";
import {
  getTelegramPipelineConfig,
} from "../src/lib/telegram-pipeline-config.ts";
import {
  backfillMissingXTranslations as runXTranslationBackfill,
  ensureXFeedItemTranslation,
} from "../src/lib/x-translation-backfill.ts";
import { getTelegramXSourceChannelKeys } from "../src/lib/telegram-x-source-channels.ts";
import {
  getXHybridEffectiveLookbackMs,
  getXHybridRecoveryGapMs,
  getXHybridRecoveryLookbackMs,
  shouldKeepXHybridRecoveryWindow,
} from "../src/lib/x-hybrid-recovery-window.ts";
import { selectTelegramXSourceRows } from "../src/lib/x-hybrid-telegram-scan.ts";
import {
  parseXHybridTelegramCandidate,
  isRetryableXHybridFetchError,
  selectBestTweetMatch,
  shouldProcessXHybridSourceStatus,
} from "../src/lib/x-hybrid-telegram.ts";
import {
  getXHybridEnrichmentMode,
} from "../src/lib/x-hybrid-enrichment-mode.ts";
import {
  confirmXHybridPrimaryMisses,
} from "../src/lib/x-hybrid-primary-refresh.ts";
import {
  isXHybridEnabled,
} from "../src/lib/x-pipeline-config.ts";
import {
  extractMonitor985Events,
  normalizeMonitor985Event,
} from "../src/lib/monitor985.ts";
import {
  mergeFullTweetIntoMonitor985Update,
  shouldRefreshMonitor985FeedItem,
} from "../src/lib/monitor985-enrichment.ts";
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
  resolveMonitor985AcceptedAccounts,
  shouldAcceptMonitor985Account,
} from "../src/lib/monitor985-account-filter.ts";
import {
  isFullTweetByIdCacheHit,
} from "../src/lib/x-hybrid-tweet-cache.ts";
import {
  resolveHybridQuotedTweet,
} from "../src/lib/x-hybrid-quoted-tweet.ts";
import {
  reserveXApiPoints,
} from "../src/lib/x-api-usage.ts";
import {
  getXHybridAccountFetchStatus,
  getXPipelineFeedItem,
  getXPipelineQuotedTweet,
  getXPipelineHealth,
  getXHybridSourceStatus,
  disableXPipelineAccountsExcept,
  markXHybridAccountFetched,
  markXHybridSource,
  setXPipelineHealth,
  upsertXPipelineQuotedTweet,
  upsertXPipelineAccount,
  upsertXPipelineRealtimeUpdate,
} from "../src/lib/x-pipeline-store.ts";

const RUNTIME_CONFIG_PATH = resolve(process.cwd(), ".signal-hub", "runtime-config.json");
const DEFAULT_MONITOR985_BASE_URL = "https://985monitor.xyz";

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

function boolEnabled(raw) {
  return ["1", "true", "yes", "on"].includes(String(raw || "").trim().toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHealthScope() {
  return process.env.X_HYBRID_HEALTH_SCOPE?.trim() || "hybrid";
}

function getMonitor985BaseUrl() {
  return process.env.MONITOR985_BASE_URL?.trim() || DEFAULT_MONITOR985_BASE_URL;
}

function get985GraceDelayMs() {
  return positiveInt(process.env.X_HYBRID_985_GRACE_MS, 5 * 60_000);
}

function getMonitor985HybridPreflightLimit() {
  return positiveInt(process.env.MONITOR985_HYBRID_PREFLIGHT_LIMIT, 100);
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

function xTranslationBackfillLimit() {
  const parsed = Number(process.env.X_TRANSLATION_BACKFILL_LIMIT || "100");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

async function translateXFeedItem(feedItem) {
  return ensureXFeedItemTranslation(feedItem, {
    enabled: isXTranslationEnabled(),
    targetLanguage: getXTranslationTarget(),
    cacheNamespace: "x-hybrid",
  });
}

async function backfillMissingXTranslations(limit = xTranslationBackfillLimit()) {
  await runXTranslationBackfill({
    limit,
    enabled: isXTranslationEnabled(),
    targetLanguage: getXTranslationTarget(),
    cacheNamespace: "x-pipeline",
    log,
  });
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
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

async function fetchMonitor985Json(path) {
  const response = await fetch(
    buildMonitor985RequestUrl(path, getMonitor985BaseUrl()),
    {
      cache: "no-store",
      headers: buildMonitor985RequestHeaders(),
    },
  );
  if (!response.ok) {
    throw new Error(`985monitor HTTP ${response.status}`);
  }
  return response.json();
}

async function syncConfiguredAccounts() {
  const runtimeConfig = await readRuntimeConfigFile();
  const localAccounts = getXPipelineConfiguredAccounts(runtimeConfig);
  const truthAccounts = getXPipelineConfiguredTruthAccounts();
  let remoteAccounts = [];

  if (describeMonitor985AuthMode() !== "public") {
    try {
      const payload = await fetchMonitor985Json("/api/watch-config");
      remoteAccounts = toMonitor985XPipelineAccounts(
        parseMonitor985WatchConfig(payload),
      );
    } catch (error) {
      log("x_hybrid_watch_config_sync_failed", {
        error: String(error),
        fallback: "local",
      });
    }
  }

  const { accounts, allowedAccountKeys, ignoredRemoteAccounts } =
    resolveMonitor985AcceptedAccounts({
      localAccounts,
      truthAccounts,
      remoteAccounts,
    });

  for (const account of accounts) {
    upsertXPipelineAccount(account);
  }
  disableXPipelineAccountsExcept(accounts.map((account) => account.username));
  if (ignoredRemoteAccounts.length > 0) {
    log("x_hybrid_remote_accounts_ignored", {
      count: ignoredRemoteAccounts.length,
      sample: ignoredRemoteAccounts.slice(0, 5).map((account) => account.username),
    });
  }
  return {
    accounts,
    source: "local-site",
    ignoredRemoteCount: ignoredRemoteAccounts.length,
    allowedAccountKeys,
  };
}

function makeSyntheticFeedItem(candidate) {
  const username = candidate.username || "6551monitor";
  const id = candidate.tweetId || candidate.sourceId;
  return {
    id,
    text: candidate.summary || "6551 Telegram monitor detected a new X post.",
    createdAt: candidate.createdAt,
    username,
    displayName: username,
    profileUrl: `https://x.com/${username}`,
    userAvatar: `https://unavatar.io/twitter/${username}`,
    tweetUrl: candidate.tweetUrl || candidate.messageUrl,
    hashtags: [],
    likes: 0,
    retweets: 0,
    replies: 0,
    quotes: 0,
    views: 0,
    media: [],
    quotedTweet: null,
    origin: "watch",
    queryLabel: "Telegram trigger",
    translation: null,
  };
}

async function runMonitor985PreflightCatchup(allowedAccountKeys) {
  const limit = getMonitor985HybridPreflightLimit();
  const payloads = await Promise.all([
    fetchMonitor985Json(`/api/twitter-live-events?limit=${limit}`),
    fetchMonitor985Json(`/api/truth-social-events?limit=${limit}`),
  ]);
  const events = payloads.flatMap((payload) => extractMonitor985Events(payload));
  let accepted = 0;
  let ignored = 0;

  for (const rawEvent of events.slice().reverse()) {
    let update = normalizeMonitor985Event(rawEvent);
    if (
      !update ||
      !shouldAcceptMonitor985Account(update.account, allowedAccountKeys)
    ) {
      ignored += 1;
      continue;
    }
    if (shouldRefreshMonitor985FeedItem(update.feedItem)) {
      try {
        update = mergeFullTweetIntoMonitor985Update(
          update,
          await get6551TwitterTweetById(update.feedItem.id),
        );
      } catch (error) {
        log("x_hybrid_monitor985_full_tweet_refresh_failed", {
          tweetId: update.feedItem.id,
          error: String(error),
        });
      }
    }
    upsertXPipelineRealtimeUpdate({
      ...update,
      remark: "985monitor",
      feedItem: {
        ...update.feedItem,
        queryLabel: update.feedItem.queryLabel || "985monitor",
      },
    });
    accepted += 1;
  }

  const detail = `985 preflight before 6551: wrote ${accepted}, ignored ${ignored}, fetched ${events.length}`;
  setXPipelineHealth({
    scope: "collector",
    status: "live",
    detail,
  });
  log("x_hybrid_985_preflight", {
    limit,
    fetched: events.length,
    accepted,
    ignored,
  });
  return {
    checkedAt: getXPipelineHealth("collector")?.updatedAt ?? new Date().toISOString(),
    detail,
  };
}

async function resolveQuotedTweet(feedItem) {
  const result = await resolveHybridQuotedTweet(feedItem, {
    getFeedItem: getXPipelineFeedItem,
    getQuotedTweet: getXPipelineQuotedTweet,
    saveQuotedTweet: upsertXPipelineQuotedTweet,
    reservePoints: (tweetId) =>
      reserveXApiPoints({
        kind: "tweet_by_id",
        detail: `quoted-tweet ${tweetId}`,
      }),
    fetchTweetById: get6551TwitterTweetById,
    log,
  });
  return result.feedItem;
}

function sourceId(row) {
  return `telegram:${row.channel_id}:${row.message_id}`;
}

function toCandidateInput(row) {
  return {
    sourceId: sourceId(row),
    messageUrl: stringValue(row.message_url),
    text: stringValue(row.text),
    createdAt: stringValue(row.created_at),
    raw: parseJsonObject(row.raw_json),
  };
}

function recentTelegramMessages(db, cutoffIso, limit) {
  const keys = getTelegramXSourceChannelKeys();
  const rows = db
    .prepare(
      `
      select *
      from telegram_messages
      where created_at >= ?
      order by created_at desc, message_id desc
    `,
    )
    .all(cutoffIso);
  return selectTelegramXSourceRows(
    rows.map((row) => ({
      ...row,
      ref: row.channel_ref,
      username: row.channel_username,
      channelId: row.channel_id,
      title: row.channel_title,
    })),
    keys,
    limit,
  );
}

function pendingTelegramMessages(
  db,
  cutoffIso,
  scanLimit,
  batchLimit,
  retryErrors,
  pendingRetryMs,
  nowMs,
) {
  return recentTelegramMessages(db, cutoffIso, scanLimit)
    .filter((row) => {
      const status = getXHybridSourceStatus(sourceId(row));
      if (
        shouldProcessXHybridSourceStatus(status, {
          retryErrors,
          pendingRetryMs,
          nowMs,
        })
      ) {
        return true;
      }
      const candidate = parseXHybridTelegramCandidate(toCandidateInput(row));
      return shouldProcessXHybridSourceStatus(status, {
        retryErrors,
        candidateTweetId: candidate?.tweetId ?? null,
        pendingRetryMs,
        nowMs,
      });
    })
    .slice(0, batchLimit);
}

function hasPendingTelegramBacklog(db, cutoffIso, scanLimit) {
  return recentTelegramMessages(db, cutoffIso, scanLimit).some((row) => {
    const status = getXHybridSourceStatus(sourceId(row));
    return !status || status.status === "pending";
  });
}

async function enrichCandidate(
  candidate,
  fetchLimit,
  accountCooldownMs,
  enrichmentMode,
) {
  if (!candidate.username) {
    return {
      feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
      status: "fallback",
      detail: "no username in telegram message",
    };
  }

  if (enrichmentMode === "telegram-only") {
    return {
      feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
      status: "fallback",
      detail: "api enrichment disabled; used telegram trigger",
    };
  }

  if (enrichmentMode === "tweet-id") {
    if (!candidate.tweetId) {
      return {
        feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
        status: "fallback",
        detail: "tweet-id mode skipped: no tweet id in telegram trigger",
      };
    }

    const cachedTweet = getXPipelineFeedItem(candidate.tweetId);
    if (isFullTweetByIdCacheHit(cachedTweet, candidate.tweetId)) {
      return {
        feedItem: cachedTweet,
        status: "enriched",
        detail: `tweet-id cache hit ${candidate.tweetId}`,
        queryLabel: "Telegram trigger / full",
      };
    }

    const reservation = reserveXApiPoints({
      kind: "tweet_by_id",
      detail: `tweet-id ${candidate.tweetId}`,
    });
    if (!reservation.allowed) {
      return {
        feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
        status: "pending",
        detail: `${reservation.reason}; authorization required`,
        queryLabel: "Telegram trigger / pending",
      };
    }

    try {
      const tweet = await get6551TwitterTweetById(candidate.tweetId);
      if (tweet) {
        return {
          feedItem: tweet,
          status: "enriched",
          detail: `tweet-id ${candidate.tweetId}`,
          queryLabel: "Telegram trigger / full",
        };
      }
    } catch (error) {
      if (isRetryableXHybridFetchError(error)) {
        return {
          feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
          status: "pending",
          detail: `tweet-id fetch rate limited for ${candidate.tweetId}: ${String(error)}`,
          queryLabel: "Telegram trigger / pending",
        };
      }
      return {
        feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
        status: "fallback",
        detail: `tweet-id fetch failed for ${candidate.tweetId}: ${String(error)}`,
      };
    }

    return {
      feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
      status: "fallback",
      detail: `tweet-id fetch returned empty for ${candidate.tweetId}`,
    };
  }

  const fetchStatus = getXHybridAccountFetchStatus(candidate.username, {
    cooldownMs: accountCooldownMs,
  });
  if (fetchStatus.isCoolingDown) {
    return {
      feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
      status: "cooldown",
      detail: `account cooldown until ${fetchStatus.nextAllowedAt}`,
    };
  }

  try {
    const reservation = reserveXApiPoints({
      kind: "user_tweets",
      detail: `@${candidate.username}`,
    });
    if (!reservation.allowed) {
      return {
        feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
        status: "pending",
        detail: `${reservation.reason}; authorization required`,
        queryLabel: "Telegram trigger / pending",
      };
    }

    markXHybridAccountFetched(candidate.username);
    const tweets = await get6551TwitterUserTweets(candidate.username, fetchLimit);
    const matched = selectBestTweetMatch(candidate, tweets);
    if (matched) {
      return {
        feedItem: await translateXFeedItem(matched),
        status: "enriched",
        detail: `matched @${candidate.username}`,
      };
    }
  } catch (error) {
    return {
      feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
      status: "fallback",
      detail: `tweet fetch failed for @${candidate.username}: ${String(error)}`,
    };
  }

  return {
    feedItem: await translateXFeedItem(makeSyntheticFeedItem(candidate)),
    status: "fallback",
    detail: `no matching tweet found for @${candidate.username}`,
  };
}

function hybridQueryLabel(status) {
  if (status === "enriched") return "Telegram trigger / enriched";
  if (status === "pending") return "Telegram trigger / pending";
  if (status === "cooldown") return "Telegram trigger / cooldown";
  return "Telegram trigger / fallback";
}

async function processRow(
  row,
  fetchLimit,
  accountCooldownMs,
  enrichmentMode,
  retryErrors,
  allowedAccountKeys,
  confirmPrimaryMiss,
  pendingRetryMs,
  nowMs,
) {
  const id = sourceId(row);
  const status = getXHybridSourceStatus(id);

  const candidate = parseXHybridTelegramCandidate(toCandidateInput(row));
  if (!candidate) {
    if (shouldProcessXHybridSourceStatus(status, { retryErrors })) {
      markXHybridSource({
        sourceId: id,
        status: "ignored",
        detail: "no tweet candidate",
        tweetId: null,
      });
    }
    return false;
  }

  if (
    !shouldProcessXHybridSourceStatus(status, {
      retryErrors,
      candidateTweetId: candidate.tweetId,
      pendingRetryMs,
      nowMs,
    })
  ) {
    return false;
  }

  if (!shouldAcceptMonitor985Account(candidate.username, allowedAccountKeys)) {
    markXHybridSource({
      sourceId: id,
      status: "ignored",
      detail: `x account not configured: @${candidate.username || "unknown"}`,
      tweetId: candidate.tweetId || null,
    });
    return false;
  }

  if (candidate.tweetId) {
    const confirmation = await confirmPrimaryMiss({
      item: { sourceId: id },
      tweetId: candidate.tweetId,
      sourceCreatedAt: candidate.createdAt,
    });
    if (confirmation.skippedExisting.length > 0) {
      markXHybridSource({
        sourceId: id,
        status: "ignored",
        detail: confirmation.refreshAttempted
          ? "tweet present after 985 primary refresh; skipped 6551 fallback"
          : "tweet already present before 6551 fallback",
        tweetId: candidate.tweetId,
      });
      return false;
    }
    if (confirmation.pending.length > 0 || confirmation.ready.length === 0) {
      const pending = confirmation.pending[0];
      markXHybridSource({
        sourceId: id,
        status: "pending",
        detail: pending?.detail || "waiting for 985 primary feed preflight",
        tweetId: candidate.tweetId,
      });
      return false;
    }
  }

  try {
    const enriched = await enrichCandidate(
      candidate,
      fetchLimit,
      accountCooldownMs,
      enrichmentMode,
    );
    const feedItem = await resolveQuotedTweet(enriched.feedItem);
    upsertXPipelineRealtimeUpdate({
      eventType: "TG_HYBRID",
      account: feedItem.username,
      displayName: feedItem.displayName,
      createdAt: feedItem.createdAt,
      profileUrl: feedItem.profileUrl,
      remark: candidate.messageUrl,
      feedItem: {
        ...feedItem,
        queryLabel: enriched.queryLabel || hybridQueryLabel(enriched.status),
      },
    });
    markXHybridSource({
      sourceId: id,
      status: enriched.status,
      detail: enriched.detail,
      tweetId: enriched.feedItem.id,
    });
    log("x_hybrid_message_processed", {
      sourceId: id,
      status: enriched.status,
      mode: enrichmentMode,
      username: feedItem.username,
      tweetId: feedItem.id,
      quotedTweetId: feedItem.quotedTweet?.id || null,
    });
    return true;
  } catch (error) {
    markXHybridSource({
      sourceId: id,
      status: "error",
      detail: String(error),
      tweetId: candidate.tweetId,
    });
    log("x_hybrid_message_failed", { sourceId: id, error: String(error) });
    return false;
  }
}

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  const once = process.argv.includes("--once");
  if (!isXHybridEnabled()) {
    setXPipelineHealth({
      scope: "hybrid",
      status: "paused",
      detail: "X_HYBRID_ENABLED is false; 6551 fallback is paused",
    });
    log("x_hybrid_paused");
    return;
  }

  const intervalMs = positiveInt(process.env.X_HYBRID_INTERVAL_MS, 15_000);
  const lookbackMs = positiveInt(process.env.X_HYBRID_LOOKBACK_MS, 5 * 60_000);
  const catchupLookbackMs = positiveInt(
    process.env.X_HYBRID_CATCHUP_LOOKBACK_MS,
    24 * 60 * 60_000,
  );
  const recoveryLookbackMs = getXHybridRecoveryLookbackMs(process.env);
  const recoveryGapMs = getXHybridRecoveryGapMs(process.env);
  const batchLimit = positiveInt(process.env.X_HYBRID_BATCH_LIMIT, 20);
  const scanLimit = positiveInt(
    process.env.X_HYBRID_SCAN_LIMIT,
    Math.max(1000, batchLimit * 50),
  );
  const fetchLimit = positiveInt(process.env.X_HYBRID_FETCH_TWEETS_PER_ACCOUNT, 3);
  const accountCooldownMs = positiveInt(
    process.env.X_HYBRID_ACCOUNT_COOLDOWN_MS,
    30 * 60_000,
  );
  const rowDelayMs = positiveInt(process.env.X_HYBRID_ROW_DELAY_MS, 0);
  const retryErrors = boolEnabled(process.env.X_HYBRID_RETRY_ERRORS);
  const pendingRetryMs = positiveInt(
    process.env.X_HYBRID_PENDING_RETRY_MS,
    5 * 60_000,
  );
  const healthScope = getHealthScope();
  const enrichmentMode = getXHybridEnrichmentMode();
  const graceDelayMs = get985GraceDelayMs();
  const telegramDb = new DatabaseSync(getTelegramPipelineConfig().dbPath, {
    readOnly: true,
  });
  let tickInFlight = false;
  let lastTickFinishedAtMs = null;

  const tick = async () => {
    const { accounts, source, allowedAccountKeys } = await syncConfiguredAccounts();
    const nowMs = Date.now();
    const activeWindow = getXHybridEffectiveLookbackMs({
      normalLookbackMs: catchupLookbackMs,
      recoveryLookbackMs,
      recoveryGapMs,
      lastTickFinishedAtMs,
      nowMs,
    });
    if (activeWindow.recovery) {
      log("x_hybrid_recovery_window", {
        normalLookbackMs: catchupLookbackMs,
        recoveryLookbackMs,
        recoveryGapMs,
        lastTickFinishedAt: lastTickFinishedAtMs
          ? new Date(lastTickFinishedAtMs).toISOString()
          : null,
      });
    }
    const cutoffIso = new Date(nowMs - activeWindow.lookbackMs).toISOString();
    const rows = pendingTelegramMessages(
      telegramDb,
      cutoffIso,
      scanLimit,
      batchLimit,
      retryErrors,
      pendingRetryMs,
      nowMs,
    );
    const primaryCheckedAt = getXPipelineHealth("collector")?.updatedAt ?? null;
    let primaryRefreshPromise = null;
    const confirmPrimaryMiss = (candidate) =>
      confirmXHybridPrimaryMisses({
        candidates: [candidate],
        primaryCheckedAt,
        delayMs: graceDelayMs,
        getExistingTweet: getXPipelineFeedItem,
        refreshPrimary: () => {
          if (!primaryRefreshPromise) {
            primaryRefreshPromise = runMonitor985PreflightCatchup(allowedAccountKeys);
          }
          return primaryRefreshPromise;
        },
      });
    let processed = 0;
    setXPipelineHealth({
      scope: healthScope,
      status: "connecting",
      detail: `hybrid worker processing ${rows.length} pending telegram trigger messages for ${accounts.length} configured accounts`,
    });
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (
        await processRow(
          row,
          fetchLimit,
          accountCooldownMs,
          enrichmentMode,
          retryErrors,
          allowedAccountKeys,
          confirmPrimaryMiss,
          pendingRetryMs,
          nowMs,
        )
      ) {
        processed += 1;
      }
      if (rowDelayMs > 0 && index < rows.length - 1) {
        await sleep(rowDelayMs);
      }
    }
    setXPipelineHealth({
      scope: healthScope,
      status: "live",
      detail: `hybrid worker checked ${rows.length} pending telegram trigger messages from ${source} account list; window ${Math.round(activeWindow.lookbackMs / 60_000)}m${activeWindow.recovery ? " recovery" : ""}`,
    });
    if (processed > 0 || once) {
      log("x_hybrid_tick", { checked: rows.length, processed });
    }
    if (processed > 0 || once) {
      void backfillMissingXTranslations().catch((error) => {
        log("x_translation_backfill_failed", { error: String(error) });
      });
    }
    return {
      recovery: activeWindow.recovery,
      checkedRows: rows.length,
      hasPendingBacklog: activeWindow.recovery
        ? hasPendingTelegramBacklog(telegramDb, cutoffIso, scanLimit)
        : false,
    };
  };

  const runTick = async () => {
    if (tickInFlight) {
      log("x_hybrid_tick_skipped", { reason: "previous tick still running" });
      return;
    }
    tickInFlight = true;
    let completed = false;
    let keepRecovery = false;
    try {
      const result = await tick();
      keepRecovery = shouldKeepXHybridRecoveryWindow({
        recovery: result.recovery,
        checkedRows: result.checkedRows,
        batchLimit,
        hasPendingBacklog: result.hasPendingBacklog,
      });
      completed = true;
    } finally {
      if (completed && !keepRecovery) {
        lastTickFinishedAtMs = Date.now();
      }
      tickInFlight = false;
    }
  };

  await runTick();
  void backfillMissingXTranslations().catch((error) => {
    log("x_translation_backfill_failed", { error: String(error) });
  });
  if (once) return;

  setInterval(() => {
    void runTick().catch((error) => {
      setXPipelineHealth({
        scope: healthScope,
        status: "error",
        detail: String(error),
      });
      log("x_hybrid_tick_failed", { error: String(error) });
    });
  }, intervalMs);

  log("x_hybrid_worker_started", {
    intervalMs,
    lookbackMs,
    catchupLookbackMs,
    batchLimit,
    scanLimit,
    fetchLimit,
    accountCooldownMs,
    rowDelayMs,
    retryErrors,
    pendingRetryMs,
    healthScope,
    enrichmentMode,
    graceDelayMs,
    recoveryLookbackMs,
    recoveryGapMs,
  });
}

main().catch((error) => {
  setXPipelineHealth({
    scope: getHealthScope(),
    status: "error",
    detail: String(error),
  });
  log("x_hybrid_worker_failed", { error: String(error) });
  process.exit(1);
});
