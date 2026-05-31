import type { TwitterFeedItem, TwitterQuotedTweet } from "./6551-twitter.ts";
import {
  isUsefulTranslation,
  translateText,
  type TranslationNote,
} from "./translate.ts";
import {
  getXPipelineDb,
  getXPipelineFeedItem,
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

export async function ensureXFeedItemTranslation<T extends TwitterFeedItem>(
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

    inFlightTranslationIds.add(candidate.id);
    stats.attempted += 1;
    try {
      const feedItem = getXPipelineFeedItem(candidate.id, db);
      const translatedFeedItem = feedItem
        ? await ensureXFeedItemTranslation(feedItem, options)
        : null;
      if (
        translatedFeedItem &&
        feedItem &&
        (translatedFeedItem.translation !== feedItem.translation ||
          translatedFeedItem.quotedTweet !== feedItem.quotedTweet)
      ) {
        setXPipelineFeedTranslation(
          candidate.id,
          translatedFeedItem.translation,
          db,
          translatedFeedItem.quotedTweet,
        );
        failedTranslationCooldowns.delete(candidate.id);
        stats.translated += 1;
      } else {
        failedTranslationCooldowns.set(candidate.id, Date.now() + retryCooldownMs);
        stats.failed += 1;
      }
    } catch {
      failedTranslationCooldowns.set(candidate.id, Date.now() + retryCooldownMs);
      stats.failed += 1;
    } finally {
      inFlightTranslationIds.delete(candidate.id);
    }
  }

  if (stats.attempted > 0 || stats.skippedCooldown > 0) {
    options.log?.("x_translation_backfill", stats);
  }

  return stats;
}
