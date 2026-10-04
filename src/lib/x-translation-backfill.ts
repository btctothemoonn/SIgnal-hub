import type { TwitterFeedItem, TwitterQuotedTweet } from "./6551-twitter.ts";
import { randomUUID } from "node:crypto";
import {
  X_FEED_TRANSLATION_BASE,
  xFeedTranslationSnapshot,
  mergeXFeedItems,
  mergeXQuotedTweet,
} from "./x-feed-merge.ts";
import {
  isUsefulTranslation,
  translateText,
  type TranslationNote,
} from "./translate.ts";
import {
  getXPipelineDb,
  acquireXPipelineTranslationLease,
  releaseXPipelineTranslationLease,
  getXPipelineFeedItem,
  getXPipelineQuotedTweet,
  listXPipelineTranslationCandidates,
  setXPipelineFeedTranslation,
} from "./x-pipeline-store.ts";

type DbLike = Parameters<typeof listXPipelineTranslationCandidates>[1];

export type XTranslationBackfillStats = {
  checked: number;
  attempted: number;
  translated: number;
  skippedCooldown: number;
  failed: number;
};

type XTranslationOptions = {
  enabled?: boolean;
  targetLanguage?: string;
  cacheNamespace?: string;
  db?: DbLike;
  leaseTtlMs?: number;
};

type XTranslationBackfillOptions = XTranslationOptions & {
  limit?: number;
  retryCooldownMs?: number;
  db?: DbLike;
  log?: (event: string, data?: Record<string, unknown>) => void;
};

const failedTranslationCooldowns = new Map<string, number>();
const inFlightTranslationIds = new Set<string>();

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultXTranslationEnabled() {
  const raw = process.env.TWITTER_TRANSLATE_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

function defaultXTranslationTarget() {
  return (
    process.env.TWITTER_TRANSLATE_TARGET?.trim() ||
    process.env.TELEGRAM_TRANSLATE_TARGET?.trim() ||
    "zh-CN"
  );
}

function defaultBackfillLimit() {
  return positiveInt(process.env.X_TRANSLATION_BACKFILL_LIMIT, 100);
}

function defaultRetryCooldownMs() {
  return positiveInt(process.env.X_TRANSLATION_RETRY_COOLDOWN_MS, 5 * 60_000);
}

async function translateXText(
  text: string,
  options: XTranslationOptions = {},
): Promise<TranslationNote | null> {
  return translateText(text, {
    enabled: options.enabled ?? defaultXTranslationEnabled(),
    targetLanguage: options.targetLanguage ?? defaultXTranslationTarget(),
    cacheNamespace: options.cacheNamespace ?? "x-pipeline",
  });
}

async function ensureQuotedTweetTranslation(
  quotedTweet: TwitterQuotedTweet | null,
  options: XTranslationOptions,
) {
  if (!quotedTweet?.text?.trim()) return quotedTweet;
  if (isUsefulTranslation(quotedTweet.text, quotedTweet.translation)) {
    return quotedTweet;
  }

  const translation = await translateXText(quotedTweet.text, options);
  return translation
    ? {
        ...quotedTweet,
        translation,
      }
    : quotedTweet;
}

async function translateFeedItem<T extends TwitterFeedItem>(
  feedItem: T,
  options: XTranslationOptions = {},
): Promise<T> {
  const [translation, quotedTweet] = await Promise.all([
    isUsefulTranslation(feedItem.text, feedItem.translation)
      ? Promise.resolve(feedItem.translation)
      : translateXText(feedItem.text, options),
    ensureQuotedTweetTranslation(feedItem.quotedTweet, options),
  ]);

  if (translation === feedItem.translation && quotedTweet === feedItem.quotedTweet) {
    return feedItem;
  }

  return {
    ...feedItem,
    translation,
    quotedTweet,
  };
}

export async function ensureXFeedItemTranslation<T extends TwitterFeedItem>(
  feedItem: T,
  options: XTranslationOptions = {},
): Promise<T> {
  if (isUsefulTranslation(feedItem.text, feedItem.translation) &&
      (!feedItem.quotedTweet?.text || isUsefulTranslation(feedItem.quotedTweet.text, feedItem.quotedTweet.translation))) return feedItem;
  const db = options.db ?? getXPipelineDb();
  const owner = randomUUID();
  if (!acquireXPipelineTranslationLease(feedItem.id, owner, { db, ttlMs: options.leaseTtlMs })) return feedItem;
  let handedOff = false;
  try {
    const persisted = getXPipelineFeedItem(feedItem.id, db);
    const prospective = mergeXFeedItems(persisted, feedItem);
    // Ignore a partial/replayed observation before paying for text the merge
    // would discard. The caller still upserts the observation normally.
    if (prospective.text !== feedItem.text) return feedItem;
    const quotedCache = prospective.quotedTweet ? getXPipelineQuotedTweet(prospective.quotedTweet.id, db) : null;
    if (quotedCache && prospective.quotedTweet) {
      const inputQuote = prospective.quotedTweet;
      const repeatsStoredQuote = persisted?.quotedTweet?.id === inputQuote.id && persisted.quotedTweet.text === inputQuote.text;
      const resolved = repeatsStoredQuote ? mergeXQuotedTweet(inputQuote, quotedCache) : mergeXQuotedTweet(quotedCache, inputQuote);
      prospective.quotedTweet = resolved ? { ...resolved, relation: inputQuote.relation } : null;
    }
    const translated = await translateFeedItem({ ...feedItem,
      translation: prospective.translation, quotedTweet: prospective.quotedTweet,
    }, options);
    Object.defineProperty(translated, X_FEED_TRANSLATION_BASE, {
      value: { original: persisted ? xFeedTranslationSnapshot(persisted) : null, leaseOwner: owner,
        quotedCacheOriginal: quotedCache ? { id: quotedCache.id, text: quotedCache.text } : null },
      // Symbol keys survive object spread but are never encoded into feed JSON.
      enumerable: true,
    });
    // The eventual feed upsert releases this owner after its commit; if the
    // caller exits first the TTL recovers the lease without duplicate requests.
    handedOff = true;
    return translated;
  } finally {
    if (!handedOff) releaseXPipelineTranslationLease(feedItem.id, owner, db);
  }
}

export async function backfillMissingXTranslations(
  options: XTranslationBackfillOptions = {},
): Promise<XTranslationBackfillStats> {
  const db = options.db ?? getXPipelineDb();
  const limit = options.limit ?? defaultBackfillLimit();
  const retryCooldownMs = options.retryCooldownMs ?? defaultRetryCooldownMs();
  const candidates = listXPipelineTranslationCandidates(limit, db);
  const now = Date.now();
  const stats: XTranslationBackfillStats = {
    checked: candidates.length,
    attempted: 0,
    translated: 0,
    skippedCooldown: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    const cooldownUntil = failedTranslationCooldowns.get(candidate.id) ?? 0;
    if (cooldownUntil > now || inFlightTranslationIds.has(candidate.id)) {
      stats.skippedCooldown += 1;
      continue;
    }

    const owner = randomUUID();
    if (!acquireXPipelineTranslationLease(candidate.id, owner, { db, ttlMs: options.leaseTtlMs })) {
      stats.skippedCooldown += 1;
      continue;
    }

    inFlightTranslationIds.add(candidate.id);
    stats.attempted += 1;
    try {
      const feedItem = getXPipelineFeedItem(candidate.id, db);
      const translatedFeedItem = feedItem
        ? await translateFeedItem(feedItem, options)
        : null;
      if (
        translatedFeedItem &&
        feedItem &&
        (translatedFeedItem.translation !== feedItem.translation ||
          translatedFeedItem.quotedTweet !== feedItem.quotedTweet)
      ) {
        const accepted = setXPipelineFeedTranslation(
          candidate.id,
          translatedFeedItem.translation,
          db,
          translatedFeedItem.quotedTweet,
          xFeedTranslationSnapshot(feedItem),
        );
        failedTranslationCooldowns.delete(candidate.id);
        if (accepted) stats.translated += 1;
      } else {
        failedTranslationCooldowns.set(candidate.id, Date.now() + retryCooldownMs);
        stats.failed += 1;
      }
    } catch {
      failedTranslationCooldowns.set(candidate.id, Date.now() + retryCooldownMs);
      stats.failed += 1;
    } finally {
      inFlightTranslationIds.delete(candidate.id);
      releaseXPipelineTranslationLease(candidate.id, owner, db);
    }
  }

  if (stats.attempted > 0 || stats.skippedCooldown > 0) {
    options.log?.("x_translation_backfill", stats);
  }

  return stats;
}
