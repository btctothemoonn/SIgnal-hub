import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ALPHA_RESEARCH_STOCKS,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
} from "./alpha-research-pool.ts";
import { mergeStocksCatalystSnapshot } from "./stocks-catalyst-data.ts";
import {
  mergeStocksFinancialSnapshot,
} from "./stocks-financial-data.ts";
import {
  mergeStocksMarketSnapshot,
} from "./stocks-market-data.ts";
import {
  getCachedStocksCatalystSnapshot,
  getCachedStocksFinancialSnapshot,
  getCachedStocksMarketSnapshot,
} from "./stocks-prewarm.ts";
import { getTelegramPipelineConfig } from "./telegram-pipeline-config.ts";
import { cleanTranslationText } from "./translate.ts";
import { getXPipelineConfig } from "./x-pipeline-config.ts";
import { getTelegramXSourceChannelKeys, isTelegramXSourceChannel } from "./telegram-x-source-channels.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;

export const ALPHA_SUMMARY_SCOPES = ["12h", "today", "3d", "7d"] as const;
export const ALPHA_SUMMARY_AUDIENCES = ["signals", "stocks"] as const;

export type AlphaSummaryScope = (typeof ALPHA_SUMMARY_SCOPES)[number];
export type AlphaSummaryAudience = (typeof ALPHA_SUMMARY_AUDIENCES)[number];

export type AlphaSummaryPeriod = {
  key: string;
  scope: AlphaSummaryScope;
  audience: AlphaSummaryAudience;
  inputBudgetVersion: number;
  label: string;
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type AlphaSummarySourceItem = {
  id: string;
  source: "Telegram" | "X" | "Stocks";
  author: string;
  createdAt: string;
  text: string;
  translation: string | null;
  link: string;
};

export type AlphaSummaryAuthor = {
  name: string;
  sourceCount: number;
  coreView: string;
  alpha: string[];
  watch: string[];
};

export type AlphaSummaryContent = {
  headline: string;
  authors: AlphaSummaryAuthor[];
  consensus: string[];
  risks: string[];
  watchlist: string[];
};

export type AlphaSummarySnapshot = {
  success: boolean;
  status: "needs_key" | "empty" | "cached" | "generated" | "error";
  configured: boolean;
  period: AlphaSummaryPeriod;
  generatedAt: string | null;
  model: string;
  itemCount: number;
  sourceCounts: {
    telegram: number;
    x: number;
    stocks?: number;
  };
  summary: AlphaSummaryContent | null;
  error: string | null;
};

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const AI_SUMMARY_INPUT_BUDGET_VERSION = 3;
const DEFAULT_REFRESH_INTERVALS_MS: Record<AlphaSummaryScope, number> = {
  "12h": DEFAULT_REFRESH_INTERVAL_MS,
  today: 60 * 60 * 1000,
  "3d": 4 * 60 * 60 * 1000,
  "7d": 24 * 60 * 60 * 1000,
};
const MAX_ITEMS_FOR_AI_BY_SCOPE: Record<AlphaSummaryScope, number> = {
  "12h": 48,
  today: 72,
  "3d": 90,
  "7d": 110,
};
const SOURCE_READ_LIMIT_BY_SCOPE: Record<AlphaSummaryScope, number> = {
  "12h": 120,
  today: 180,
  "3d": 260,
  "7d": 360,
};
const MAX_TEXT_CHARS_BY_SCOPE: Record<AlphaSummaryScope, number> = {
  "12h": 520,
  today: 440,
  "3d": 360,
  "7d": 320,
};
const MAX_TEXT_CHARS = 900;

const ALPHA_SUMMARY_SCOPE_SET = new Set<string>(ALPHA_SUMMARY_SCOPES);
const ALPHA_SUMMARY_AUDIENCE_SET = new Set<string>(ALPHA_SUMMARY_AUDIENCES);

export function normalizeAlphaSummaryScope(value: unknown): AlphaSummaryScope {
  if (typeof value !== "string") return "12h";
  const normalized = value.trim().toLowerCase();
  return ALPHA_SUMMARY_SCOPE_SET.has(normalized)
    ? (normalized as AlphaSummaryScope)
    : "12h";
}

export function normalizeAlphaSummaryAudience(
  value: unknown,
): AlphaSummaryAudience {
  if (typeof value !== "string") return "signals";
  const normalized = value.trim().toLowerCase();
  return ALPHA_SUMMARY_AUDIENCE_SET.has(normalized)
    ? (normalized as AlphaSummaryAudience)
    : "signals";
}

export function getAlphaSummaryInputBudget(scope: unknown) {
  const normalizedScope = normalizeAlphaSummaryScope(scope);
  return {
    maxItems: MAX_ITEMS_FOR_AI_BY_SCOPE[normalizedScope],
    sourceReadLimit: SOURCE_READ_LIMIT_BY_SCOPE[normalizedScope],
    maxTextChars: MAX_TEXT_CHARS_BY_SCOPE[normalizedScope],
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeValue(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function parseAlphaSummaryAuthors(value: unknown): AlphaSummaryAuthor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AlphaSummaryAuthor | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const name = stringValue(record.name).trim();
      if (!name) return null;
      return {
        name,
        sourceCount: Math.max(0, Math.round(numberValue(record.sourceCount))),
        coreView: stringValue(record.coreView).slice(0, 360),
        alpha: parseStringArray(record.alpha),
        watch: parseStringArray(record.watch),
      };
    })
    .filter((item): item is AlphaSummaryAuthor => Boolean(item))
    .slice(0, 12);
}

function normalizeAlphaSummaryRecord(
  parsed: Record<string, unknown>,
): AlphaSummaryContent | null {
  if (!Array.isArray(parsed.authors)) {
    return null;
  }

  return {
    headline: stringValue(parsed.headline).slice(0, 240),
    authors: parseAlphaSummaryAuthors(parsed.authors),
    consensus: parseStringArray(parsed.consensus),
    risks: parseStringArray(parsed.risks),
    watchlist: parseStringArray(parsed.watchlist),
  };
}

function clampText(text: string, maxChars = MAX_TEXT_CHARS) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars).trim()}...`
    : normalized;
}

function nullableClampedText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return clampText(value, maxChars);
}

function nullableClampedTranslation(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return nullableClampedText(cleanTranslationText(value), maxChars);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOCK_COMPANY_TERMS = Array.from(
  new Set(
    ALPHA_RESEARCH_STOCKS.flatMap((stock) => [
      stock.companyName,
      stock.companyNameZh,
      ...stock.businessTags,
    ])
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 3),
  ),
);

const STOCK_CONTEXT_TERMS = [
  "美股",
  "股票",
  "财报",
  "盘前",
  "盘后",
  "纳斯达克",
  "标普",
  "道指",
  "半导体",
  "光通信",
  "数据中心",
  "云计算",
  "算力",
  "earnings",
  "stock market",
  "shares",
  "nasdaq",
  "nyse",
  "s&p 500",
  "spx",
  "qqq",
  "semiconductor",
  "data center",
  "datacenter",
  "ai server",
  "gpu",
  "blackwell",
  "hbm",
  "cowos",
];

const STOCK_ORDINARY_MESSAGE_TERMS = [
  "premarket",
  "after hours",
  "guidance",
  "price target",
  "upgrade",
  "downgrade",
  "buy rating",
  "sell rating",
  "fed",
  "fomc",
  "cpi",
  "ppi",
  "pce",
  "payrolls",
  "nfp",
  "jobless claims",
  "treasury yields",
  "10y yield",
  "rates",
  "rate cut",
  "dollar index",
  "vix",
  "spy",
  "qqq",
  "iwm",
  "dia",
  "smh",
  "soxx",
  "xlk",
  "xlf",
  "xle",
  "xlv",
  "arkk",
  "magnificent seven",
  "mag 7",
  "small caps",
  "large caps",
  "growth stocks",
  "value stocks",
  "美联储",
  "降息",
  "加息",
  "利率",
  "通胀",
  "非农",
  "初请",
  "收益率",
  "美元指数",
  "恐慌指数",
  "盘前异动",
  "盘后异动",
  "上调评级",
  "下调评级",
  "目标价",
];

const CRYPTO_CONTEXT_TERMS = [
  "binance",
  "bitcoin",
  "ethereum",
  "crypto",
  "token",
  "airdrop",
  "defi",
  "onchain",
  "perp",
  "perps",
  "btc",
  "eth",
  "sol",
  "bnb",
  "币安",
  "加密",
  "链上",
  "代币",
  "空投",
  "合约",
];

const CRYPTO_CASHTAGS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "TON",
  "TRX",
  "LINK",
  "UNI",
  "AAVE",
  "SUI",
  "ENA",
  "PEPE",
]);

const COMMON_WORD_TICKERS = new Set(["FN", "NOW"]);

function hasStockTicker(text: string) {
  const upper = text.toUpperCase();
  return ALPHA_RESEARCH_STOCK_UNIVERSE.some((ticker) => {
    if (upper.includes(`$${ticker}`)) return true;
    if (COMMON_WORD_TICKERS.has(ticker)) return false;
    return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(ticker)}([^A-Z0-9]|$)`).test(
      upper,
    );
  });
}

function hasAnyTerm(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function hasNonCryptoCashtag(text: string) {
  for (const match of text.matchAll(/\$([A-Z]{1,6})(?=$|[^A-Z0-9])/g)) {
    const ticker = match[1];
    if (!CRYPTO_CASHTAGS.has(ticker)) return true;
  }
  return false;
}

export function isStockSummaryRelevantItem(item: AlphaSummarySourceItem) {
  const text = [item.author, item.text, item.translation ?? ""].join("\n");
  if (hasStockTicker(text)) return true;
  if (hasAnyTerm(text, STOCK_COMPANY_TERMS)) return true;

  const hasOrdinaryStockContext = hasAnyTerm(
    text,
    STOCK_ORDINARY_MESSAGE_TERMS,
  );
  const hasStockContext =
    hasAnyTerm(text, STOCK_CONTEXT_TERMS) ||
    hasOrdinaryStockContext ||
    hasNonCryptoCashtag(text);
  if (!hasStockContext) return false;

  const hasCryptoContext = hasAnyTerm(text, CRYPTO_CONTEXT_TERMS);
  return !hasCryptoContext || hasOrdinaryStockContext || hasNonCryptoCashtag(text);
}

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAlphaSummaryTimeZone(env: EnvLike = process.env) {
  return env.AI_SUMMARY_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
}

export function isMiniMaxBaseUrl(baseUrl: string) {
  return /minimax\.io|minimaxi\.com/i.test(baseUrl);
}

export function isDeepSeekBaseUrl(baseUrl: string) {
  return /deepseek\.com/i.test(baseUrl);
}

export function getAlphaSummaryModel(env: EnvLike = process.env) {
  const deepseekModel = env.DEEPSEEK_MODEL?.trim();
  if (deepseekModel) return deepseekModel;
  if (env.DEEPSEEK_API_KEY?.trim()) {
    const configuredDeepSeekModel = env.AI_SUMMARY_MODEL?.trim();
    return configuredDeepSeekModel?.startsWith("deepseek-")
      ? configuredDeepSeekModel
      : DEFAULT_DEEPSEEK_MODEL;
  }
  const configured =
    env.AI_SUMMARY_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim();
  if (configured) return configured;
  if (env.DEEPSEEK_API_KEY?.trim() || isDeepSeekBaseUrl(getAlphaSummaryBaseUrl(env))) {
    return DEFAULT_DEEPSEEK_MODEL;
  }
  return env.MINIMAX_API_KEY?.trim() ||
    isMiniMaxBaseUrl(getAlphaSummaryBaseUrl(env))
    ? DEFAULT_MINIMAX_MODEL
    : DEFAULT_MODEL;
}

export function getAlphaSummaryBaseUrl(env: EnvLike = process.env) {
  if (env.DEEPSEEK_API_KEY?.trim()) {
    return (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }
  return (
    env.AI_SUMMARY_BASE_URL?.trim() ||
    env.DEEPSEEK_BASE_URL?.trim() ||
    env.OPENAI_BASE_URL?.trim() ||
    (env.DEEPSEEK_API_KEY?.trim() ? DEFAULT_DEEPSEEK_BASE_URL : "") ||
    (env.MINIMAX_API_KEY?.trim() ? DEFAULT_MINIMAX_BASE_URL : DEFAULT_BASE_URL)
  ).replace(/\/+$/, "");
}

function getAlphaSummaryApiKey(env: EnvLike = process.env) {
  if (isDeepSeekBaseUrl(getAlphaSummaryBaseUrl(env))) {
    return (
      env.DEEPSEEK_API_KEY?.trim() ||
      env.AI_SUMMARY_API_KEY?.trim() ||
      env.OPENAI_API_KEY?.trim() ||
      ""
    );
  }
  if (isMiniMaxBaseUrl(getAlphaSummaryBaseUrl(env))) {
    return (
      env.MINIMAX_API_KEY?.trim() ||
      env.AI_SUMMARY_API_KEY?.trim() ||
      env.OPENAI_API_KEY?.trim() ||
      ""
    );
  }
  return (
    env.AI_SUMMARY_API_KEY?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.MINIMAX_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

export function getAlphaSummaryDbPath(
  env: EnvLike = process.env,
  audience: AlphaSummaryAudience = "signals",
) {
  if (audience === "stocks") {
    return (
      env.STOCKS_SUMMARY_DB?.trim() ||
      getRuntimeDataPath(env, "stocks-summary.sqlite")
    );
  }
  return (
    env.SIGNAL_SUMMARY_DB?.trim() ||
    env.ALPHA_SUMMARY_DB?.trim() ||
    getRuntimeDataPath(env, "signal-summary.sqlite")
  );
}

function getAlphaSummaryRefreshIntervalMs(
  env: EnvLike = process.env,
  scope: AlphaSummaryScope = "12h",
) {
  const envValue =
    scope === "12h"
      ? env.AI_SUMMARY_REFRESH_INTERVAL_MS
      : scope === "today"
        ? env.AI_SUMMARY_TODAY_REFRESH_INTERVAL_MS
        : scope === "3d"
          ? env.AI_SUMMARY_3D_REFRESH_INTERVAL_MS
          : env.AI_SUMMARY_7D_REFRESH_INTERVAL_MS;
  return positiveInt(envValue, DEFAULT_REFRESH_INTERVALS_MS[scope]);
}

function isCachedSummaryFresh({
  snapshot,
  now,
  env,
  scope,
}: {
  snapshot: AlphaSummarySnapshot;
  now: Date;
  env: EnvLike;
  scope: AlphaSummaryScope;
}) {
  if (!snapshot.generatedAt) return false;
  const generatedAt = new Date(snapshot.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return false;
  return now.getTime() - generatedAt < getAlphaSummaryRefreshIntervalMs(env, scope);
}

export function shouldReuseCachedAlphaSummary({
  snapshot,
  now,
  env,
  scope,
}: {
  snapshot: AlphaSummarySnapshot;
  now: Date;
  env: EnvLike;
  scope: AlphaSummaryScope;
}) {
  if (!isCachedSummaryFresh({ snapshot, now, env, scope })) return false;
  return snapshot.success || Boolean(snapshot.summary);
}

function getShanghaiLocalParts(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function shanghaiLocalToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0)).toISOString();
}

function periodKeyForAudience(
  audience: AlphaSummaryAudience,
  periodKey: string,
) {
  return audience === "stocks" ? `stocks:${periodKey}` : periodKey;
}

export function getAlphaSummaryPeriod({
  now = new Date(),
  env = process.env,
  scope = "12h",
  audience = "signals",
}: {
  now?: Date;
  env?: EnvLike;
  scope?: AlphaSummaryScope;
  audience?: AlphaSummaryAudience;
} = {}): AlphaSummaryPeriod {
  const normalizedScope = normalizeAlphaSummaryScope(scope);
  const normalizedAudience = normalizeAlphaSummaryAudience(audience);
  const timeZone = getAlphaSummaryTimeZone(env);
  const parts = getShanghaiLocalParts(now);
  const dateKey = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;

  if (normalizedScope === "today") {
    const periodKey = `today:${dateKey}`;
    return {
      key: periodKeyForAudience(normalizedAudience, periodKey),
      scope: normalizedScope,
      audience: normalizedAudience,
      inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
      label: `${dateKey} 00:00-现在`,
      startAt: shanghaiLocalToUtcIso(parts.year, parts.month, parts.day, 0),
      endAt: now.toISOString(),
      timeZone,
    };
  }

  if (normalizedScope === "3d") {
    const hourBucket = Math.floor(parts.hour / 4) * 4;
    const periodKey = `3d:${dateKey}-${pad2(hourBucket)}`;
    return {
      key: periodKeyForAudience(normalizedAudience, periodKey),
      scope: normalizedScope,
      audience: normalizedAudience,
      inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
      label: "近 3 天",
      startAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      timeZone,
    };
  }

  if (normalizedScope === "7d") {
    const periodKey = `7d:${dateKey}`;
    return {
      key: periodKeyForAudience(normalizedAudience, periodKey),
      scope: normalizedScope,
      audience: normalizedAudience,
      inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
      label: "近 7 天",
      startAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      timeZone,
    };
  }

  const startHour = parts.hour < 12 ? 0 : 12;
  const endHour = startHour + 12;
  const periodKey = `12h:${dateKey}-${pad2(startHour)}`;
  return {
    key: periodKeyForAudience(normalizedAudience, periodKey),
    scope: normalizedScope,
    audience: normalizedAudience,
    inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
    label: `${dateKey} ${pad2(startHour)}:00-${startHour === 0 ? "11:59" : "23:59"}`,
    startAt: shanghaiLocalToUtcIso(parts.year, parts.month, parts.day, startHour),
    endAt: shanghaiLocalToUtcIso(parts.year, parts.month, parts.day, endHour),
    timeZone,
  };
}

function openAlphaSummaryDb(path = getAlphaSummaryDbPath()) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma busy_timeout = 5000");
  db.exec(`
    create table if not exists alpha_summary_cache (
      period_key text primary key,
      period_json text not null,
      model text not null,
      input_hash text not null,
      item_count integer not null default 0,
      source_counts_json text not null default '{}',
      summary_json text,
      status text not null,
      error text,
      generated_at text not null,
      updated_at text not null
    )
  `);
  return db;
}

function readCachedSummary(
  periodKey: string,
  db: DatabaseSync,
): AlphaSummarySnapshot | null {
  const row = db
    .prepare("select * from alpha_summary_cache where period_key = ?")
    .get(periodKey) as DbRow | undefined;
  if (!row) return null;
  const periodRecord = parseJsonObject(row.period_json);
  const sourceCounts = parseJsonObject(row.source_counts_json);
  const summaryRecord = parseJsonObject(row.summary_json);
  const summary = summaryRecord
    ? normalizeAlphaSummaryRecord(summaryRecord)
    : null;
  if (!periodRecord) return null;
  if (summaryRecord && !summary) return null;
  if (numberValue(periodRecord.inputBudgetVersion) !== AI_SUMMARY_INPUT_BUDGET_VERSION) {
    return null;
  }
  const period = {
    ...periodRecord,
    scope: normalizeAlphaSummaryScope(periodRecord.scope),
    audience: normalizeAlphaSummaryAudience(periodRecord.audience),
  } as AlphaSummaryPeriod;
  return {
    success: stringValue(row.status) !== "error",
    status: stringValue(row.status) === "error" ? "error" : "cached",
    configured: true,
    period,
    generatedAt: stringValue(row.generated_at),
    model: stringValue(row.model),
    itemCount: Number(row.item_count || 0),
    sourceCounts: {
      telegram: Number(sourceCounts?.telegram || 0),
      x: Number(sourceCounts?.x || 0),
      stocks: Number(sourceCounts?.stocks || 0),
    },
    summary,
    error: nullableString(row.error),
  };
}

function writeCachedSummary(
  snapshot: AlphaSummarySnapshot,
  inputHash: string,
  db: DatabaseSync,
) {
  const at = new Date().toISOString();
  db.prepare(`
    insert into alpha_summary_cache(
      period_key, period_json, model, input_hash, item_count,
      source_counts_json, summary_json, status, error, generated_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(period_key) do update set
      period_json = excluded.period_json,
      model = excluded.model,
      input_hash = excluded.input_hash,
      item_count = excluded.item_count,
      source_counts_json = excluded.source_counts_json,
      summary_json = excluded.summary_json,
      status = excluded.status,
      error = excluded.error,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `).run(
    snapshot.period.key,
    JSON.stringify(snapshot.period),
    snapshot.model,
    inputHash,
    snapshot.itemCount,
    JSON.stringify(snapshot.sourceCounts),
    snapshot.summary ? JSON.stringify(snapshot.summary) : null,
    snapshot.status,
    snapshot.error,
    snapshot.generatedAt || at,
    at,
  );
}

function sourceReadLimitForScope(scope: AlphaSummaryScope) {
  return getAlphaSummaryInputBudget(scope).sourceReadLimit;
}

function maxItemsForAiScope(scope: AlphaSummaryScope) {
  return getAlphaSummaryInputBudget(scope).maxItems;
}

function maxTextCharsForScope(scope: AlphaSummaryScope) {
  return getAlphaSummaryInputBudget(scope).maxTextChars;
}

function readTelegramItems(period: AlphaSummaryPeriod): AlphaSummarySourceItem[] {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(getTelegramPipelineConfig().dbPath);
    const keys = getTelegramXSourceChannelKeys();
    const maxTextChars = maxTextCharsForScope(period.scope);
    return (db.prepare(`
      select *
      from telegram_messages
      where created_at >= ? and created_at < ?
      order by created_at desc, message_id desc
      limit ?
    `).all(period.startAt, period.endAt, sourceReadLimitForScope(period.scope)) as DbRow[])
      .filter((row) =>
        !isTelegramXSourceChannel(
          {
            ref: row.channel_ref,
            username: row.channel_username,
            channelId: row.channel_id,
            title: row.channel_title,
          },
          keys,
        ),
      )
      .map((row) => {
        const translation = parseJsonObject(row.translation_json);
        return {
          id: `telegram:${stringValue(row.channel_id)}:${String(row.message_id || "")}`,
          source: "Telegram" as const,
          author: stringValue(row.channel_title) || stringValue(row.channel_username),
          createdAt: stringValue(row.created_at),
          text: clampText(stringValue(row.text), maxTextChars),
          translation: nullableClampedTranslation(translation?.text, maxTextChars),
          link: stringValue(row.message_url),
        };
      });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function readXItems(period: AlphaSummaryPeriod): AlphaSummarySourceItem[] {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(getXPipelineConfig().dbPath);
    const startMs = Date.parse(period.startAt);
    const endMs = Date.parse(period.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    const maxTextChars = maxTextCharsForScope(period.scope);

    return (db.prepare(`
      select f.*
      from x_feed f
      inner join x_accounts a on a.username_key = f.account_username_key
      where a.enabled = 1
    `).all() as DbRow[])
      .filter((row) => {
        const createdAtMs = timeValue(row.created_at);
        return createdAtMs >= startMs && createdAtMs < endMs;
      })
      .sort(
        (left, right) =>
          timeValue(right.created_at) - timeValue(left.created_at) ||
          timeValue(right.updated_at) - timeValue(left.updated_at),
      )
      .slice(0, sourceReadLimitForScope(period.scope))
      .map((row) => {
        const translation = parseJsonObject(row.translation_json);
        return {
          id: `x:${stringValue(row.id)}`,
          source: "X" as const,
          author: `@${stringValue(row.username)}`,
          createdAt: stringValue(row.created_at),
          text: clampText(stringValue(row.text), maxTextChars),
          translation: nullableClampedTranslation(translation?.text, maxTextChars),
          link: stringValue(row.tweet_url),
        };
      });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function filterItemsForAudience(
  items: AlphaSummarySourceItem[],
  audience: AlphaSummaryAudience,
) {
  if (audience !== "stocks") return items;
  return items.filter(isStockSummaryRelevantItem);
}

function signedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

async function readStocksExternalSummaryItems(
  period: AlphaSummaryPeriod,
  env: EnvLike,
): Promise<AlphaSummarySourceItem[]> {
  if (period.audience !== "stocks") return [];
  const [marketSnapshot, financialSnapshot, catalystSnapshot] =
    await Promise.all([
      getCachedStocksMarketSnapshot({ stocks: ALPHA_RESEARCH_STOCKS, env }),
      getCachedStocksFinancialSnapshot({ stocks: ALPHA_RESEARCH_STOCKS, env }),
      getCachedStocksCatalystSnapshot({ stocks: ALPHA_RESEARCH_STOCKS, env }),
    ]);
  const withMarket = mergeStocksMarketSnapshot(
    ALPHA_RESEARCH_STOCKS,
    marketSnapshot,
  );
  const withFinancials = mergeStocksFinancialSnapshot(
    withMarket,
    financialSnapshot,
  );
  const stocks = mergeStocksCatalystSnapshot(withFinancials, catalystSnapshot);
  const maxTextChars = maxTextCharsForScope(period.scope);
  const createdAt = new Date(
    Math.max(
      Date.parse(marketSnapshot.generatedAt) || 0,
      Date.parse(financialSnapshot.generatedAt) || 0,
      Date.parse(catalystSnapshot.generatedAt) || 0,
    ),
  ).toISOString();

  return stocks.map((stock) => {
    const catalysts = stock.catalysts
      .slice(0, 2)
      .map(
        (catalyst) =>
          `${catalyst.sourceRole ?? "source"}:${catalyst.source ?? "n/a"} ${catalyst.title} - ${catalyst.summary}`,
      )
      .join("\n");
    const text = [
      `${stock.ticker} ${stock.companyNameZh} / ${stock.companyName}`,
      `market source=${marketSnapshot.provider}/${marketSnapshot.source}; last=${stock.market.lastPrice}; day=${signedPercent(stock.market.dayChangePct)}; prepost=${signedPercent(stock.market.prePostChangePct)}; sevenDay=${signedPercent(stock.market.sevenDayChangePct)}; session=${stock.market.marketSession}`,
      `financial source=${financialSnapshot.provider}/${financialSnapshot.source}; revenue=${stock.financialSnapshot.revenue}; revenueYoY=${stock.financialSnapshot.revenueYoY}; eps=${stock.financialSnapshot.eps}; grossMargin=${stock.financialSnapshot.grossMargin}; fcf=${stock.financialSnapshot.freeCashFlow}; nextEarnings=${stock.financialSnapshot.nextEarningsDate}; guidance=${stock.financialSnapshot.guidance}`,
      `catalyst source=${catalystSnapshot.provider}/${catalystSnapshot.source}`,
      catalysts ? `catalysts:\n${catalysts}` : "catalysts: no live catalyst",
    ].join("\n");
    return {
      id: `stocks:${stock.ticker}`,
      source: "Stocks" as const,
      author: `STOCKS ${stock.ticker}`,
      createdAt,
      text: clampText(text, maxTextChars),
      translation: null,
      link: "",
    };
  });
}

async function collectAlphaSummaryItems(
  period: AlphaSummaryPeriod,
  env: EnvLike,
) {
  const telegram = filterItemsForAudience(
    readTelegramItems(period),
    period.audience,
  );
  const x = filterItemsForAudience(readXItems(period), period.audience);
  const stocks = await readStocksExternalSummaryItems(period, env);
  return {
    items: [...stocks, ...telegram, ...x]
      .sort(
        (left, right) =>
          (left.source === "Stocks" ? -1 : 0) -
            (right.source === "Stocks" ? -1 : 0) ||
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      )
      .slice(0, maxItemsForAiScope(period.scope)),
    sourceCounts: {
      telegram: telegram.length,
      x: x.length,
      stocks: stocks.length,
    },
  };
}

function inputHashForItems(items: AlphaSummarySourceItem[]) {
  return createHash("sha256")
    .update(JSON.stringify(items.map((item) => [item.id, item.createdAt, item.text, item.translation])))
    .digest("hex");
}

function alphaSummaryScopeInstruction(scope: AlphaSummaryScope) {
  if (scope === "today") {
    return "今日视角：优先提炼日内已经形成共振的主题，并指出仍需要等待确认的变量。";
  }
  if (scope === "3d") {
    return "三日视角：优先识别连续多次出现的叙事、资金流和事件链，不要逐条复述短消息。";
  }
  if (scope === "7d") {
    return "七日视角：优先输出周度趋势、叙事迁移和风险累积，弱化单条快讯噪音。";
  }
  return "短线视角：优先提炼最近半日可交易、可验证、需要马上盯住的 Alpha。";
}

function stockResearchUniverseText() {
  return ALPHA_RESEARCH_STOCKS.map((stock) => {
    const tags = stock.businessTags.slice(0, 3).join("/");
    return `${stock.ticker} ${stock.companyNameZh} / ${stock.companyName} (${tags})`;
  }).join("; ");
}

export function buildAlphaSummaryPrompt({
  period,
  items,
}: {
  period: AlphaSummaryPeriod;
  items: AlphaSummarySourceItem[];
}) {
  const sourceText = items
    .map((item, index) => {
      const translation = item.translation ? `\n中文翻译: ${item.translation}` : "";
      return [
        `[${index + 1}] ${item.source} ${item.author} ${item.createdAt}`,
        `链接: ${item.link || "n/a"}`,
        `内容: ${item.text}${translation}`,
      ].join("\n");
    })
    .join("\n\n");

  if (period.audience === "stocks") {
    return `
你是一个中文 STOCKS 美股观察池投研助手。请基于下面 ${period.label} (${period.timeZone}) 的外部行情、财报、新闻催化数据，以及 Telegram/X 补充信号，输出美股观察池投研总结。

观察池:
${stockResearchUniverseText()}

要求:
- 这是 STOCKS 美股观察池专用投研总结；Stocks 外部数据优先，Telegram/X 只作为补充信号。美股普通消息也要一起总结，包括美股、ADR、美股行业链、财报、评级、盘前盘后、机构观点、宏观对美股的影响。
- 重点覆盖观察池股票和产业链：半导体、光通信、云/SaaS/软件、数据中心基础设施、数据存储，以及相关 AI 算力链公司。
- 普通消息如果只影响大盘、行业或美股风险偏好，也可以纳入 consensus / risks / watchlist；不要强行映射到观察池 ticker。
- 忽略币圈、链上、代币、空投、DeFi、合约等内容；除非消息明确直接影响美股上市公司，否则不要纳入。
- ${alphaSummaryScopeInstruction(period.scope)}
- 只返回 JSON，不要 Markdown。
- headline: 一句话总结本周期最核心的美股投研结论。
- authors: 按博主/频道分类；X 使用 @username，Telegram 使用频道名。同一作者多条消息必须合并。
- 每个作者块说明 coreView、alpha、watch；alpha 字段是兼容字段，请填入“投研要点”，不要在文字里使用 Alpha 命名。
- consensus: 跨多个作者共同提到或相互印证的共识。
- risks: 0 到 4 条风险或噪音提示。
- watchlist: 0 到 12 个需要关注的股票、板块、公司、事件或账号，不要输出币种或代币。
- 不要编造消息中不存在的事实；如果证据不足，明确写“证据不足”。

JSON 结构:
{
  "headline": "string",
  "authors": [
    {
      "name": "@username or channel",
      "sourceCount": 1,
      "coreView": "string",
      "alpha": ["string"],
      "watch": ["string"]
    }
  ],
  "consensus": ["string"],
  "risks": ["string"],
  "watchlist": ["string"]
}

消息:
${sourceText}
`.trim();
  }

  return `
你是一个加密市场与美股科技方向的 Alpha 研究助手。
请基于下面 ${period.label} (${period.timeZone}) 的 Telegram 和 X 消息，按博主/频道分类提炼可交易、可跟踪的信息。

要求:
- ${alphaSummaryScopeInstruction(period.scope)}
- 只返回 JSON，不要 Markdown。
- headline: 一句话总结本周期最核心的 Alpha。
- authors: 按博主/频道分类；X 使用 @username，Telegram 使用频道名。同一作者多条消息必须合并。
- 每个作者块说明 coreView、alpha、watch；alpha 要写清事件、潜在影响、需要跟踪的变量。
- consensus: 跨多个作者共同提到或相互印证的共识。
- risks: 0 到 4 条风险或噪音提示。
- watchlist: 0 到 12 个需要关注的币种、股票、项目或账户。
- 不要编造消息中不存在的事实。
- 如果证据不足，明确写“证据不足”。

JSON 结构:
{
  "headline": "string",
  "authors": [
    {
      "name": "@username or channel",
      "sourceCount": 1,
      "coreView": "string",
      "alpha": ["string"],
      "watch": ["string"]
    }
  ],
  "consensus": ["string"],
  "risks": ["string"],
  "watchlist": ["string"]
}

消息:
${sourceText}
`.trim();
}

export function parseAlphaSummaryContent(content: string): AlphaSummaryContent {
  const cleanedBase = content
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonStart = cleanedBase.indexOf("{");
  const jsonEnd = cleanedBase.lastIndexOf("}");
  const cleaned =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? cleanedBase.slice(jsonStart, jsonEnd + 1)
      : cleanedBase;
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const normalized = normalizeAlphaSummaryRecord(parsed);
  if (!normalized) {
    throw new Error("AI summary missing author groups");
  }
  return normalized;
}

async function requestAiSummary({
  prompt,
  env,
}: {
  prompt: string;
  env: EnvLike;
}): Promise<AlphaSummaryContent> {
  const apiKey = getAlphaSummaryApiKey(env);
  const baseUrl = getAlphaSummaryBaseUrl(env);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getAlphaSummaryModel(env),
      messages: [
        {
          role: "system",
          content:
            "You produce concise Chinese market intelligence summaries from supplied messages only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      ...(isMiniMaxBaseUrl(baseUrl)
        ? {}
        : { response_format: { type: "json_object" } }),
    }),
    signal: AbortSignal.timeout(positiveInt(env.AI_SUMMARY_TIMEOUT_MS, 60_000)),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as Record<string, unknown>).message)
        : `AI summary HTTP ${response.status}`;
    throw new Error(message);
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content) {
    throw new Error("AI summary returned empty content");
  }
  return parseAlphaSummaryContent(content);
}

export async function getOrCreateAlphaSummary({
  force = false,
  now = new Date(),
  env = process.env,
  scope = "12h",
  audience = "signals",
}: {
  force?: boolean;
  now?: Date;
  env?: EnvLike;
  scope?: AlphaSummaryScope;
  audience?: AlphaSummaryAudience;
} = {}): Promise<AlphaSummarySnapshot> {
  const normalizedScope = normalizeAlphaSummaryScope(scope);
  const normalizedAudience = normalizeAlphaSummaryAudience(audience);
  const period = getAlphaSummaryPeriod({
    now,
    env,
    scope: normalizedScope,
    audience: normalizedAudience,
  });
  const model = getAlphaSummaryModel(env);
  const db = openAlphaSummaryDb(getAlphaSummaryDbPath(env, normalizedAudience));
  try {
    const cached = readCachedSummary(period.key, db);
    if (
      cached &&
      !force &&
      cached.model === model &&
      shouldReuseCachedAlphaSummary({
        snapshot: cached,
        now,
        env,
        scope: normalizedScope,
      })
    ) {
      return cached;
    }

    const { items, sourceCounts } = await collectAlphaSummaryItems(period, env);
    const inputHash = inputHashForItems(items);
    if (items.length === 0) {
      return {
        success: true,
        status: "empty",
        configured: Boolean(getAlphaSummaryApiKey(env)),
        period,
        generatedAt: null,
        model,
        itemCount: 0,
        sourceCounts,
        summary: null,
        error: null,
      };
    }

    if (!getAlphaSummaryApiKey(env)) {
      return {
        success: false,
        status: "needs_key",
        configured: false,
        period,
        generatedAt: cached?.generatedAt ?? null,
        model,
        itemCount: items.length,
        sourceCounts,
        summary: cached?.summary ?? null,
        error:
          "DEEPSEEK_API_KEY, MINIMAX_API_KEY, AI_SUMMARY_API_KEY, or OPENAI_API_KEY is required",
      };
    }

    try {
      const summary = await requestAiSummary({
        prompt: buildAlphaSummaryPrompt({ period, items }),
        env,
      });
      const snapshot: AlphaSummarySnapshot = {
        success: true,
        status: "generated",
        configured: true,
        period,
        generatedAt: new Date().toISOString(),
        model,
        itemCount: items.length,
        sourceCounts,
        summary,
        error: null,
      };
      writeCachedSummary(snapshot, inputHash, db);
      return snapshot;
    } catch (error) {
      const snapshot: AlphaSummarySnapshot = {
        success: false,
        status: "error",
        configured: true,
        period,
        generatedAt: new Date().toISOString(),
        model,
        itemCount: items.length,
        sourceCounts,
        summary: cached?.summary ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
      writeCachedSummary(snapshot, inputHash, db);
      return snapshot;
    }
  } finally {
    db.close();
  }
}
