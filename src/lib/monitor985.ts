import type {
  TwitterFeedItem,
  TwitterMediaItem,
  TwitterQuotedTweet,
  TwitterRealtimeUpdate,
} from "./6551-twitter.ts";
import type { TranslationNote } from "./translate.ts";
import { isUsefulTranslation } from "./translation-quality.ts";

type JsonRecord = Record<string, unknown>;

type Raw985Tweet = {
  id?: number | string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  favoriteCount?: number | string;
  retweetCount?: number | string;
  replyCount?: number | string;
  quoteCount?: number | string;
  viewCount?: number | string;
  userScreenName?: string;
  screenName?: string;
  username?: string;
  userName?: string;
  name?: string;
  profileUrl?: string;
  webLink?: string;
  source?: string;
  media?: unknown;
  urls?: unknown;
  translation?: unknown;
  quotedStatus?: unknown;
  quoted_status?: unknown;
  quotedTweet?: unknown;
  quoted_tweet?: unknown;
  replyStatus?: unknown;
  reply_status?: unknown;
};

type Raw985Event = {
  key?: string;
  source?: string;
  eventType?: string;
  twAccount?: string;
  createdAt?: string;
  profileUrl?: string;
  content?: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

function normalizeDate(raw: unknown, fallback = ""): string {
  const text = pickString(raw);
  if (!text) return fallback || new Date(0).toISOString();

  const trimmedFraction = text.replace(
    /(\.\d{3})\d+([+-]\d{2}:?\d{2}|Z)$/i,
    "$1$2",
  );
  const parsed = Date.parse(trimmedFraction);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallback || text;
}

function normalizeText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function profileUrlFor(username: string): string {
  return username ? `https://x.com/${username}` : "#";
}

function truthProfileUrlFor(username: string): string {
  return username ? `https://truthsocial.com/@${username}` : "#";
}

function avatarFor(username: string, rawAvatar: unknown): string {
  return pickString(rawAvatar) || (username ? `https://unavatar.io/twitter/${username}` : "");
}

function tweetUrlFor(username: string, id: string): string {
  return username && id ? `https://x.com/${username}/status/${id}` : "#";
}

function normalizeMedia(raw: unknown): TwitterMediaItem[] {
  if (!Array.isArray(raw)) return [];
  const result: TwitterMediaItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const type = pickString(item.type, item.kind).toLowerCase();
    const url = pickString(item.url, item.previewUrl, item.mediaUrlHttps);
    if (!url) continue;
    const kind =
      type === "video" ? "video" : type === "gif" || type === "animated_gif" ? "gif" : "image";
    result.push({
      kind,
      mimeType: pickString(item.mimeType, item.mime_type),
      previewUrl: url,
      label: type || kind,
      width: toNumber(item.width) || null,
      height: toNumber(item.height) || null,
    });
  }
  return result;
}

function normalizeTranslation(
  raw: unknown,
  sourceText: string,
): TranslationNote | null {
  if (!isRecord(raw) || raw.skip === true) return null;
  const text = pickString(raw.zh, raw.text, raw.translation);
  if (!text) return null;
  const note: TranslationNote = {
    provider: "985monitor",
    sourceLanguage: pickString(raw.sourceLanguage, raw.sourceLang) || "auto",
    targetLanguage: pickString(raw.targetLanguage, raw.target) || "zh-CN",
    text,
  };
  return isUsefulTranslation(sourceText, note) ? note : null;
}

function embeddedContextTweet(input: Raw985Tweet): Raw985Tweet | null {
  const candidates = [
    input.quotedStatus,
    input.quoted_status,
    input.quotedTweet,
    input.quoted_tweet,
    input.replyStatus,
    input.reply_status,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate as Raw985Tweet;
  }
  return null;
}

function normalizeQuotedTweet(input: Raw985Tweet): TwitterQuotedTweet | null {
  const embedded = embeddedContextTweet(input);
  if (!embedded) return null;

  const id = pickString(embedded.id);
  const username = sanitizeUsername(
    pickString(embedded.userScreenName, embedded.screenName, embedded.username),
  );
  const text = normalizeText(embedded.fullText) || normalizeText(embedded.text);
  if (!id || !username || !text) return null;

  return {
    id,
    text,
    createdAt: normalizeDate(embedded.createdAt),
    username,
    displayName: pickString(embedded.userName, embedded.name, username),
    profileUrl: profileUrlFor(username),
    userAvatar: avatarFor(username, embedded.profileUrl),
    tweetUrl: tweetUrlFor(username, id),
    media: normalizeMedia(embedded.media),
    translation: normalizeTranslation(embedded.translation, text),
  };
}

function normalizeFeedItem(
  event: Raw985Event,
  content: Raw985Tweet,
): TwitterFeedItem | null {
  const source = pickString(event.source, content.source).toLowerCase();
  const isTruth = source === "truth" || pickString(event.twAccount).toLowerCase().startsWith("truth:");
  const id = pickString(content.id);
  const sourceUsername = sanitizeUsername(
    pickString(content.userScreenName, content.screenName, content.username, event.twAccount),
  );
  const username = isTruth ? `truth:${sourceUsername}` : sourceUsername;
  const text = normalizeText(content.fullText) || normalizeText(content.text);
  if (!id || !sourceUsername || !text) return null;

  const createdAt = normalizeDate(content.createdAt, normalizeDate(event.createdAt));
  const truthUrl = pickString(content.webLink);
  return {
    id: isTruth ? `truth:${id}` : id,
    text,
    createdAt,
    username,
    displayName: pickString(content.userName, content.name, sourceUsername),
    profileUrl: isTruth ? truthProfileUrlFor(sourceUsername) : profileUrlFor(username),
    userAvatar: avatarFor(username, content.profileUrl || event.profileUrl),
    tweetUrl: isTruth ? truthUrl || truthProfileUrlFor(sourceUsername) : tweetUrlFor(username, id),
    hashtags: [],
    likes: toNumber(content.favoriteCount),
    retweets: toNumber(content.retweetCount),
    replies: toNumber(content.replyCount),
    quotes: toNumber(content.quoteCount),
    views: toNumber(content.viewCount),
    media: normalizeMedia(content.media),
    quotedTweet: normalizeQuotedTweet(content),
    origin: "watch",
    queryLabel: isTruth ? "985monitor / truth" : `985monitor / ${pickString(event.eventType) || "event"}`,
    translation: normalizeTranslation(content.translation, text),
  };
}

export function normalizeMonitor985Event(payload: unknown): TwitterRealtimeUpdate | null {
  if (!isRecord(payload)) return null;

  const event = payload as Raw985Event;
  if (!isRecord(event.content)) return null;

  const feedItem = normalizeFeedItem(event, event.content as Raw985Tweet);
  if (!feedItem) return null;

  return {
    eventType: pickString(event.eventType) || "MONITOR985_EVENT",
    account: feedItem.username,
    displayName: feedItem.displayName,
    createdAt: feedItem.createdAt,
    profileUrl: feedItem.profileUrl,
    remark: pickString(event.key),
    feedItem,
  };
}

export function extractMonitor985Events(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const events = payload.events;
  return Array.isArray(events) ? events : [];
}
