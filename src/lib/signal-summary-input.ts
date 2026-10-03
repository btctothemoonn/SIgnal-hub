import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AlphaSummaryPeriod, AlphaSummarySourceItem } from "./alpha-summary.ts";
import { getTelegramPipelineConfig } from "./telegram-pipeline-config.ts";
import { getXPipelineConfig } from "./x-pipeline-config.ts";
import { getTelegramXSourceChannelKeys, isTelegramXSourceChannel } from "./telegram-x-source-channels.ts";
import { cleanTranslationText } from "./translate.ts";
import { xSummaryAuthorName } from "./summary-author-names.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;
// The project's minimal node:sqlite declaration predates user-defined functions.
// Keep this supported capability local and optional for Node 22.5–22.12.
type SqliteWithFunctions = DatabaseSync & {
  function?: (
    name: string,
    options: { deterministic?: boolean; varargs?: boolean },
    callback: (...values: unknown[]) => string | number | null,
  ) => void;
};
export type SignalSummaryInput = {
  items: AlphaSummarySourceItem[];
  sourceCounts: { telegram: number; x: number; stocks: 0 };
  coverage: { candidateCount: number; selectedCount: number; startAt: string | null; endAt: string | null };
};

export function collectSignalSummaryInput(period: AlphaSummaryPeriod, env: EnvLike = process.env): SignalSummaryInput {
  const budget = INPUT_BUDGETS[period.scope];
  const candidates = uniqueCandidates([
    ...readSourceItems("Telegram", period, env),
    ...readSourceItems("X", period, env),
  ], period);
  const items = selectSignalSummaryItems(candidates, period, budget.maxItems).map((item) => ({
    ...item,
    text: packContextText(item.text, budget.maxTextChars),
    translation: item.translation ? clampText(item.translation, budget.maxTextChars) : null,
  }));
  return {
    items,
    sourceCounts: { telegram: items.filter((item) => item.source === "Telegram").length, x: items.filter((item) => item.source === "X").length, stocks: 0 },
    coverage: {
      // Usable, unique candidates after the bounded per-bucket database read.
      candidateCount: candidates.length,
      selectedCount: items.length,
      startAt: items[0]?.createdAt ?? null,
      endAt: items.at(-1)?.createdAt ?? null,
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Kept independent of alpha-summary's runtime to avoid a circular dependency.
const INPUT_BUDGETS = {
  "12h": { maxItems: 48, maxTextChars: 520 },
  today: { maxItems: 72, maxTextChars: 440 },
  "3d": { maxItems: 90, maxTextChars: 360 },
  "7d": { maxItems: 110, maxTextChars: 320 },
} as const;
const CANDIDATES_PER_BUCKET_FACTOR = 8;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonObject(value: unknown): DbRow | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as DbRow : null;
  } catch {
    return null;
  }
}

function clampText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : text;
}

function sourceText(textValue: unknown, quoteValue: unknown, source: "Telegram" | "X"): string {
  const text = normalizedText(stringValue(textValue));
  const ownText = usableText(text) ? text : "";
  const quoted = jsonObject(quoteValue);
  const quoteText = normalizedText(stringValue(quoted?.text));
  const hasReference = source === "X"
    ? stringValue(quoted?.id) || stringValue(quoted?.tweetUrl)
    : stringValue(quoted?.id) || stringValue(quoted?.messageUrl);
  if (!hasReference || !usableText(quoteText)) return ownText;
  const author = source === "X"
    ? (stringValue(quoted?.username) ? xSummaryAuthorName(stringValue(quoted?.username), quoted?.displayName) : stringValue(quoted?.displayName))
    : stringValue(quoted?.channelTitle) || stringValue(quoted?.channelUsername);
  const relation = quoted?.relation === "reply" ? "Reply to" : "Quote";
  const context = `[${relation}${author ? ` ${author}` : ""}] ${quoteText}`;
  return ownText ? `${ownText}\n${context}` : context;
}

function packContextText(text: string, maxChars: number): string {
  const marker = text.search(/\s\[(?:Reply to|Quote)(?:\s|\])/);
  if (marker < 0 || text.length <= maxChars) return clampText(text, maxChars);
  const own = text.slice(0, marker).trim();
  const context = text.slice(marker).trim();
  const ownBudget = Math.min(own.length, Math.floor(maxChars * 0.65));
  const ownPacked = clampText(own, ownBudget);
  return `${ownPacked}\n${clampText(context, maxChars - ownPacked.length - 1)}`;
}

function readSourceItems(source: "Telegram" | "X", period: AlphaSummaryPeriod, env: EnvLike): AlphaSummarySourceItem[] {
  const window = windowBuckets(period);
  if (!window) return [];
  // Next adds a required NODE_ENV field to ProcessEnv, but pipeline config only
  // reads optional string keys. Preserve the caller's exact fixture environment.
  const pipelineEnv = env as NodeJS.ProcessEnv;
  const path = source === "Telegram" ? getTelegramPipelineConfig(pipelineEnv).dbPath : getXPipelineConfig(pipelineEnv).dbPath;
  if (!existsSync(path)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    // Node 22.5–22.11 predates the constructor's readOnly option. SQLite's
    // connection guard also prevents writes on those older enabled runtimes.
    db.exec("pragma query_only = on");
    db.exec("pragma busy_timeout = 5000");
    const keys = getTelegramXSourceChannelKeys(pipelineEnv);
    const telegram = source === "Telegram";
    const table = telegram ? "telegram_messages" : "x_feed";
    const quoteColumn = telegram ? "quoted_message_json" : "quoted_tweet_json";
    const columns = db.prepare(`pragma table_info(${table})`).all() as DbRow[];
    const accountColumns = telegram ? [] : db.prepare("pragma table_info(x_accounts)").all() as DbRow[];
    const quote = columns.some((column) => column.name === quoteColumn) ? `f.${quoteColumn}` : "null";
    const author = telegram ? "f.channel_id" : "f.account_username_key";
    const join = telegram
      ? "inner join telegram_channels a on a.channel_id = f.channel_id"
      : "inner join x_accounts a on a.username_key = f.account_username_key";
    const metadataColumns = telegram
      ? "f.channel_id, f.channel_title, f.channel_username, f.message_id, f.message_url"
      : `f.username, f.tweet_url, ${columns.some((column) => column.name === "display_name") ? "f.display_name" : "null"} as display_name, ${accountColumns.some((column) => column.name === "name") ? "a.name" : "null"} as account_name`;
    const functionDb = db as SqliteWithFunctions;
    if (typeof functionDb.function !== "function") {
      return readLegacySourceItems(db, source, period, keys, { table, join, quote, metadataColumns });
    }
    functionDb.function("signal_timestamp", { deterministic: true }, (value: unknown) => {
      const parsed = Date.parse(stringValue(value));
      return Number.isFinite(parsed) ? parsed : null;
    });
    functionDb.function("signal_content", { deterministic: true }, (text: unknown, quote: unknown) => sourceText(text, quote, source));
    functionDb.function("signal_content_key", { deterministic: true }, (text: unknown) => contentKey(stringValue(text)));
    functionDb.function("signal_is_relay", { deterministic: true, varargs: true }, (...values: unknown[]) =>
      isTelegramXSourceChannel({ ref: values[0], username: values[1], channelId: values[2], title: values[3] }, keys) ||
      isTelegramXSourceChannel({ ref: values[4], username: values[5], channelId: values[6], title: values[7] }, keys) ? 1 : 0,
    );
    const relayFilter = telegram
      ? "and signal_is_relay(f.channel_ref, f.channel_username, f.channel_id, f.channel_title, a.ref, a.username, a.channel_id, a.title) = 0"
      : "";
    // SQLite evaluates the entire time window, deduplicates before quotas, then
    // bounds returned rows per bucket. Author ranks alternate both time edges,
    // so a busy recent author cannot hide early days or less active authors.
    const rows = db.prepare(`
      with eligible as materialized (
        select f.id, f.translation_json, ${metadataColumns}, signal_timestamp(f.created_at) as signal_at,
          signal_content(f.text, ${quote}) as signal_text, ${author} as signal_author
        from ${table} f ${join}
        where a.enabled = 1 ${relayFilter}
          and signal_timestamp(f.created_at) >= ? and signal_timestamp(f.created_at) < ?
      ), in_window as (
        select *, cast((signal_at - ?) / ? as integer) as signal_bucket,
          signal_content_key(signal_text) as signal_key
        from eligible where signal_text != ''
      ), deduplicated as (
        select *, row_number() over (partition by signal_key order by signal_at, id) as duplicate_rank
        from in_window
      ), author_ranked as (
        select *, row_number() over (partition by signal_bucket, signal_author order by signal_at, id) as author_rank,
          count(*) over (partition by signal_bucket, signal_author) as author_total
        from deduplicated where duplicate_rank = 1
      ), bucket_ranked as (
        select *, row_number() over (
          partition by signal_bucket
          order by min(author_rank, author_total - author_rank + 1), signal_at, signal_author, id
        ) as bucket_rank
        from author_ranked
      )
      select * from bucket_ranked where bucket_rank <= ? order by signal_at, id
    `).all(window.startMs, window.endMs, window.startMs, window.bucketMs, INPUT_BUDGETS[period.scope].maxItems * CANDIDATES_PER_BUCKET_FACTOR) as DbRow[];
    return rows.map((row) => sourceItemFromRow(row, source));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function sourceItemFromRow(row: DbRow, source: "Telegram" | "X"): AlphaSummarySourceItem {
  const telegram = source === "Telegram";
  const translation = stringValue(jsonObject(row.translation_json)?.text);
  return {
    id: telegram ? `telegram:${stringValue(row.channel_id)}:${String(row.message_id ?? "")}` : `x:${stringValue(row.id)}`,
    source,
    author: telegram ? stringValue(row.channel_title) || stringValue(row.channel_username) : xSummaryAuthorName(stringValue(row.username), row.display_name, row.account_name),
    ...(!telegram ? { authorUsername: stringValue(row.username) } : {}),
    createdAt: new Date(Number(row.signal_at)).toISOString(),
    text: stringValue(row.signal_text),
    translation: translation ? normalizedText(cleanTranslationText(translation)) || null : null,
    link: stringValue(telegram ? row.message_url : row.tweet_url),
  };
}

function readLegacySourceItems(
  db: DatabaseSync,
  source: "Telegram" | "X",
  period: AlphaSummaryPeriod,
  keys: Set<string>,
  query: { table: string; join: string; quote: string; metadataColumns: string },
): AlphaSummarySourceItem[] {
  const window = windowBuckets(period);
  if (!window) return [];
  const pools = Array.from({ length: window.count }, () => [] as AlphaSummarySourceItem[]);
  const candidateLimit = INPUT_BUDGETS[period.scope].maxItems * CANDIDATES_PER_BUCKET_FACTOR;
  const relayColumns = source === "Telegram"
    ? ", f.channel_ref, a.ref as current_ref, a.username as current_username, a.channel_id as current_id, a.title as current_title"
    : "";
  const page = db.prepare(`
    select f.id, f.text, f.created_at, f.translation_json, ${query.metadataColumns},
      ${query.quote} as signal_quote ${relayColumns}
    from ${query.table} f ${query.join}
    where a.enabled = 1 and f.id > ? order by f.id limit 512
  `);
  let cursor = "";
  // Older node:sqlite exposes .all() but no UDF or iterator API. Keyset pages
  // scan enabled history without a newest-row cut; only bounded bucket pools
  // stay in JS memory, with the same author/time selection as the modern path.
  while (true) {
    const rows = page.all(cursor) as DbRow[];
    if (!rows.length) break;
    cursor = stringValue(rows.at(-1)?.id);
    for (const row of rows) {
      const at = Date.parse(stringValue(row.created_at));
      if (!Number.isFinite(at) || at < window.startMs || at >= window.endMs) continue;
      if (source === "Telegram" && (
        isTelegramXSourceChannel({ ref: row.channel_ref, username: row.channel_username, channelId: row.channel_id, title: row.channel_title }, keys) ||
        isTelegramXSourceChannel({ ref: row.current_ref, username: row.current_username, channelId: row.current_id, title: row.current_title }, keys)
      )) continue;
      const text = sourceText(row.text, row.signal_quote, source);
      if (!text) continue;
      pools[Math.floor((at - window.startMs) / window.bucketMs)].push(sourceItemFromRow({ ...row, signal_at: at, signal_text: text }, source));
    }
    for (let index = 0; index < pools.length; index += 1) {
      pools[index] = selectSignalSummaryItems(pools[index], period, candidateLimit);
    }
  }
  return pools.flat();
}

function normalizedText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function contentKey(text: string): string {
  return normalizedText(text).toLowerCase();
}

function usableText(text: string): boolean {
  const withoutLinks = normalizedText(text).replace(/https?:\/\/\S+/gi, "").trim();
  if (!/[\p{L}\p{N}]/u.test(withoutLinks)) return false;
  return !/^(?:[\[（(【]?\s*)?(?:media|photo|image|video|gif|sticker|media only|媒体消息|媒体预览|图片消息|图片预览|视频消息|视频预览|动画消息|动画预览|贴纸消息|贴纸预览|文件消息|音频消息|语音消息)(?:\s*[\]）)】]?)?$/i.test(withoutLinks);
}

function windowBuckets(period: AlphaSummaryPeriod) {
  const startMs = Date.parse(period.startAt);
  const endMs = Date.parse(period.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const bucketMs = period.scope === "3d" || period.scope === "7d"
    ? DAY_MS
    : (endMs - startMs) / (period.scope === "12h" ? 6 : 8);
  return { startMs, endMs, bucketMs, count: Math.ceil((endMs - startMs) / bucketMs) };
}

function uniqueCandidates(items: AlphaSummarySourceItem[], period: AlphaSummaryPeriod): AlphaSummarySourceItem[] {
  const window = windowBuckets(period);
  if (!window) return [];
  const ids = new Set<string>();
  const contents = new Set<string>();
  const result: AlphaSummarySourceItem[] = [];
  for (const item of items) {
    const at = Date.parse(item.createdAt);
    const text = normalizedText(item.text);
    if (item.source === "Stocks" || !Number.isFinite(at) || at < window.startMs || at >= window.endMs || !usableText(text)) continue;
    const key = contentKey(text);
    if (ids.has(item.id) || contents.has(key)) continue;
    ids.add(item.id);
    contents.add(key);
    result.push({ ...item, text, createdAt: new Date(at).toISOString() });
  }
  return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function authorKey(item: AlphaSummarySourceItem) {
  return `${item.source}:${(item.authorUsername || item.author).normalize("NFKC").trim().replace(/^@+/, "").toLowerCase()}`;
}

// Alternate the earliest and latest observations so a busy author's queue covers
// the whole bucket even when only a few of their posts can fit in the prompt.
function spreadQueue(items: AlphaSummarySourceItem[]): AlphaSummarySourceItem[] {
  const result: AlphaSummarySourceItem[] = [];
  let first = 0;
  let last = items.length - 1;
  while (first <= last) {
    result.push(items[first++]);
    if (first <= last) result.push(items[last--]);
  }
  return result;
}

export function selectSignalSummaryItems(
  items: AlphaSummarySourceItem[],
  period: AlphaSummaryPeriod,
  maxItems: number,
): AlphaSummarySourceItem[] {
  const window = windowBuckets(period);
  const limit = Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : 0;
  if (!window || !limit) return [];
  const buckets = Array.from({ length: window.count }, () => new Map<string, AlphaSummarySourceItem[]>());
  for (const item of uniqueCandidates(items, period)) {
    const bucket = buckets[Math.floor((Date.parse(item.createdAt) - window.startMs) / window.bucketMs)];
    const key = authorKey(item);
    const queue = bucket.get(key) ?? [];
    queue.push(item);
    bucket.set(key, queue);
  }
  for (const bucket of buckets) {
    for (const [key, queue] of bucket) bucket.set(key, spreadQueue(queue));
  }
  const authorCounts = new Map<string, number>();
  const selected: AlphaSummarySourceItem[] = [];
  let added = true;
  while (added && selected.length < limit) {
    added = false;
    for (const bucket of buckets) {
      const candidates = [...bucket.entries()].filter(([, queue]) => queue.length > 0);
      candidates.sort(([leftKey, left], [rightKey, right]) =>
        (authorCounts.get(leftKey) ?? 0) - (authorCounts.get(rightKey) ?? 0) ||
        left[0].createdAt.localeCompare(right[0].createdAt) || leftKey.localeCompare(rightKey),
      );
      const next = candidates[0];
      if (!next) continue;
      const [key, queue] = next;
      selected.push(queue.shift()!);
      authorCounts.set(key, (authorCounts.get(key) ?? 0) + 1);
      added = true;
      if (selected.length === limit) break;
    }
  }
  return selected.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
