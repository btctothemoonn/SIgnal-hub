import type { TwitterFeedItem, TwitterQuotedTweet } from "./6551-twitter.ts";
import { isUsefulTranslation } from "./translation-quality.ts";

export type XFeedTranslationSnapshot = {
  text: string;
  quotedTweet: Pick<TwitterQuotedTweet, "id" | "text" | "relation"> | null;
};

// Kept off JSON and the public feed; ingestion uses this when translation awaited
// an API before the eventual upsert. Backfill uses the explicit CAS API instead.
export const X_FEED_TRANSLATION_BASE = Symbol.for("signal-hub.x-feed-translation-base");
export type XFeedTranslationBase = {
  original: XFeedTranslationSnapshot | null;
  leaseOwner: string;
  quotedCacheOriginal?: Pick<TwitterQuotedTweet, "id" | "text"> | null;
};
export type XFeedWithTranslationBase = TwitterFeedItem & {
  [X_FEED_TRANSLATION_BASE]?: XFeedTranslationBase;
};

export function xFeedTranslationSnapshot(item: TwitterFeedItem): XFeedTranslationSnapshot {
  return {
    text: item.text,
    quotedTweet: item.quotedTweet ? {
      id: item.quotedTweet.id, text: item.quotedTweet.text,
      relation: item.quotedTweet.relation ?? "quote",
    } : null,
  };
}

export function matchesXFeedTranslationSnapshot(item: TwitterFeedItem, expected: XFeedTranslationSnapshot): boolean {
  return item.text === expected.text &&
    (item.quotedTweet?.id ?? null) === (expected.quotedTweet?.id ?? null) &&
    (item.quotedTweet?.text ?? null) === (expected.quotedTweet?.text ?? null) &&
    (item.quotedTweet ? item.quotedTweet.relation ?? "quote" : null) ===
      (expected.quotedTweet ? expected.quotedTweet.relation ?? "quote" : null);
}

export function isStaleXFeedTranslation(existing: TwitterFeedItem | null, input: XFeedWithTranslationBase): boolean {
  if (!existing || !input[X_FEED_TRANSLATION_BASE]) return false;
  const original = input[X_FEED_TRANSLATION_BASE].original;
  return !matchesXFeedTranslationSnapshot(existing, original ?? xFeedTranslationSnapshot(input));
}

export function isStaleXQuotedTranslationCache(input: XFeedWithTranslationBase, cached: TwitterQuotedTweet | null): boolean {
  const base = input[X_FEED_TRANSLATION_BASE];
  if (!base || !input.quotedTweet || !cached) return false;
  const originalQuote = base.original?.quotedTweet;
  const expected = base.quotedCacheOriginal !== undefined ? base.quotedCacheOriginal
    : originalQuote?.id === input.quotedTweet.id ? originalQuote : input.quotedTweet;
  const baseline = expected ?? input.quotedTweet;
  return cached.id !== baseline.id || cached.text !== baseline.text;
}

export function xFeedObservationSource(item: TwitterFeedItem): string {
  if (/^985monitor\s*\//i.test(item.queryLabel)) return "monitor985";
  if (/^owned-reader\s*\//i.test(item.queryLabel)) return "owned-reader";
  if (/^Telegram trigger\s*\//i.test(item.queryLabel)) return "telegram";
  return item.contentSource || "6551";
}

export function withXFeedContentMetadata(item: TwitterFeedItem): TwitterFeedItem {
  return {
    ...item,
    contentSource: item.contentSource ||
      (/^Telegram trigger\s*\/\s*full/i.test(item.queryLabel) ? "6551" : xFeedObservationSource(item)),
    contentComplete: item.contentComplete ??
      (/^(?:owned-reader|Telegram trigger)\s*\/\s*full/i.test(item.queryLabel) ? true : undefined),
  };
}

function completeness(item: { contentComplete?: boolean }): number {
  return item.contentComplete === true ? 2 : item.contentComplete === false ? 0 : 1;
}

function compareRevision(incoming?: string, existing?: string): number | null {
  if (!incoming || !existing) return null;
  if (incoming === existing) return 0;
  if (/^\d+$/.test(incoming) && /^\d+$/.test(existing)) {
    return BigInt(incoming) > BigInt(existing) ? 1 : -1;
  }
  // Only an explicit, parseable timestamp or a numeric upstream revision proves
  // order. Arbitrary labels and arrival time are not edit evidence.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(incoming) || !/^\d{4}-\d{2}-\d{2}T/.test(existing)) return null;
  const left = Date.parse(incoming); const right = Date.parse(existing);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.sign(left - right) : null;
}

function usefulTranslation(item: Pick<TwitterFeedItem, "text" | "translation">) {
  return isUsefulTranslation(item.text, item.translation) ? item.translation : null;
}

function isCarriedTranslation(existing: Pick<TwitterFeedItem, "text" | "translation">, incoming: Pick<TwitterFeedItem, "text" | "translation">): boolean {
  return existing.text !== incoming.text && Boolean(existing.translation?.text) &&
    existing.translation?.text === incoming.translation?.text;
}

export function mergeXQuotedTweet(
  existing: TwitterQuotedTweet | null,
  incoming: TwitterQuotedTweet | null,
  retainOriginal = false,
): TwitterQuotedTweet | null {
  if (!incoming) return existing;
  if (!incoming.text.trim() && !incoming.media?.length) return existing
    ? { ...existing, relation: incoming.relation ?? existing.relation } : null;
  if (!existing) return { ...incoming, translation: usefulTranslation(incoming) };
  // The root's retained relationship can protect a different quote ID. The
  // content of the same referenced post has its own independent edit evidence.
  if (retainOriginal && existing.id !== incoming.id) return existing;
  if (existing.id !== incoming.id) return { ...incoming, translation: usefulTranslation(incoming) };
  const rank = completeness(incoming) - completeness(existing);
  const revision = compareRevision(incoming.contentVersion, existing.contentVersion);
  const sameText = incoming.text === existing.text;
  const keepBody = !incoming.text.trim() || rank < 0 || revision === -1 ||
    (!sameText && rank <= 0 && revision !== 1 &&
      (existing.contentComplete === true && incoming.contentSource !== "monitor985" ||
       existing.contentSource === "monitor985" && incoming.contentSource !== "monitor985"));
  const body = keepBody ? existing : incoming;
  const text = body.text;
  const incomingTranslation = isCarriedTranslation(existing, { text, translation: incoming.translation }) ? null : incoming.translation;
  const canReplaceMedia = incoming.contentComplete === true && (revision === 1 || rank > 0);
  const media = revision === -1 || !incoming.media?.length ? existing.media
    : canReplaceMedia ? incoming.media
    : [...existing.media, ...incoming.media.filter((candidate) => !existing.media.some((saved) => saved.previewUrl === candidate.previewUrl))];
  return {
    ...existing, ...incoming, text,
    contentSource: body.contentSource ?? (sameText ? existing.contentSource : undefined),
    contentComplete: body.contentComplete ?? (sameText ? existing.contentComplete : undefined),
    contentVersion: body.contentVersion ?? (sameText ? existing.contentVersion : undefined),
    media,
    userAvatar: !incoming.userAvatar || /unavatar\.io\/(?:twitter|x)\//i.test(incoming.userAvatar)
      ? existing.userAvatar || incoming.userAvatar : incoming.userAvatar,
    translation: (text === incoming.text && usefulTranslation({ text, translation: incomingTranslation })) ||
      (text === existing.text ? usefulTranslation(existing) : null),
  };
}

export function mergeXFeedItems(existing: TwitterFeedItem | null, input: XFeedWithTranslationBase): TwitterFeedItem {
  const incoming = withXFeedContentMetadata(input);
  if (!existing) return { ...incoming, translation: usefulTranslation(incoming) };
  const prior = withXFeedContentMetadata(existing);
  const rank = completeness(incoming) - completeness(prior);
  const revision = compareRevision(incoming.contentVersion, prior.contentVersion);
  const staleTranslation = isStaleXFeedTranslation(prior, input);
  const sameText = incoming.text === prior.text;
  let retainOriginal = staleTranslation || rank < 0 || revision === -1;
  if (!retainOriginal && !sameText && revision !== 1 && rank <= 0) {
    retainOriginal = prior.contentSource === "monitor985" && incoming.contentSource !== "monitor985" ||
      (prior.contentComplete === true && incoming.contentSource !== "monitor985");
  }
  // A partial observation cannot supersede a complete body even if it carries a
  // newer edit marker. A subsequent complete read may safely apply that edit.
  const body = retainOriginal ? prior : incoming;
  const text = body.text;
  const quotedTweet = staleTranslation ? prior.quotedTweet
    : mergeXQuotedTweet(prior.quotedTweet, incoming.quotedTweet, retainOriginal);
  const incomingTranslation = isCarriedTranslation(prior, incoming) ? null : incoming.translation;
  const media = staleTranslation || revision === -1 ? prior.media : retainOriginal
    ? [...prior.media, ...incoming.media.filter((candidate) => !prior.media.some((saved) => saved.previewUrl === candidate.previewUrl))]
    : incoming.media?.length ? incoming.media : prior.media;
  return {
    ...prior, ...incoming,
    text, contentSource: body.contentSource, contentComplete: body.contentComplete,
    contentVersion: body.contentVersion ?? (sameText ? prior.contentVersion : undefined), queryLabel: body.queryLabel,
    media,
    quotedTweet,
    translation: (!retainOriginal && usefulTranslation({ text: incoming.text, translation: incomingTranslation })) ||
      (text === prior.text ? usefulTranslation(prior) : null),
  };
}
