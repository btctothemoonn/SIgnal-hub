import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import type {
  TwitterDashboardSnapshot,
  TwitterFeedItem,
  TwitterQuotedTweet,
  TwitterRealtimeUpdate,
  TwitterWatchAccount,
} from "@/lib/6551-twitter";
import type { TranslationNote } from "./translate.ts";
import { isUsefulTranslation } from "./translation-quality.ts";
import { getXApiUsageSnapshot } from "./x-api-usage.ts";
import {
  getXPipelineConfig,
  getXPipelineTrackedKeywords,
  hasXPipelineDataSource,
  isMonitor985Enabled,
  isXPipelineEnabled,
} from "./x-pipeline-config.ts";

type DbValue = string | number | null;
type DbRow = Record<string, unknown>;

export type XPipelineAccountInput = {
  id?: number | null;
  username: string;
  name: string;
  profileUrl: string;
  avatar: string | null;
  note: string;
  tags?: string[];
};

export type XPipelineHealthInput = {
  scope: string;
  status:
    | "starting"
    | "connecting"
    | "connected"
    | "subscribed"
    | "live"
    | "stale"
    | "paused"
    | "needs_token"
    | "closed"
    | "error";
  detail: string;
};

export type XPipelineHealthStatus = XPipelineHealthInput & {
  updatedAt: string;
};

export type XHybridSourceInput = {
  sourceId: string;
  status: "ignored" | "pending" | "enriched" | "fallback" | "cooldown" | "error";
  detail: string;
  tweetId: string | null;
};

export type XHybridSourceStatus = XHybridSourceInput & {
  updatedAt?: string;
};

export type XHybridAccountFetchStatus = {
  username: string;
  lastFetchedAt: string | null;
  nextAllowedAt: string | null;
  isCoolingDown: boolean;
};

let sharedDb: DatabaseSync | null = null;

function nowIso() {
  return new Date().toISOString();
}

function run(stmt: StatementSync, ...values: DbValue[]) {
  return stmt.run(...values);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function timeValue(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDateString(value: unknown): string {
  const raw = stringValue(value);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function compareFeedRowsByTime(left: DbRow, right: DbRow): number {
  return (
    timeValue(right.created_at) - timeValue(left.created_at) ||
    timeValue(right.updated_at) - timeValue(left.updated_at)
  );
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseMediaArray(raw: unknown): TwitterFeedItem["media"] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TwitterFeedItem["media"][number] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const media = item as Record<string, unknown>;
      return typeof media.previewUrl === "string" && media.previewUrl.length > 0;
    });
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function cleanStoredTranslationText(text: string): string {
  let cleaned = text
    .trim()
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/&lt;think&gt;[\s\S]*?(?:&lt;\/think&gt;|$)/gi, "")
    .trim();
  const finalMarker = cleaned.match(
    /(?:最终翻译|最终译文|翻译结果|翻译|译文|translation|final translation)\s*[:：]\s*([\s\S]+)$/i,
  );
  if (finalMarker?.[1]) {
    cleaned = finalMarker[1].trim();
  }
  return cleaned
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^[“”"']+|[“”"']+$/g, "")
    .trim();
}

function parseTranslation(raw: unknown): TwitterFeedItem["translation"] {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed.text !== "string") {
    return parsed as TwitterFeedItem["translation"];
  }
  return {
    ...parsed,
    text: cleanStoredTranslationText(parsed.text),
  } as TwitterFeedItem["translation"];
}

function parseQuotedTweet(raw: unknown): TwitterQuotedTweet | null {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed.id !== "string" || !parsed.id) return null;
  const text = stringValue(parsed.text);
  const username = stringValue(parsed.username);
  const translation = parsed.translation as TwitterQuotedTweet["translation"];
  return {
    id: stringValue(parsed.id),
    text,
    createdAt: stringValue(parsed.createdAt),
    username,
    displayName: stringValue(parsed.displayName),
    profileUrl: stringValue(parsed.profileUrl),
    userAvatar: stringValue(parsed.userAvatar) || fallbackXAvatar(username),
    tweetUrl: stringValue(parsed.tweetUrl),
    media: Array.isArray(parsed.media)
      ? (parsed.media as TwitterQuotedTweet["media"]).filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof item.previewUrl === "string" &&
            item.previewUrl.length > 0,
        )
      : [],
    translation: isUsefulTranslation(text, translation) ? translation : null,
    relation:
      parsed.relation === "reply" || parsed.relation === "quote"
        ? parsed.relation
        : "quote",
  };
}

function isCompleteQuotedTweet(
  quotedTweet: TwitterQuotedTweet | null | undefined,
): quotedTweet is TwitterQuotedTweet {
  return Boolean(
    quotedTweet?.id &&
      (quotedTweet.text.trim() || (quotedTweet.media?.length ?? 0) > 0),
  );
}

function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

function accountKey(raw: string): string {
  return sanitizeUsername(raw).toLowerCase();
}

function fallbackProfileUrl(username: string): string {
  return username ? `https://x.com/${username}` : "#";
}

function fallbackAvatar(username: string): string {
  return "";
}

function fallbackXAvatar(username: string): string {
  return username ? `https://unavatar.io/twitter/${username}` : "";
}

function isFallbackAvatarUrl(value: string): boolean {
  return /unavatar\.io\/(?:twitter|x)\//i.test(value);
}

function preferredAvatar({
  incoming,
  cached,
  username,
}: {
  incoming: string;
  cached: string;
  username: string;
}) {
  if (incoming && !isFallbackAvatarUrl(incoming)) return incoming;
  if (cached) return cached;
  return incoming || fallbackAvatar(username);
}

function accountAvatarFor(
  usernameKey: string,
  db: DatabaseSync,
): string {
  const row = db
    .prepare("select avatar from x_accounts where username_key = ?")
    .get(usernameKey) as DbRow | undefined;
  return stringValue(row?.avatar);
}

export function openXPipelineDb(path = getXPipelineConfig().dbPath) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma busy_timeout = 5000");
  initXPipelineDb(db);
  return db;
}

export function getXPipelineDb() {
  if (!sharedDb) {
    sharedDb = openXPipelineDb();
  }
  return sharedDb;
}

export function closeXPipelineDb() {
  if (!sharedDb) return;
  sharedDb.close();
  sharedDb = null;
}

export function initXPipelineDb(db: DatabaseSync) {
  db.exec(`
    create table if not exists x_accounts (
      username_key text primary key,
      username text not null,
      remote_id integer,
      name text not null,
      profile_url text not null,
      avatar text,
      note text not null default '',
      tags_json text not null default '[]',
      enabled integer not null default 1,
      last_event_at text,
      last_error text,
      updated_at text not null
    );

    create table if not exists x_feed (
      id text primary key,
      account_username_key text not null,
      username text not null,
      display_name text not null,
      profile_url text not null,
      user_avatar text not null,
      tweet_url text not null,
      text text not null,
      created_at text not null,
      event_type text not null,
      origin text not null,
      query_label text not null,
      hashtags_json text not null default '[]',
      likes integer not null default 0,
      retweets integer not null default 0,
      replies integer not null default 0,
      quotes integer not null default 0,
      views integer not null default 0,
      media_json text not null default '[]',
      quoted_tweet_json text,
      translation_json text,
      remark text not null default '',
      raw_json text not null default '{}',
      inserted_at text not null,
      updated_at text not null
    );

    create table if not exists x_health (
      scope text primary key,
      status text not null,
      detail text not null,
      updated_at text not null
    );

    create table if not exists x_quoted_tweets (
      id text primary key,
      quoted_tweet_json text not null,
      inserted_at text not null,
      updated_at text not null
    );

    create table if not exists x_hybrid_sources (
      source_id text primary key,
      status text not null,
      detail text not null,
      tweet_id text,
      updated_at text not null
    );

    create table if not exists x_hybrid_account_fetches (
      username_key text primary key,
      username text not null,
      fetched_at text not null,
      updated_at text not null
    );

    create table if not exists x_api_usage_daily (
      date_key text primary key,
      time_zone text not null,
      points_used integer not null default 0,
      authorized integer not null default 0,
      authorized_at text,
      updated_at text not null
    );

    create table if not exists x_api_usage_events (
      id integer primary key autoincrement,
      date_key text not null,
      kind text not null,
      points integer not null,
      status text not null,
      detail text not null default '',
      created_at text not null
    );

    create index if not exists x_feed_created_at_idx
      on x_feed(created_at desc);
    create index if not exists x_feed_account_idx
      on x_feed(account_username_key, created_at desc);
  `);
  try {
    db.exec("alter table x_feed add column media_json text not null default '[]'");
  } catch {}
  try {
    db.exec("alter table x_feed add column quoted_tweet_json text");
  } catch {}
}

export function getXHybridAccountFetchStatus(
  username: string,
  options: {
    cooldownMs: number;
    now?: Date;
    db?: DatabaseSync;
  },
): XHybridAccountFetchStatus {
  const cleanUsername = sanitizeUsername(username);
  const usernameKey = accountKey(cleanUsername);
  if (!usernameKey) {
    return {
      username: cleanUsername,
      lastFetchedAt: null,
      nextAllowedAt: null,
      isCoolingDown: false,
    };
  }

  const db = options.db ?? getXPipelineDb();
  const row = db
    .prepare("select * from x_hybrid_account_fetches where username_key = ?")
    .get(usernameKey);
  const lastFetchedAt = nullableString(row?.fetched_at);
  const lastFetchedMs = lastFetchedAt ? Date.parse(lastFetchedAt) : Number.NaN;
  if (!Number.isFinite(lastFetchedMs) || options.cooldownMs <= 0) {
    return {
      username: stringValue(row?.username) || cleanUsername,
      lastFetchedAt,
      nextAllowedAt: null,
      isCoolingDown: false,
    };
  }

  const nextAllowedMs = lastFetchedMs + options.cooldownMs;
  const nowMs = options.now?.getTime() ?? Date.now();
  return {
    username: stringValue(row?.username) || cleanUsername,
    lastFetchedAt,
    nextAllowedAt: new Date(nextAllowedMs).toISOString(),
    isCoolingDown: nowMs < nextAllowedMs,
  };
}

export function markXHybridAccountFetched(
  username: string,
  fetchedAt = nowIso(),
  db = getXPipelineDb(),
) {
  const cleanUsername = sanitizeUsername(username);
  const usernameKey = accountKey(cleanUsername);
  if (!usernameKey) return;

  run(
    db.prepare(`
      insert into x_hybrid_account_fetches(username_key, username, fetched_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(username_key) do update set
        username = excluded.username,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at
    `),
    usernameKey,
    cleanUsername,
    fetchedAt,
    nowIso(),
  );
}

export function getXHybridSourceStatus(
  sourceId: string,
  db = getXPipelineDb(),
): XHybridSourceStatus | null {
  const row = db
    .prepare("select * from x_hybrid_sources where source_id = ?")
    .get(sourceId);
  if (!row) return null;
  return {
    sourceId: stringValue(row.source_id),
    status: stringValue(row.status) as XHybridSourceStatus["status"],
    detail: stringValue(row.detail),
    tweetId: nullableString(row.tweet_id),
    updatedAt: stringValue(row.updated_at),
  };
}

export function markXHybridSource(
  input: XHybridSourceInput,
  db = getXPipelineDb(),
) {
  run(
    db.prepare(`
      insert into x_hybrid_sources(source_id, status, detail, tweet_id, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(source_id) do update set
        status = excluded.status,
        detail = excluded.detail,
        tweet_id = excluded.tweet_id,
        updated_at = excluded.updated_at
    `),
    input.sourceId,
    input.status,
    input.detail,
    input.tweetId,
    nowIso(),
  );
}

export function upsertXPipelineAccount(
  input: XPipelineAccountInput,
  db = getXPipelineDb(),
) {
  const username = sanitizeUsername(input.username);
  const usernameKey = accountKey(username);
  if (!usernameKey) return;

  const updatedAt = nowIso();
  run(
    db.prepare(`
      insert into x_accounts
        (
          username_key, username, remote_id, name, profile_url, avatar, note,
          tags_json, enabled, updated_at
        )
      values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      on conflict(username_key) do update set
        username = excluded.username,
        remote_id = coalesce(excluded.remote_id, x_accounts.remote_id),
        name = excluded.name,
        profile_url = excluded.profile_url,
        avatar = case
          when trim(coalesce(excluded.avatar, '')) = '' then x_accounts.avatar
          when lower(excluded.avatar) like '%unavatar.io/twitter/%'
            and trim(coalesce(x_accounts.avatar, '')) != '' then x_accounts.avatar
          when lower(excluded.avatar) like '%unavatar.io/x/%'
            and trim(coalesce(x_accounts.avatar, '')) != '' then x_accounts.avatar
          else excluded.avatar
        end,
        note = excluded.note,
        tags_json = excluded.tags_json,
        enabled = 1,
        updated_at = excluded.updated_at
    `),
    usernameKey,
    username,
    input.id ?? null,
    input.name || username,
    input.profileUrl || fallbackProfileUrl(username),
    input.avatar || null,
    input.note || "",
    jsonString(input.tags ?? []),
    updatedAt,
  );
}

export function disableXPipelineAccountsExcept(
  usernames: string[],
  db = getXPipelineDb(),
) {
  const keys = Array.from(new Set(usernames.map(accountKey).filter(Boolean)));
  const updatedAt = nowIso();
  if (keys.length === 0) {
    run(db.prepare("update x_accounts set enabled = 0, updated_at = ?"), updatedAt);
    return;
  }

  const placeholders = keys.map(() => "?").join(", ");
  run(
    db.prepare(`
      update x_accounts
      set enabled = case when username_key in (${placeholders}) then 1 else 0 end,
          updated_at = ?
    `),
    ...keys,
    updatedAt,
  );
}

function upsertFeedItem(
  feedItem: TwitterFeedItem,
  eventType: string,
  remark: string,
  raw: Record<string, unknown>,
  db: DatabaseSync,
) {
  const username = sanitizeUsername(feedItem.username);
  const usernameKey = accountKey(username);
  if (!feedItem.id || !usernameKey) return;

  const updatedAt = nowIso();
  const quotedTweet = feedItem.quotedTweet;
  const incomingUserAvatar = feedItem.userAvatar || "";
  const resolvedUserAvatar = preferredAvatar({
    incoming: incomingUserAvatar,
    cached: accountAvatarFor(usernameKey, db),
    username,
  });
  const usefulTranslation = isUsefulTranslation(feedItem.text, feedItem.translation)
    ? feedItem.translation
    : null;
  const createdAt = isoDateString(feedItem.createdAt);
  if (isCompleteQuotedTweet(quotedTweet)) {
    upsertXPipelineQuotedTweet(quotedTweet, db);
  }
  run(
    db.prepare(`
      insert into x_feed
        (
          id, account_username_key, username, display_name, profile_url,
          user_avatar, tweet_url, text, created_at, event_type, origin,
          query_label, hashtags_json, likes, retweets, replies, quotes, views,
          media_json, quoted_tweet_json, translation_json, remark, raw_json,
          inserted_at, updated_at
        )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        account_username_key = excluded.account_username_key,
        username = excluded.username,
        display_name = excluded.display_name,
        profile_url = excluded.profile_url,
        user_avatar = case
          when lower(excluded.user_avatar) like '%unavatar.io/twitter/%'
            and trim(coalesce(x_feed.user_avatar, '')) != '' then x_feed.user_avatar
          when lower(excluded.user_avatar) like '%unavatar.io/x/%'
            and trim(coalesce(x_feed.user_avatar, '')) != '' then x_feed.user_avatar
          when trim(coalesce(json_extract(excluded.raw_json, '$.feedItem.userAvatar'), '')) != ''
            then excluded.user_avatar
          when trim(coalesce(x_feed.user_avatar, '')) != ''
            then x_feed.user_avatar
          else excluded.user_avatar
        end,
        tweet_url = excluded.tweet_url,
        text = excluded.text,
        created_at = excluded.created_at,
        event_type = excluded.event_type,
        origin = excluded.origin,
        query_label = excluded.query_label,
        hashtags_json = excluded.hashtags_json,
        likes = excluded.likes,
        retweets = excluded.retweets,
        replies = excluded.replies,
        quotes = excluded.quotes,
        views = excluded.views,
        media_json = excluded.media_json,
        quoted_tweet_json = excluded.quoted_tweet_json,
        translation_json = excluded.translation_json,
        remark = excluded.remark,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `),
    feedItem.id,
    usernameKey,
    username,
    feedItem.displayName || username,
    feedItem.profileUrl || fallbackProfileUrl(username),
    resolvedUserAvatar,
    feedItem.tweetUrl || fallbackProfileUrl(username),
    feedItem.text,
    createdAt,
    eventType,
    feedItem.origin,
    feedItem.queryLabel,
    jsonString(feedItem.hashtags),
    feedItem.likes,
    feedItem.retweets,
    feedItem.replies,
    feedItem.quotes,
    feedItem.views,
    jsonString(feedItem.media ?? []),
    feedItem.quotedTweet ? jsonString(feedItem.quotedTweet) : null,
    usefulTranslation ? jsonString(usefulTranslation) : null,
    remark,
    jsonString(raw),
    updatedAt,
    updatedAt,
  );

  run(
    db.prepare(`
      update x_accounts
      set
        last_event_at = case
          when last_event_at is null or ? > last_event_at then ?
          else last_event_at
        end,
        last_error = null,
        updated_at = ?
      where username_key = ?
    `),
    createdAt,
    createdAt,
    updatedAt,
    usernameKey,
  );
}

export function upsertXPipelineQuotedTweet(
  quotedTweet: TwitterQuotedTweet,
  db = getXPipelineDb(),
) {
  if (!isCompleteQuotedTweet(quotedTweet)) return;
  const updatedAt = nowIso();
  run(
    db.prepare(`
      insert into x_quoted_tweets(id, quoted_tweet_json, inserted_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set
        quoted_tweet_json = excluded.quoted_tweet_json,
        updated_at = excluded.updated_at
    `),
    quotedTweet.id,
    jsonString(quotedTweet),
    updatedAt,
    updatedAt,
  );
}

export function getXPipelineQuotedTweet(
  id: string,
  db = getXPipelineDb(),
): TwitterQuotedTweet | null {
  const row = db
    .prepare("select quoted_tweet_json from x_quoted_tweets where id = ?")
    .get(id) as DbRow | undefined;
  return row ? parseQuotedTweet(row.quoted_tweet_json) : null;
}

export function upsertXPipelineRealtimeUpdate(
  update: TwitterRealtimeUpdate,
  db = getXPipelineDb(),
) {
  upsertXPipelineAccount(
    {
      username: update.account || update.feedItem.username,
      name: update.displayName || update.feedItem.displayName,
      profileUrl: update.profileUrl || update.feedItem.profileUrl,
      avatar: update.feedItem.userAvatar,
      note: update.remark || "",
      tags: [],
    },
    db,
  );
  upsertFeedItem(
    update.feedItem,
    update.eventType,
    update.remark,
    {
      eventType: update.eventType,
      account: update.account,
      displayName: update.displayName,
      createdAt: update.createdAt,
      profileUrl: update.profileUrl,
      remark: update.remark,
      feedItem: update.feedItem,
    },
    db,
  );
}

export function listXPipelineTranslationCandidates(
  limit = 20,
  db = getXPipelineDb(),
) {
  const scanLimit = Math.max(limit * 5, limit);
  return db
    .prepare(
      `
      select id, text, translation_json
      from x_feed
      where trim(text) != ''
        and (
          translation_json is null
          or translation_json like '%"provider":"985monitor"%'
          or translation_json like '%"provider": "985monitor"%'
        )
      order by created_at desc, updated_at desc
      limit ?
    `,
    )
    .all(scanLimit)
    .filter((row) => {
      const text = stringValue(row.text);
      return !isUsefulTranslation(text, parseTranslation(row.translation_json));
    })
    .slice(0, limit)
    .map((row) => ({
      id: stringValue(row.id),
      text: stringValue(row.text),
    }));
}

export function setXPipelineFeedTranslation(
  id: string,
  translation: TranslationNote | null,
  db = getXPipelineDb(),
) {
  run(
    db.prepare(`
      update x_feed
      set translation_json = ?, updated_at = ?
      where id = ?
    `),
    translation ? jsonString(translation) : null,
    nowIso(),
    id,
  );
}

export function getXPipelineFeedItem(
  id: string,
  db = getXPipelineDb(),
): TwitterFeedItem | null {
  const row = db.prepare("select * from x_feed where id = ?").get(id);
  return row ? toFeedItem(row as DbRow) : null;
}

export function importXPipelineSnapshot(
  snapshot: TwitterDashboardSnapshot,
  db = getXPipelineDb(),
) {
  for (const account of snapshot.watchAccounts) {
    upsertXPipelineAccount(
      {
        id: account.id,
        username: account.username,
        name: account.name,
        profileUrl: account.profileUrl,
        avatar: account.avatar,
        note: account.note,
        tags: [],
      },
      db,
    );
  }

  for (const feedItem of snapshot.feed) {
    upsertXPipelineAccount(
      {
        username: feedItem.username,
        name: feedItem.displayName,
        profileUrl: feedItem.profileUrl,
        avatar: feedItem.userAvatar,
        note: "imported snapshot",
        tags: [],
      },
      db,
    );
    upsertFeedItem(
      feedItem,
      "CACHE_IMPORT",
      "imported snapshot",
      { feedItem },
      db,
    );
  }
}

export function setXPipelineHealth(
  input: XPipelineHealthInput,
  db = getXPipelineDb(),
) {
  run(
    db.prepare(`
      insert into x_health(scope, status, detail, updated_at)
      values (?, ?, ?, ?)
      on conflict(scope) do update set
        status = excluded.status,
        detail = excluded.detail,
        updated_at = excluded.updated_at
    `),
    input.scope,
    input.status,
    input.detail,
    nowIso(),
  );
}

export function getXPipelineHealth(
  scope = "collector",
  db = getXPipelineDb(),
): XPipelineHealthStatus | null {
  const row = db
    .prepare("select * from x_health where scope = ?")
    .get(scope) as DbRow | undefined;
  if (!row) return null;
  return {
    scope: stringValue(row.scope),
    status: stringValue(row.status) as XPipelineHealthInput["status"],
    detail: stringValue(row.detail),
    updatedAt: stringValue(row.updated_at),
  };
}

function toWatchAccount(row: DbRow): TwitterWatchAccount {
  const username = stringValue(row.username);
  const remoteId = row.remote_id === null ? null : numberValue(row.remote_id);
  return {
    id: remoteId !== null && remoteId > 0 ? remoteId : null,
    username,
    name: stringValue(row.name) || username,
    profileUrl: stringValue(row.profile_url) || fallbackProfileUrl(username),
    avatar: nullableString(row.avatar) || fallbackAvatar(username),
    note: stringValue(row.note),
  };
}

function toFeedItem(row: DbRow): TwitterFeedItem {
  const username = stringValue(row.username);
  const text = stringValue(row.text);
  const translation = parseTranslation(row.translation_json);
  return {
    id: stringValue(row.id),
    text,
    createdAt: stringValue(row.created_at),
    username,
    displayName: stringValue(row.display_name),
    profileUrl: stringValue(row.profile_url),
    userAvatar:
      stringValue(row.user_avatar) ||
      stringValue(row.account_avatar) ||
      fallbackAvatar(username),
    tweetUrl: stringValue(row.tweet_url),
    hashtags: parseJsonArray(row.hashtags_json),
    likes: numberValue(row.likes),
    retweets: numberValue(row.retweets),
    replies: numberValue(row.replies),
    quotes: numberValue(row.quotes),
    views: numberValue(row.views),
    media: parseMediaArray(row.media_json),
    quotedTweet: parseQuotedTweet(row.quoted_tweet_json),
    origin: stringValue(row.origin) === "search" ? "search" : "watch",
    queryLabel: stringValue(row.query_label),
    translation: isUsefulTranslation(text, translation) ? translation : null,
  };
}

function snapshotStatus(
  health: DbRow | undefined,
  feedCount: number,
): TwitterDashboardSnapshot["status"] {
  if (!hasXPipelineDataSource()) return "needs_token";
  if (!isXPipelineEnabled() && !isMonitor985Enabled()) return "paused";

  const status = stringValue(health?.status);
  if (status === "error" && feedCount === 0) return "error";
  return "live";
}

function snapshotConnected(health: DbRow | undefined): boolean {
  if (!hasXPipelineDataSource()) return false;
  if (!isXPipelineEnabled() && !isMonitor985Enabled()) return false;
  const status = stringValue(health?.status);
  return ["connected", "subscribed", "live"].includes(status);
}

export function getXPipelineSnapshot(
  limit = getXPipelineConfig().maxFeedItems,
  db = getXPipelineDb(),
): TwitterDashboardSnapshot {
  const watchAccounts = db
    .prepare("select * from x_accounts where enabled = 1 order by lower(username) asc")
    .all()
    .map(toWatchAccount);

  const feed = (db.prepare(`
    select f.*, a.avatar as account_avatar
    from x_feed f
    inner join x_accounts a on a.username_key = f.account_username_key
    where a.enabled = 1
  `).all() as DbRow[])
    .sort(compareFeedRowsByTime)
    .slice(0, limit)
    .map(toFeedItem);

  const health = db
    .prepare("select * from x_health where scope = 'collector'")
    .get() as DbRow | undefined;
  const status = snapshotStatus(health, feed.length);
  const healthStatus = stringValue(health?.status);
  const errors =
    healthStatus === "error" ? [stringValue(health?.detail)].filter(Boolean) : [];

  return {
    provider: "6551",
    baseUrl: getXPipelineConfig().baseUrl,
    isConfigured: hasXPipelineDataSource(),
    isConnected: snapshotConnected(health),
    status,
    watchAccounts,
    trackedKeywords: getXPipelineTrackedKeywords(),
    feed,
    usage: getXApiUsageSnapshot({ db }),
    note:
      "X pipeline reads local SQLite only. Page refresh and browser reconnects do not call 6551 REST.",
    errors,
  };
}

export function getXPipelineLatestUpdatedAt(db = getXPipelineDb()) {
  const row = db
    .prepare(
      `
      select max(updated_at) as updated_at from (
        select updated_at from x_feed
        union all
        select updated_at from x_accounts
        union all
        select updated_at from x_health
        union all
        select updated_at from x_api_usage_daily
      )
    `,
    )
    .get();
  return nullableString(row?.updated_at);
}
