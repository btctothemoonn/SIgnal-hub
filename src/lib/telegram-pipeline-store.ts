import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  TelegramChannelWatch,
  TelegramDashboardSnapshot,
  TelegramFeedItem,
  TelegramMediaPreview,
  TelegramQuotedMessage,
} from "@/lib/telegram-channels";
import type { TranslationNote } from "@/lib/translate";
import { getTelegramPipelineConfig } from "./telegram-pipeline-config.ts";
import { shouldSkipTelegramChannelTranslation } from "./telegram-translation-policy.ts";
import { isTelegramXSourceChannel } from "./telegram-x-source-channels.ts";

type DbValue = string | number | null;
type DbRow = Record<string, unknown>;

export type PipelineChannelInput = {
  ref: string;
  title: string;
  username: string;
  channelId: string;
  link: string;
  avatar: string | null;
  avatarUpdatedAt: string | null;
  tags?: string[];
};

export type PipelineMessageInput = {
  channelRef: string;
  channelTitle: string;
  channelUsername: string;
  channelId: string;
  channelLink: string;
  channelAvatar: string | null;
  messageId: number;
  messageUrl: string;
  text: string;
  createdAt: string;
  views: number;
  forwards: number;
  origin: "history" | "realtime";
  media: TelegramMediaPreview | null;
  translation?: TranslationNote | null;
  quotedMessage?: TelegramQuotedMessage | null;
  raw?: Record<string, unknown>;
};

type HealthInput = {
  scope: string;
  status: "starting" | "live" | "stale" | "error";
  detail: string;
};

const MIN_TELEGRAM_HEALTH_STALE_MS = 10 * 60_000;
const TELEGRAM_HEALTH_STALE_INTERVALS = 3;

let sharedDb: DatabaseSync | null = null;

function nowIso() {
  return new Date().toISOString();
}

function getTelegramPipelineHealthStaleMs() {
  return Math.max(
    MIN_TELEGRAM_HEALTH_STALE_MS,
    getTelegramPipelineConfig().backfillIntervalMs * TELEGRAM_HEALTH_STALE_INTERVALS,
  );
}

export function isTelegramPipelineHealthStale(
  updatedAt: string | null,
  servedAt = nowIso(),
  staleMs = getTelegramPipelineHealthStaleMs(),
) {
  if (!updatedAt) {
    return false;
  }

  const updatedAtMs = new Date(updatedAt).getTime();
  const servedAtMs = new Date(servedAt).getTime();
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(servedAtMs)) {
    return false;
  }

  return servedAtMs - updatedAtMs > staleMs;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
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

function parseTranslation(raw: unknown): TelegramFeedItem["translation"] {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed.text !== "string") {
    return parsed as TelegramFeedItem["translation"];
  }
  return {
    ...parsed,
    text: cleanStoredTranslationText(parsed.text),
  } as TelegramFeedItem["translation"];
}

function parseMediaPreview(raw: unknown): TelegramMediaPreview | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = stringValue(record.kind);
  const previewUrl = stringValue(record.previewUrl);
  if (!previewUrl || !["image", "sticker", "video", "gif"].includes(kind)) {
    return null;
  }
  return {
    kind: kind as TelegramMediaPreview["kind"],
    mimeType: stringValue(record.mimeType),
    previewUrl,
    label: stringValue(record.label) || "媒体预览",
    width: record.width === null ? null : numberValue(record.width),
    height: record.height === null ? null : numberValue(record.height),
  };
}

function parseQuotedMessage(raw: unknown): TelegramQuotedMessage | null {
  const quoted = parseJsonObject(raw);
  if (!quoted) return null;
  const id = stringValue(quoted.id);
  const messageUrl = stringValue(quoted.messageUrl);
  if (!id && !messageUrl) return null;
  return {
    id,
    text: stringValue(quoted.text),
    createdAt: stringValue(quoted.createdAt),
    channelTitle: stringValue(quoted.channelTitle),
    channelUsername: stringValue(quoted.channelUsername),
    messageUrl,
    media: parseMediaPreview(quoted.media),
  };
}

function run(stmt: StatementSync, ...values: DbValue[]) {
  return stmt.run(...values);
}

function changedRows(result: unknown): number {
  if (!result || typeof result !== "object" || !("changes" in result)) {
    return 0;
  }
  const changes = (result as { changes?: unknown }).changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
}

export function openTelegramPipelineDb(path = getTelegramPipelineConfig().dbPath) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma busy_timeout = 5000");
  initTelegramPipelineDb(db);
  return db;
}

export function getTelegramPipelineDb() {
  if (!sharedDb) {
    sharedDb = openTelegramPipelineDb();
  }
  return sharedDb;
}

export function closeTelegramPipelineDb() {
  if (!sharedDb) return;
  sharedDb.close();
  sharedDb = null;
}

export function initTelegramPipelineDb(db: DatabaseSync) {
  db.exec(`
    create table if not exists telegram_channels (
      ref text primary key,
      title text not null,
      username text not null,
      channel_id text not null unique,
      link text not null,
      avatar text,
      avatar_updated_at text,
      tags_json text not null default '[]',
      enabled integer not null default 1,
      last_message_id integer,
      last_message_at text,
      last_backfill_at text,
      last_error text,
      consecutive_failures integer not null default 0,
      updated_at text not null
    );

    create table if not exists telegram_messages (
      id text primary key,
      channel_ref text not null,
      channel_title text not null,
      channel_username text not null,
      channel_id text not null,
      channel_link text not null,
      channel_avatar text,
      message_id integer not null,
      message_url text not null,
      text text not null,
      created_at text not null,
      views integer not null default 0,
      forwards integer not null default 0,
      origin text not null,
      media_kind text,
      media_mime_type text,
      media_preview_url text,
      media_label text,
      media_width integer,
      media_height integer,
      translation_json text,
      quoted_message_json text,
      raw_json text not null default '{}',
      inserted_at text not null,
      updated_at text not null,
      unique(channel_id, message_id)
    );

    create table if not exists telegram_health (
      scope text primary key,
      status text not null,
      detail text not null,
      updated_at text not null
    );

    create index if not exists telegram_messages_created_at_idx
      on telegram_messages(created_at desc);
    create index if not exists telegram_messages_channel_idx
      on telegram_messages(channel_id, message_id desc);
  `);

  try {
    db.exec("alter table telegram_messages add column translation_json text");
  } catch {}
  try {
    db.exec("alter table telegram_messages add column quoted_message_json text");
  } catch {}
}

export function upsertTelegramPipelineChannel(
  input: PipelineChannelInput,
  db = getTelegramPipelineDb(),
) {
  const updatedAt = nowIso();
  const updatedByChannelId = run(
    db.prepare(`
      update telegram_channels
      set
        ref = ?,
        title = ?,
        username = ?,
        link = ?,
        avatar = coalesce(?, avatar),
        avatar_updated_at = coalesce(?, avatar_updated_at),
        tags_json = ?,
        enabled = 1,
        updated_at = ?
      where channel_id = ?
    `),
    input.ref,
    input.title,
    input.username,
    input.link,
    input.avatar,
    input.avatarUpdatedAt,
    jsonString(input.tags ?? []),
    updatedAt,
    input.channelId,
  );
  if (changedRows(updatedByChannelId) > 0) {
    return;
  }

  run(
    db.prepare(`
      insert into telegram_channels
        (ref, title, username, channel_id, link, avatar, avatar_updated_at, tags_json, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(ref) do update set
        title = excluded.title,
        username = excluded.username,
        channel_id = excluded.channel_id,
        link = excluded.link,
        avatar = coalesce(excluded.avatar, telegram_channels.avatar),
        avatar_updated_at = coalesce(excluded.avatar_updated_at, telegram_channels.avatar_updated_at),
        tags_json = excluded.tags_json,
        enabled = 1,
        updated_at = excluded.updated_at
    `),
    input.ref,
    input.title,
    input.username,
    input.channelId,
    input.link,
    input.avatar,
    input.avatarUpdatedAt,
    jsonString(input.tags ?? []),
    updatedAt,
  );
}

export function listTelegramPipelineChannels(db = getTelegramPipelineDb()) {
  return db
    .prepare(
      "select * from telegram_channels where enabled = 1 order by lower(ref) asc",
    )
    .all()
    .map((row) => ({
      ref: stringValue(row.ref),
      title: stringValue(row.title),
      username: stringValue(row.username),
      channelId: stringValue(row.channel_id),
      link: stringValue(row.link),
      avatar: nullableString(row.avatar),
      avatarUpdatedAt: nullableString(row.avatar_updated_at),
      lastMessageId: numberValue(row.last_message_id),
      lastMessageAt: nullableString(row.last_message_at),
      lastBackfillAt: nullableString(row.last_backfill_at),
    }));
}

export function disableTelegramPipelineChannelsExcept(
  refs: string[],
  db = getTelegramPipelineDb(),
) {
  const keys = Array.from(
    new Set(
      refs
        .map((ref) => ref.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const updatedAt = nowIso();
  if (keys.length === 0) {
    run(
      db.prepare("update telegram_channels set enabled = 0, updated_at = ?"),
      updatedAt,
    );
    return;
  }

  const placeholders = keys.map(() => "?").join(", ");
  run(
    db.prepare(`
      update telegram_channels
      set enabled = case when lower(ref) in (${placeholders}) then 1 else 0 end,
          updated_at = ?
    `),
    ...keys,
    updatedAt,
  );
}

export function upsertTelegramPipelineMessage(
  input: PipelineMessageInput,
  db = getTelegramPipelineDb(),
) {
  const id = `${input.channelId}:${input.messageId}`;
  const updatedAt = nowIso();
  run(
    db.prepare(`
      insert into telegram_messages
        (
          id, channel_ref, channel_title, channel_username, channel_id, channel_link,
          channel_avatar, message_id, message_url, text, created_at, views, forwards,
          origin, media_kind, media_mime_type, media_preview_url, media_label,
          media_width, media_height, translation_json, quoted_message_json,
          raw_json, inserted_at, updated_at
        )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        channel_title = excluded.channel_title,
        channel_username = excluded.channel_username,
        channel_link = excluded.channel_link,
        channel_avatar = coalesce(excluded.channel_avatar, telegram_messages.channel_avatar),
        text = excluded.text,
        views = excluded.views,
        forwards = excluded.forwards,
        media_kind = coalesce(excluded.media_kind, telegram_messages.media_kind),
        media_mime_type = coalesce(excluded.media_mime_type, telegram_messages.media_mime_type),
        media_preview_url = coalesce(excluded.media_preview_url, telegram_messages.media_preview_url),
        media_label = coalesce(excluded.media_label, telegram_messages.media_label),
        media_width = coalesce(excluded.media_width, telegram_messages.media_width),
        media_height = coalesce(excluded.media_height, telegram_messages.media_height),
        translation_json = coalesce(excluded.translation_json, telegram_messages.translation_json),
        quoted_message_json = coalesce(excluded.quoted_message_json, telegram_messages.quoted_message_json),
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `),
    id,
    input.channelRef,
    input.channelTitle,
    input.channelUsername,
    input.channelId,
    input.channelLink,
    input.channelAvatar,
    input.messageId,
    input.messageUrl,
    input.text,
    input.createdAt,
    input.views,
    input.forwards,
    input.origin,
    input.media?.kind ?? null,
    input.media?.mimeType ?? null,
    input.media?.previewUrl ?? null,
    input.media?.label ?? null,
    input.media?.width ?? null,
    input.media?.height ?? null,
    input.translation ? jsonString(input.translation) : null,
    input.quotedMessage ? jsonString(input.quotedMessage) : null,
    jsonString(input.raw ?? {}),
    updatedAt,
    updatedAt,
  );

  run(
    db.prepare(`
      update telegram_channels
      set
        last_message_id = case
          when last_message_id is null or ? > last_message_id then ?
          else last_message_id
        end,
        last_message_at = case
          when last_message_at is null or ? > last_message_at then ?
          else last_message_at
        end,
        last_error = null,
        consecutive_failures = 0,
        updated_at = ?
      where ref = ?
    `),
    input.messageId,
    input.messageId,
    input.createdAt,
    input.createdAt,
    updatedAt,
    input.channelRef,
  );
}

export function listTelegramPipelineTranslationCandidates(
  limit = 20,
  db = getTelegramPipelineDb(),
) {
  return db
    .prepare(
      `
      select id, text, channel_ref, channel_title, channel_username
      from telegram_messages
      where translation_json is null
        and trim(text) != ''
      order by created_at desc, message_id desc
      limit ?
    `,
    )
    .all(limit)
    .filter(
      (row) =>
        !shouldSkipTelegramChannelTranslation({
          channelUsername: stringValue(row.channel_username),
          channelRef: stringValue(row.channel_ref),
          channelTitle: stringValue(row.channel_title),
        }),
    )
    .map((row) => ({
      id: stringValue(row.id),
      text: stringValue(row.text),
    }));
}

export function setTelegramPipelineMessageTranslation(
  id: string,
  translation: TranslationNote | null,
  db = getTelegramPipelineDb(),
) {
  run(
    db.prepare(`
      update telegram_messages
      set translation_json = ?, updated_at = ?
      where id = ?
    `),
    translation ? jsonString(translation) : null,
    nowIso(),
    id,
  );
}

export function markTelegramPipelineBackfill(
  ref: string,
  error: string | null,
  db = getTelegramPipelineDb(),
) {
  const updatedAt = nowIso();
  if (error) {
    run(
      db.prepare(`
        update telegram_channels
        set last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
        where ref = ?
      `),
      error,
      updatedAt,
      ref,
    );
    return;
  }

  run(
    db.prepare(`
      update telegram_channels
      set last_backfill_at = ?, last_error = null, consecutive_failures = 0, updated_at = ?
      where ref = ?
    `),
    updatedAt,
    updatedAt,
    ref,
  );
}

export function setTelegramPipelineHealth(
  input: HealthInput,
  db = getTelegramPipelineDb(),
) {
  run(
    db.prepare(`
      insert into telegram_health(scope, status, detail, updated_at)
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

function toChannelWatch(row: DbRow): TelegramChannelWatch {
  return {
    ref: stringValue(row.ref),
    title: stringValue(row.title),
    username: stringValue(row.username),
    channelId: stringValue(row.channel_id),
    link: stringValue(row.link),
    access: "mtproto",
    note: "Telegram Pipeline 本地持久化采集",
    avatar: nullableString(row.avatar),
  };
}

function toFeedItem(row: DbRow): TelegramFeedItem {
  let media: TelegramMediaPreview | null = null;
  const translation = parseTranslation(row.translation_json);
  const quotedMessage = parseQuotedMessage(row.quoted_message_json);
  const mediaKind = nullableString(row.media_kind);
  const mediaUrl = nullableString(row.media_preview_url);
  if (
    mediaKind &&
    mediaUrl &&
    ["image", "sticker", "video", "gif"].includes(mediaKind)
  ) {
    media = {
      kind: mediaKind as TelegramMediaPreview["kind"],
      mimeType: nullableString(row.media_mime_type) ?? "",
      previewUrl: mediaUrl,
      label: nullableString(row.media_label) ?? "媒体预览",
      width: row.media_width === null ? null : numberValue(row.media_width),
      height: row.media_height === null ? null : numberValue(row.media_height),
    };
  }

  return {
    id: `${stringValue(row.channel_id)}:${numberValue(row.message_id)}`,
    channelRef: stringValue(row.channel_ref),
    channelTitle: stringValue(row.channel_title),
    channelUsername: stringValue(row.channel_username),
    channelId: stringValue(row.channel_id),
    channelLink: stringValue(row.channel_link),
    channelAvatar:
      nullableString(row.current_channel_avatar) ?? nullableString(row.channel_avatar),
    messageUrl: stringValue(row.message_url),
    text: stringValue(row.text),
    createdAt: stringValue(row.created_at),
    views: numberValue(row.views),
    forwards: numberValue(row.forwards),
    origin: stringValue(row.origin) === "realtime" ? "realtime" : "history",
    media,
    translation,
    quotedMessage,
  };
}

export function getTelegramPipelineSnapshot(
  limit = 300,
  db = getTelegramPipelineDb(),
): TelegramDashboardSnapshot {
  const channels = db
    .prepare("select * from telegram_channels where enabled = 1 order by lower(ref) asc")
    .all()
    .map(toChannelWatch)
    .filter((channel) => !isTelegramXSourceChannel(channel));

  const feed = db
    .prepare(
      `
      select
        telegram_messages.*,
        telegram_channels.avatar as current_channel_avatar
      from telegram_messages
      left join telegram_channels
        on telegram_channels.channel_id = telegram_messages.channel_id
      order by telegram_messages.created_at desc, telegram_messages.message_id desc
    `,
    )
    .all()
    .map(toFeedItem)
    .filter(
      (item) =>
        !isTelegramXSourceChannel({
          ref: item.channelRef,
          username: item.channelUsername,
          channelId: item.channelId,
          title: item.channelTitle,
        }),
    )
    .slice(0, limit);

  const health = db
    .prepare("select * from telegram_health where scope = 'collector'")
    .get();
  const servedAt = nowIso();
  const status = stringValue(health?.status);
  const healthUpdatedAt = nullableString(health?.updated_at);
  const healthStale =
    status !== "" &&
    status !== "error" &&
    isTelegramPipelineHealthStale(healthUpdatedAt, servedAt);
  const healthError = status === "error"
    ? nullableString(health?.detail)
    : healthStale
      ? `TG collector heartbeat stale since ${healthUpdatedAt}; signal-hub-telegram may be stopped.`
      : null;
  const snapshotStatus =
    status === "error" || healthStale
      ? "error"
      : feed.length > 0
        ? "live"
        : "limited";

  return {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: status === "live" && !healthStale,
    status: snapshotStatus,
    channels,
    feed,
    note: "Telegram Pipeline 本地持久化缓存；页面不再直接请求 Telegram。",
    errors: healthError ? [healthError] : [],
    refresh: {
      source: "cache",
      servedAt,
      startedAt: null,
      finishedAt: healthUpdatedAt,
      durationMs: null,
      cacheFetchedAt: healthUpdatedAt,
    },
  };
}

export function getTelegramPipelineLatestUpdatedAt(db = getTelegramPipelineDb()) {
  const row = db
    .prepare(
      `
      select max(updated_at) as updated_at from (
        select updated_at from telegram_messages
        union all
        select updated_at from telegram_channels
        union all
        select updated_at from telegram_health
      )
    `,
    )
    .get();
  return nullableString(row?.updated_at);
}

export function getTelegramPipelineRawMessage(
  channelId: string,
  messageId: number,
  db = getTelegramPipelineDb(),
) {
  const row = db
    .prepare("select raw_json from telegram_messages where channel_id = ? and message_id = ?")
    .get(channelId, messageId);
  return parseJsonObject(row?.raw_json);
}

export function getTelegramPipelineMessageMediaPreview(
  channelId: string,
  messageId: number,
  db = getTelegramPipelineDb(),
): TelegramMediaPreview | null {
  const row = db
    .prepare(`
      select
        media_kind,
        media_mime_type,
        media_preview_url,
        media_label,
        media_width,
        media_height
      from telegram_messages
      where channel_id = ? and message_id = ?
    `)
    .get(channelId, messageId);
  return row ? toFeedItem({
    channel_id: channelId,
    message_id: messageId,
    media_kind: row.media_kind,
    media_mime_type: row.media_mime_type,
    media_preview_url: row.media_preview_url,
    media_label: row.media_label,
    media_width: row.media_width,
    media_height: row.media_height,
  }).media : null;
}
