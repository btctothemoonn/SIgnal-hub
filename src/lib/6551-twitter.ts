import { translateText, type TranslationNote } from "./translate.ts";
import { join } from "node:path";
import {
  getCachedRuntimeConfig,
  loadRuntimeConfig,
  onRuntimeConfigChange,
} from "./runtime-config.ts";
import { createSnapshotCache } from "./snapshot-cache.ts";
import {
  deletePersistedTwitterSnapshot,
  mergePersistedRealtimeTwitterUpdate,
  readFreshPersistedTwitterSnapshot,
  writePersistedTwitterSnapshot,
} from "./twitter-snapshot-cache.ts";

const DEFAULT_TWITTER_API_BASE = "https://ai.6551.io";
const DEFAULT_DASHBOARD_ACCOUNTS = 200;
const DEFAULT_TWEETS_PER_ACCOUNT = 20;
const DEFAULT_SEARCH_TERMS = 2;
const DEFAULT_SEARCH_RESULTS = 20;
const DEFAULT_FEED_ITEMS = 100;
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 600_000;
const DEFAULT_MEMORY_CACHE_TTL_MS = 60_000;

type JsonRecord = Record<string, unknown>;

type ApiEnvelope<T> = {
  code?: number;
  message?: string;
  msg?: string;
  data?: T;
  total?: number;
};

type RawWatch = {
  id?: number | string;
  username?: string;
  screenName?: string;
  twAccount?: string;
  name?: string;
  userName?: string;
  twUserName?: string;
  profileUrl?: string;
  remark?: string;
};

type RawTweet = {
  id?: number | string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  favoriteCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  userScreenName?: string;
  screenName?: string;
  username?: string;
  twAccount?: string;
  userName?: string;
  name?: string;
  twUserName?: string;
  hashtags?: string[];
  permanentUrl?: string;
  profileUrl?: string;
  userAvatar?: string;
  avatar?: string;
  profileImageUrl?: string;
  profile_image_url?: string;
  profileImageUrlHttps?: string;
  profile_image_url_https?: string;
  media?: unknown;
  mediaEntities?: unknown;
  media_entities?: unknown;
  extendedEntities?: unknown;
  extended_entities?: unknown;
  quotedTweet?: unknown;
  quoted_tweet?: unknown;
  quotedStatus?: unknown;
  quoted_status?: unknown;
  quoteTweet?: unknown;
  quote_tweet?: unknown;
  referencedTweet?: unknown;
  referenced_tweet?: unknown;
  replyStatus?: unknown;
  reply_status?: unknown;
  quotedTweetId?: number | string;
  quoted_tweet_id?: number | string;
  quotedStatusId?: number | string;
  quoted_status_id?: number | string;
  quotedId?: number | string;
  quoted_id?: number | string;
  quotedTweetUrl?: string;
  quoted_tweet_url?: string;
  quotedStatusUrl?: string;
  quoted_status_url?: string;
  inReplyToStatusId?: number | string;
  in_reply_to_status_id?: number | string;
  inReplyToTweetId?: number | string;
  in_reply_to_tweet_id?: number | string;
  replyToTweetId?: number | string;
  reply_to_tweet_id?: number | string;
  inReplyToStatusUrl?: string;
  in_reply_to_status_url?: string;
  replyToTweetUrl?: string;
  reply_to_tweet_url?: string;
};

type RawRealtimeEventParams = {
  id?: number | string;
  twAccount?: string;
  twUserName?: string;
  profileUrl?: string;
  eventType?: string;
  content?: unknown;
  ca?: string;
  remark?: string;
  createdAt?: string;
};

export type TwitterWatchAccount = {
  id: number | null;
  username: string;
  name: string;
  profileUrl: string;
  note: string;
  avatar: string;
};

export type TwitterMediaItem = {
  kind: "image" | "video" | "gif";
  mimeType: string;
  previewUrl: string;
  label: string;
  width: number | null;
  height: number | null;
};

export type TwitterQuotedTweet = {
  id: string;
  text: string;
  createdAt: string;
  username: string;
  displayName: string;
  profileUrl: string;
  userAvatar: string;
  tweetUrl: string;
  media: TwitterMediaItem[];
  translation: TranslationNote | null;
  relation?: "quote" | "reply";
};

export type TwitterFeedItem = {
  id: string;
  text: string;
  createdAt: string;
  username: string;
  displayName: string;
  profileUrl: string;
  userAvatar: string;
  tweetUrl: string;
  hashtags: string[];
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  media: TwitterMediaItem[];
  quotedTweet: TwitterQuotedTweet | null;
  origin: "watch" | "search";
  queryLabel: string;
  translation: TranslationNote | null;
};

export type TwitterDashboardSnapshot = {
  provider: "6551";
  baseUrl: string;
  isConfigured: boolean;
  isConnected: boolean;
  status: "needs_token" | "paused" | "live" | "error";
  watchAccounts: TwitterWatchAccount[];
  trackedKeywords: string[];
  feed: TwitterFeedItem[];
  note: string;
  errors: string[];
  usage?: {
    dateKey: string;
    timeZone: string;
    limit: number;
    pointsUsed: number;
    remaining: number;
    authorized: boolean;
    blocked: boolean;
    updatedAt: string | null;
    authorizedAt: string | null;
  };
};

export type TwitterRealtimeStatus = {
  state:
    | "needs_token"
    | "paused"
    | "connecting"
    | "connected"
    | "subscribed"
    | "closed"
    | "error";
  message: string;
  at: string;
};

export type TwitterRealtimeUpdate = {
  eventType: string;
  account: string;
  displayName: string;
  createdAt: string;
  profileUrl: string;
  feedItem: TwitterFeedItem;
  remark: string;
};

const TWEET_EVENT_TYPES = new Set([
  "NEW_TWEET",
  "NEW_TWEET_REPLY",
  "NEW_TWEET_QUOTE",
  "NEW_RETWEET",
  "CA",
]);

const EVENT_TYPE_LABELS: Record<string, string> = {
  NEW_TWEET: "新推文",
  NEW_TWEET_REPLY: "新回复",
  NEW_TWEET_QUOTE: "新引用",
  NEW_RETWEET: "新转推",
  CA: "检测到 CA",
  NEW_FOLLOWER: "新增关注者",
  NEW_UNFOLLOWER: "取消关注事件",
  UPDATE_NAME: "名称更新",
  UPDATE_DESCRIPTION: "简介更新",
  UPDATE_AVATAR: "头像更新",
  UPDATE_BANNER: "横幅更新",
  TWEET_TOPPING: "置顶变更",
  DELETE: "删除推文",
  SYSTEM: "系统事件",
  TRANSLATE: "翻译事件",
  CA_CREATE: "创建 CA",
};

function getTwitterToken(): string {
  return (
    process.env.TWITTER_TOKEN?.trim() ||
    process.env.OPENNEWS_TOKEN?.trim() ||
    ""
  );
}

function getTwitterBaseUrl(): string {
  return process.env.TWITTER_API_BASE?.trim() || DEFAULT_TWITTER_API_BASE;
}

export function is6551TwitterConnectorEnabled(): boolean {
  const raw = process.env.TWITTER_CONNECTOR_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return !["0", "false", "no", "off", "paused"].includes(raw);
}

function isTwitterTranslationEnabled(): boolean {
  const raw = process.env.TWITTER_TRANSLATE_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return !["0", "false", "no", "off"].includes(raw);
}

function getTwitterTranslationTarget(): string {
  return (
    process.env.TWITTER_TRANSLATE_TARGET?.trim() ||
    process.env.TELEGRAM_TRANSLATE_TARGET?.trim() ||
    "zh-CN"
  );
}

async function enrichFeedItem(
  feedItem: TwitterFeedItem | null,
): Promise<TwitterFeedItem | null> {
  if (!feedItem) {
    return null;
  }

  return {
    ...feedItem,
    translation: await translateText(feedItem.text, {
      enabled: isTwitterTranslationEnabled(),
      targetLanguage: getTwitterTranslationTarget(),
      cacheNamespace: "twitter",
    }),
  };
}

export function has6551TwitterToken(): boolean {
  return Boolean(getTwitterToken());
}

export function get6551TwitterToken(): string {
  return getTwitterToken();
}

export function get6551TwitterWebSocketUrl(): string {
  const explicitUrl = process.env.TWITTER_WS_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const baseUrl = new URL(getTwitterBaseUrl());
  baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  baseUrl.pathname = "/open/twitter_wss";
  baseUrl.search = "";

  return baseUrl.toString();
}

function parseList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\n,，]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "");
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

  return 0;
}

function toId(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaArrayFromRaw(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.media)) return raw.media;
  return [];
}

function normalizeTweetMedia(...sources: unknown[]): TwitterMediaItem[] {
  const media: TwitterMediaItem[] = [];
  for (const item of sources.flatMap(mediaArrayFromRaw)) {
    if (!isRecord(item)) continue;
    const rawType = pickString(item.type, item.kind).toLowerCase();
    const url = pickString(
      item.url,
      item.mediaUrlHttps,
      item.media_url_https,
      item.previewUrl,
      item.thumbUrl,
    );
    if (!url) continue;

    const kind =
      rawType === "video"
        ? "video"
        : rawType === "animated_gif" || rawType === "gif"
          ? "gif"
          : "image";
    media.push({
      kind,
      mimeType: pickString(item.mimeType, item.mime_type),
      previewUrl: url,
      label: rawType || kind,
      width: toNumber(item.width) || null,
      height: toNumber(item.height) || null,
    });
  }

  return media;
}

const TWEET_STATUS_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/\s?#]+)\/status(?:es)?\/(\d+)/i;

function extractTweetUrlParts(
  ...values: unknown[]
): { username: string; id: string; tweetUrl: string } | null {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const match = value.match(TWEET_STATUS_URL_RE);
    if (!match) continue;
    const username = sanitizeUsername(match[1]);
    const id = match[2];
    if (!username || !id) continue;
    return {
      username,
      id,
      tweetUrl: `https://x.com/${username}/status/${id}`,
    };
  }
  return null;
}

function toQuotedTweet(
  feedItem: TwitterFeedItem,
  relation: "quote" | "reply",
): TwitterQuotedTweet {
  return {
    id: feedItem.id,
    text: feedItem.text,
    createdAt: feedItem.createdAt,
    username: feedItem.username,
    displayName: feedItem.displayName,
    profileUrl: feedItem.profileUrl,
    userAvatar: feedItem.userAvatar,
    tweetUrl: feedItem.tweetUrl,
    media: feedItem.media,
    translation: feedItem.translation,
    relation,
  };
}

function getEmbeddedReferencedTweet(
  input: RawTweet,
): { tweet: RawTweet; relation: "quote" | "reply" } | null {
  const candidates: Array<{ value: unknown; relation: "quote" | "reply" }> = [
    { value: input.quotedTweet, relation: "quote" },
    { value: input.quoted_tweet, relation: "quote" },
    { value: input.quotedStatus, relation: "quote" },
    { value: input.quoted_status, relation: "quote" },
    { value: input.quoteTweet, relation: "quote" },
    { value: input.quote_tweet, relation: "quote" },
    { value: input.replyStatus, relation: "reply" },
    { value: input.reply_status, relation: "reply" },
    { value: input.referencedTweet, relation: "reply" },
    { value: input.referenced_tweet, relation: "reply" },
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate.value)) {
      return {
        tweet: candidate.value as RawTweet,
        relation: candidate.relation,
      };
    }
  }
  return null;
}

function normalizeQuotedTweet(input: RawTweet): TwitterQuotedTweet | null {
  const embedded = getEmbeddedReferencedTweet(input);
  if (embedded) {
    const normalized = normalizeTweet(embedded.tweet, "watch", "Referenced tweet", {
      includeQuotedTweet: false,
    });
    if (normalized) return toQuotedTweet(normalized, embedded.relation);
  }

  const quoteUrlParts = extractTweetUrlParts(
    input.quotedTweetUrl,
    input.quoted_tweet_url,
    input.quotedStatusUrl,
    input.quoted_status_url,
  );
  const quoteId =
    toId(input.quotedTweetId) ||
    toId(input.quoted_tweet_id) ||
    toId(input.quotedStatusId) ||
    toId(input.quoted_status_id) ||
    toId(input.quotedId) ||
    toId(input.quoted_id) ||
    quoteUrlParts?.id ||
    "";
  if (quoteId) {
    return buildReferencedTweetShell({
      id: quoteId,
      urlParts: quoteUrlParts,
      relation: "quote",
    });
  }

  const replyUrlParts = extractTweetUrlParts(
    input.inReplyToStatusUrl,
    input.in_reply_to_status_url,
    input.replyToTweetUrl,
    input.reply_to_tweet_url,
  );
  const replyId =
    toId(input.inReplyToStatusId) ||
    toId(input.in_reply_to_status_id) ||
    toId(input.inReplyToTweetId) ||
    toId(input.in_reply_to_tweet_id) ||
    toId(input.replyToTweetId) ||
    toId(input.reply_to_tweet_id) ||
    replyUrlParts?.id ||
    "";
  if (!replyId) return null;

  return buildReferencedTweetShell({
    id: replyId,
    urlParts: replyUrlParts,
    relation: "reply",
  });
}

function buildReferencedTweetShell({
  id,
  urlParts,
  relation,
}: {
  id: string;
  urlParts: { username: string; id: string; tweetUrl: string } | null;
  relation: "quote" | "reply";
}): TwitterQuotedTweet {
  const username = urlParts?.username ?? "";
  return {
    id,
    text: "",
    createdAt: "",
    username,
    displayName: username,
    profileUrl: username ? `https://x.com/${username}` : "#",
    userAvatar: "",
    tweetUrl: urlParts?.tweetUrl ?? (username ? `https://x.com/${username}/status/${id}` : "#"),
    media: [],
    translation: null,
    relation,
  };
}

function normalizeWatch(input: RawWatch): TwitterWatchAccount | null {
  const username = sanitizeUsername(
    pickString(input.username, input.screenName, input.twAccount),
  );

  if (!username) {
    return null;
  }

  const idNumber = toNumber(input.id);

  return {
    id: idNumber > 0 ? idNumber : null,
    username,
    name: pickString(input.name, input.userName, input.twUserName, username),
    profileUrl:
      pickString(input.profileUrl) || `https://x.com/${sanitizeUsername(username)}`,
    avatar: `https://unavatar.io/twitter/${username}`,
    note: pickString(input.remark),
  };
}

function normalizeTweet(
  input: RawTweet,
  origin: "watch" | "search",
  queryLabel: string,
  options: { includeQuotedTweet?: boolean } = {},
): TwitterFeedItem | null {
  const id = toId(input.id);
  const username = sanitizeUsername(
    pickString(
      input.userScreenName,
      input.screenName,
      input.username,
      input.twAccount,
    ),
  );

  if (!id || !username) {
    return null;
  }

  const media = normalizeTweetMedia(
    input.media,
    input.mediaEntities,
    input.media_entities,
    input.extendedEntities,
    input.extended_entities,
  );
  const text = pickString(input.fullText, input.text).replace(/\s+/g, " ").trim();
  if (!text && media.length === 0) {
    return null;
  }

  return {
    id,
    text,
    createdAt: pickString(input.createdAt) || new Date(0).toISOString(),
    username,
    displayName: pickString(
      input.userName,
      input.name,
      input.twUserName,
      username,
    ),
    profileUrl: pickString(input.profileUrl) || `https://x.com/${username}`,
    userAvatar: pickString(
      input.userAvatar,
      input.avatar,
      input.profileImageUrlHttps,
      input.profile_image_url_https,
      input.profileImageUrl,
      input.profile_image_url,
    ),
    tweetUrl:
      pickString(input.permanentUrl) || `https://x.com/${username}/status/${id}`,
    hashtags: Array.isArray(input.hashtags)
      ? input.hashtags.filter(
          (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
        )
      : [],
    likes: toNumber(input.favoriteCount),
    retweets: toNumber(input.retweetCount),
    replies: toNumber(input.replyCount),
    quotes: toNumber(input.quoteCount),
    views: toNumber(input.viewCount),
    media,
    quotedTweet:
      options.includeQuotedTweet === false ? null : normalizeQuotedTweet(input),
    origin,
    queryLabel,
    translation: null,
  };
}

function getEventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] || eventType;
}

function clipText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 1)}…`;
}

function buildSyntheticRealtimeFeedItem({
  id,
  eventType,
  account,
  displayName,
  createdAt,
  profileUrl,
  text,
}: {
  id: string;
  eventType: string;
  account: string;
  displayName: string;
  createdAt: string;
  profileUrl: string;
  text: string;
}): TwitterFeedItem {
  return {
    id,
    text,
    createdAt,
    username: account,
    displayName,
    profileUrl,
    userAvatar: `https://unavatar.io/twitter/${account}`,
    tweetUrl: profileUrl,
    hashtags: [],
    likes: 0,
    retweets: 0,
    replies: 0,
    quotes: 0,
    views: 0,
    media: [],
    quotedTweet: null,
    origin: "watch",
    queryLabel: `实时 · ${getEventTypeLabel(eventType)}`,
    translation: null,
  };
}

function buildRealtimeSummary(
  eventType: string,
  account: string,
  content: unknown,
  ca: string,
): string {
  if (eventType === "NEW_FOLLOWER" || eventType === "NEW_UNFOLLOWER") {
    const users = Array.isArray(content)
      ? content
          .map((item) =>
            isRecord(item)
              ? sanitizeUsername(
                  pickString(item.twAccount, item.username, item.screenName),
                )
              : "",
          )
          .filter(Boolean)
          .slice(0, 4)
      : [];

    const action = eventType === "NEW_FOLLOWER" ? "新增关注者" : "出现取消关注";
    return users.length > 0
      ? `@${account} ${action}：${users.map((name) => `@${name}`).join("、")}`
      : `@${account} ${action}`;
  }

  if (
    eventType === "UPDATE_NAME" ||
    eventType === "UPDATE_DESCRIPTION" ||
    eventType === "UPDATE_AVATAR" ||
    eventType === "UPDATE_BANNER"
  ) {
    const suffix =
      typeof content === "string" && content.trim()
        ? `：${clipText(content.trim(), 120)}`
        : "";
    return `@${account} ${getEventTypeLabel(eventType)}${suffix}`;
  }

  if (eventType === "DELETE") {
    return `@${account} 删除了一条推文`;
  }

  if (eventType === "CA_CREATE") {
    return ca
      ? `@${account} 关联了新的 CA：${ca}`
      : `@${account} 触发了 CA_CREATE 事件`;
  }

  if (eventType === "TWEET_TOPPING") {
    return `@${account} 更新了置顶推文`;
  }

  if (typeof content === "string" && content.trim()) {
    return `@${account} ${getEventTypeLabel(eventType)}：${clipText(
      content.trim(),
      140,
    )}`;
  }

  return `@${account} 触发了 ${getEventTypeLabel(eventType)} 事件`;
}

export async function normalize6551RealtimeEvent(
  payload: unknown,
): Promise<TwitterRealtimeUpdate | null> {
  if (!isRecord(payload)) {
    return null;
  }

  const params = payload as RawRealtimeEventParams;
  const eventType = pickString(params.eventType);
  const account = sanitizeUsername(pickString(params.twAccount));
  const createdAt = pickString(params.createdAt) || new Date().toISOString();

  if (!eventType || !account) {
    return null;
  }

  const displayName = pickString(params.twUserName, account);
  const profileUrl = pickString(params.profileUrl) || `https://x.com/${account}`;
  const realtimeId = toId(params.id) || `${eventType}:${account}:${createdAt}`;
  const remark = pickString(params.remark);
  let feedItem: TwitterFeedItem | null = null;

  if (TWEET_EVENT_TYPES.has(eventType) && isRecord(params.content)) {
    feedItem = normalizeTweet(
      {
        ...(params.content as RawTweet),
        profileUrl: pickString(
          (params.content as RawTweet).profileUrl,
          profileUrl,
        ),
        twAccount: pickString((params.content as RawTweet).twAccount, account),
        twUserName: pickString(
          (params.content as RawTweet).twUserName,
          displayName,
        ),
        createdAt:
          pickString((params.content as RawTweet).createdAt) || createdAt,
      },
      "watch",
      `实时 · ${getEventTypeLabel(eventType)}`,
    );
  }

  if (!feedItem) {
    feedItem = buildSyntheticRealtimeFeedItem({
      id: realtimeId,
      eventType,
      account,
      displayName,
      createdAt,
      profileUrl,
      text: buildRealtimeSummary(eventType, account, params.content, pickString(params.ca)),
    });
  }

  const translatedFeedItem = await enrichFeedItem(feedItem);
  if (!translatedFeedItem) {
    return null;
  }

  return {
    eventType,
    account,
    displayName,
    createdAt,
    profileUrl,
    feedItem: translatedFeedItem,
    remark,
  };
}

function buildFallbackWatchAccounts(): TwitterWatchAccount[] {
  const runtime = getCachedRuntimeConfig();
  const merged = [
    ...parseList(process.env.TWITTER_WATCH_USERNAMES),
    ...runtime.twitterAccounts.map((item) => item.ref),
  ];

  const deduped = new Map<string, TwitterWatchAccount>();
  for (const raw of merged) {
    const username = sanitizeUsername(raw);
    if (!username) continue;
    const key = username.toLowerCase();
    if (deduped.has(key)) continue;
    deduped.set(key, {
      id: null,
      username,
      name: username,
      profileUrl: `https://x.com/${username}`,
      avatar: `https://unavatar.io/twitter/${username}`,
      note: "本地配置",
    });
  }

  return Array.from(deduped.values());
}

const MAX_RETRIES = 3;
const INITIAL_CONCURRENCY = 8;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;
const GROW_AFTER_SUCCESSES = 20;

let concurrencyLimit = INITIAL_CONCURRENCY;
let inFlight = 0;
let successStreak = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < concurrencyLimit) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

function onRateLimited(): void {
  successStreak = 0;
  concurrencyLimit = Math.max(MIN_CONCURRENCY, Math.floor(concurrencyLimit / 2));
}

function onRequestSuccess(): void {
  successStreak += 1;
  if (successStreak >= GROW_AFTER_SUCCESSES && concurrencyLimit < MAX_CONCURRENCY) {
    concurrencyLimit += 1;
    successStreak = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SHARD_COUNT = 4;
const ACCOUNT_TWEET_TTL_MS = 600_000;

type AccountTweetEntry = {
  tweets: TwitterFeedItem[];
  fetchedAt: number;
};

const accountTweetCache = new Map<string, AccountTweetEntry>();

function pickShardToRefresh(accountNames: string[]): {
  refresh: string[];
  cached: TwitterFeedItem[];
} {
  if (accountNames.length === 0) {
    return { refresh: [], cached: [] };
  }

  const now = Date.now();
  const ranked = accountNames.map((name) => {
    const entry = accountTweetCache.get(name.toLowerCase());
    return {
      name,
      age: entry ? now - entry.fetchedAt : Number.POSITIVE_INFINITY,
      entry,
    };
  });

  const budget = Math.max(1, Math.ceil(accountNames.length / SHARD_COUNT));
  const stale = ranked
    .filter((r) => r.age > ACCOUNT_TWEET_TTL_MS)
    .sort((a, b) => b.age - a.age)
    .slice(0, budget);

  const refreshSet = new Set(stale.map((r) => r.name.toLowerCase()));
  const refresh = stale.map((r) => r.name);
  const cached: TwitterFeedItem[] = [];
  for (const r of ranked) {
    if (!refreshSet.has(r.name.toLowerCase()) && r.entry) {
      cached.push(...r.entry.tweets);
    }
  }
  return { refresh, cached };
}

async function request6551<T>(
  path: string,
  body: JsonRecord,
): Promise<ApiEnvelope<T>> {
  const token = getTwitterToken();
  if (!token) {
    throw new Error(
      "缺少 TWITTER_TOKEN。请先到 https://6551.io/mcp 获取 token，并写入 .env.local。",
    );
  }

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${getTwitterBaseUrl()}${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
      } catch (error) {
        onRateLimited();
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `6551 网络错误：${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await sleep(Math.min(30000, 1000 * 2 ** attempt));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        onRateLimited();
        if (attempt === MAX_RETRIES) {
          const errorText = (await response.text()).slice(0, 240);
          throw new Error(
            `6551 限流 (${response.status})：${errorText || response.statusText}`,
          );
        }
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.max(1000, Number(retryAfterHeader) * 1000)
          : Math.min(30000, 1000 * 2 ** attempt);
        await sleep(retryAfterMs);
        continue;
      }

      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 240);
        throw new Error(
          `6551 请求失败 (${response.status})：${errorText || response.statusText}`,
        );
      }

      onRequestSuccess();
      return (await response.json()) as ApiEnvelope<T>;
    }
    throw new Error("6551 请求重试耗尽。");
  } finally {
    releaseSlot();
  }
}

export async function get6551TwitterWatchAccounts(): Promise<TwitterWatchAccount[]> {
  const response = await request6551<RawWatch[]>("/open/twitter_watch", {});
  const items = Array.isArray(response.data) ? response.data : [];

  return items
    .map((item) => normalizeWatch(item))
    .filter((item): item is TwitterWatchAccount => item !== null);
}

export async function add6551TwitterWatch(
  username: string,
): Promise<ApiEnvelope<unknown>> {
  return request6551("/open/twitter_watch_add", {
    username: sanitizeUsername(username),
  });
}

export async function delete6551TwitterWatch(
  watchId: number,
): Promise<ApiEnvelope<unknown>> {
  return request6551("/open/twitter_watch_delete", { id: watchId });
}

async function getUserTweets(
  username: string,
  maxResults: number,
): Promise<TwitterFeedItem[]> {
  const response = await request6551<RawTweet[]>("/open/twitter_user_tweets", {
    username,
    maxResults,
    product: "Latest",
    includeReplies: false,
    includeRetweets: false,
  });

  const items = Array.isArray(response.data) ? response.data : [];
  const feedItems = await Promise.all(
    items.map((item) => enrichFeedItem(normalizeTweet(item, "watch", `@${username}`))),
  );

  return feedItems.filter((item): item is TwitterFeedItem => item !== null);
}

export function get6551TwitterUserTweets(
  username: string,
  maxResults: number,
): Promise<TwitterFeedItem[]> {
  return getUserTweets(username, maxResults);
}

export async function get6551TwitterTweetById(
  tweetId: string,
): Promise<TwitterFeedItem | null> {
  const cleanTweetId = tweetId.trim();
  if (!cleanTweetId) {
    return null;
  }

  const response = await request6551<RawTweet | RawTweet[]>(
    "/open/twitter_tweet_by_id",
    { twId: cleanTweetId },
  );
  const rawTweet = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!rawTweet) {
    return null;
  }

  return enrichFeedItem(
    normalizeTweet(rawTweet, "watch", "Telegram trigger / full"),
  );
}

async function searchTweets(
  keywords: string,
  maxResults: number,
): Promise<TwitterFeedItem[]> {
  const response = await request6551<RawTweet[]>("/open/twitter_search", {
    keywords,
    maxResults,
    product: "Latest",
    excludeReplies: false,
    excludeRetweets: true,
  });

  const items = Array.isArray(response.data) ? response.data : [];
  const feedItems = await Promise.all(
    items.map((item) => enrichFeedItem(normalizeTweet(item, "search", keywords))),
  );

  return feedItems.filter((item): item is TwitterFeedItem => item !== null);
}

function uniqueById(items: TwitterFeedItem[]): TwitterFeedItem[] {
  const map = new Map<string, TwitterFeedItem>();

  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  return [...map.values()];
}

function mergeWatchAccounts(
  remoteAccounts: TwitterWatchAccount[],
  localAccounts: TwitterWatchAccount[],
): TwitterWatchAccount[] {
  const map = new Map<string, TwitterWatchAccount>();

  for (const account of [...remoteAccounts, ...localAccounts]) {
    if (!map.has(account.username)) {
      map.set(account.username, account);
    }
  }

  return [...map.values()];
}

function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export async function get6551TwitterSnapshot(): Promise<TwitterDashboardSnapshot> {
  await loadRuntimeConfig();
  const trackedKeywords = parseList(process.env.TWITTER_SEARCH_KEYWORDS);
  const localWatchAccounts = buildFallbackWatchAccounts();
  const isEnabled = is6551TwitterConnectorEnabled();

  if (!isEnabled) {
    return {
      provider: "6551",
      baseUrl: getTwitterBaseUrl(),
      isConfigured: Boolean(getTwitterToken()),
      isConnected: false,
      status: "paused",
      watchAccounts: localWatchAccounts,
      trackedKeywords,
      feed: [],
      note: "6551 X 连接器已手动暂停。当前不会发起 watch 列表、搜索或实时订阅请求，因此不会继续消耗 points。",
      errors: [],
    };
  }

  if (!getTwitterToken()) {
    return {
      provider: "6551",
      baseUrl: getTwitterBaseUrl(),
      isConfigured: false,
      isConnected: false,
      status: "needs_token",
      watchAccounts: localWatchAccounts,
      trackedKeywords,
      feed: [],
      note: "已预留 6551 X 接口，但当前还没配置 TWITTER_TOKEN。",
      errors: [],
    };
  }

  const errors: string[] = [];
  let remoteWatchAccounts: TwitterWatchAccount[] = [];

  try {
    remoteWatchAccounts = await get6551TwitterWatchAccounts();
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 6551 监控列表失败。";
    if (!/upgrade|higher plan|403|升级/i.test(message)) {
      errors.push(message);
    }
  }

  const watchAccounts = mergeWatchAccounts(remoteWatchAccounts, localWatchAccounts);
  const accountLimit = limitFromEnv(
    "TWITTER_DASHBOARD_ACCOUNTS",
    DEFAULT_DASHBOARD_ACCOUNTS,
  );
  const tweetsPerAccount = limitFromEnv(
    "TWITTER_TWEETS_PER_ACCOUNT",
    DEFAULT_TWEETS_PER_ACCOUNT,
  );
  const keywordLimit = limitFromEnv(
    "TWITTER_DASHBOARD_SEARCH_TERMS",
    DEFAULT_SEARCH_TERMS,
  );
  const searchResults = limitFromEnv(
    "TWITTER_SEARCH_RESULTS",
    DEFAULT_SEARCH_RESULTS,
  );

  const accountNames = watchAccounts
    .map((account) => account.username)
    .slice(0, accountLimit);

  const { refresh: accountsToRefresh, cached: cachedAccountTweets } =
    pickShardToRefresh(accountNames);

  const watchTweetPromises = accountsToRefresh.map(async (username) => {
    try {
      const tweets = await getUserTweets(username, tweetsPerAccount);
      accountTweetCache.set(username.toLowerCase(), {
        tweets,
        fetchedAt: Date.now(),
      });
      return tweets;
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `@${username} 拉取失败：${error.message}`
          : `@${username} 拉取失败。`,
      );
      const stale = accountTweetCache.get(username.toLowerCase());
      return stale ? stale.tweets : [];
    }
  });

  const keywordSearchPromises = trackedKeywords
    .slice(0, keywordLimit)
    .map(async (keyword) => {
      try {
        return await searchTweets(keyword, searchResults);
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `关键词 ${keyword} 搜索失败：${error.message}`
            : `关键词 ${keyword} 搜索失败。`,
        );
        return [];
      }
    });

  const [watchTweetGroups, keywordTweetGroups] = await Promise.all([
    Promise.all(watchTweetPromises),
    Promise.all(keywordSearchPromises),
  ]);

  const maxFeedItems = limitFromEnv("TWITTER_FEED_ITEMS", DEFAULT_FEED_ITEMS);
  const feed = uniqueById([
    ...watchTweetGroups.flat(),
    ...cachedAccountTweets,
    ...keywordTweetGroups.flat(),
  ])
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .slice(0, maxFeedItems);

  if (feed.length === 0 && watchAccounts.length === 0) {
    return {
      provider: "6551",
      baseUrl: getTwitterBaseUrl(),
      isConfigured: true,
      isConnected: true,
      status: "live",
      watchAccounts: [],
      trackedKeywords,
      feed: [],
      note: "6551 已连通，但当前还没有监控账号。可在 6551 后台添加，或在 .env.local 里配置 TWITTER_WATCH_USERNAMES。",
      errors,
    };
  }

  return {
    provider: "6551",
    baseUrl: getTwitterBaseUrl(),
    isConfigured: true,
    isConnected: errors.length === 0 || feed.length > 0 || watchAccounts.length > 0,
    status: errors.length > 0 && feed.length === 0 ? "error" : "live",
    watchAccounts,
    trackedKeywords,
    feed,
    note:
      errors.length > 0
        ? "6551 已接入，但有部分请求失败；面板仍会展示已成功拉到的数据。"
        : "通过 6551 服务端拉取 X 监控列表、账号最新帖子和关键词搜索结果。",
    errors,
  };
}

function getTwitterSnapshotCacheFilePath(): string {
  return (
    process.env.TWITTER_SNAPSHOT_CACHE_FILE?.trim() ||
    join(process.cwd(), ".signal-hub", "twitter-snapshot-cache.json")
  );
}

function getTwitterSnapshotCacheTtlMs(): number {
  return limitFromEnv(
    "TWITTER_SNAPSHOT_CACHE_TTL_MS",
    DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  );
}

function getTwitterSnapshotMemoryTtlMs(): number {
  return limitFromEnv(
    "TWITTER_SNAPSHOT_MEMORY_TTL_MS",
    DEFAULT_MEMORY_CACHE_TTL_MS,
  );
}

async function get6551TwitterSnapshotWithPersistentCache() {
  if (!is6551TwitterConnectorEnabled() || !getTwitterToken()) {
    return get6551TwitterSnapshot();
  }

  const cacheFilePath = getTwitterSnapshotCacheFilePath();
  const cached = await readFreshPersistedTwitterSnapshot(
    cacheFilePath,
    getTwitterSnapshotCacheTtlMs(),
  );
  if (cached) {
    return cached;
  }

  const snapshot = await get6551TwitterSnapshot();
  if (snapshot.isConfigured && snapshot.status !== "needs_token") {
    await writePersistedTwitterSnapshot(cacheFilePath, snapshot);
  }

  return snapshot;
}

const sharedSnapshotCache = createSnapshotCache(
  () => get6551TwitterSnapshotWithPersistentCache(),
  getTwitterSnapshotMemoryTtlMs(),
);
onRuntimeConfigChange(() => {
  sharedSnapshotCache.invalidate();
  void deletePersistedTwitterSnapshot(getTwitterSnapshotCacheFilePath());
});

export function getCached6551TwitterSnapshot(): Promise<TwitterDashboardSnapshot> {
  return sharedSnapshotCache.get();
}

export async function invalidate6551TwitterSnapshot(): Promise<void> {
  sharedSnapshotCache.invalidate();
  await deletePersistedTwitterSnapshot(getTwitterSnapshotCacheFilePath());
}

export async function merge6551RealtimeUpdateIntoSnapshotCache(
  update: TwitterRealtimeUpdate,
): Promise<void> {
  await mergePersistedRealtimeTwitterUpdate(
    getTwitterSnapshotCacheFilePath(),
    update,
    limitFromEnv("TWITTER_FEED_ITEMS", DEFAULT_FEED_ITEMS),
  );
  sharedSnapshotCache.invalidate();
}
