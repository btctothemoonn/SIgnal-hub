import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getAvailableAiProviders,
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
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
import { collectSignalSummaryInput } from "./signal-summary-input.ts";
import { withSummaryAuthorNames, xSummaryAuthorName } from "./summary-author-names.ts";
import {
  bindSignalSummaryEvidence,
  buildSignalSummaryPrompt,
  parseSignalSummaryEvents,
  type SignalSummaryEvent,
} from "./signal-summary-events.ts";
import {
  prepareSignalSummaryPreviousEvents,
  reconcileSignalSummaryContinuity,
} from "./signal-summary-continuity.ts";

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
  signalContentVersion?: number;
  label: string;
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type AlphaSummarySourceItem = {
  id: string;
  source: "Telegram" | "X" | "Stocks";
  author: string;
  authorUsername?: string;
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
  stocks?: AlphaSummaryTarget[];
  crypto?: AlphaSummaryTarget[];
  authors: AlphaSummaryAuthor[];
  consensus: string[];
  risks: string[];
  watchlist: string[];
  events?: SignalSummaryEvent[];
  eventHistory?: SignalSummaryEvent[];
};

export type AlphaSummaryTarget = {
  target: string;
  opinions: { author: string; view: string }[];
};

export type AlphaSummaryCoverage = {
  candidateCount: number;
  selectedCount: number;
  startAt: string | null;
  endAt: string | null;
};

export type AlphaSummarySnapshot = {
  success: boolean;
  status: "needs_key" | "empty" | "cached" | "generated" | "error";
  configured: boolean;
  period: AlphaSummaryPeriod;
  generatedAt: string | null;
  lastAttemptAt?: string | null;
  coverage?: AlphaSummaryCoverage;
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
const AI_SUMMARY_INPUT_BUDGET_VERSION = 4;
const SIGNAL_SUMMARY_CONTENT_VERSION = 2;
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
  cached = false,
): AlphaSummaryContent | null {
  const hasTargetGroups = hasAlphaSummaryTargetGroups(parsed);
  if (!hasTargetGroups && !Array.isArray(parsed.authors)) {
    return null;
  }

  const events = Array.isArray(parsed.events)
    ? parseSignalSummaryEvents(parsed.events, { includeTracking: cached, includeHints: !cached })
    : undefined;
  if (Array.isArray(parsed.events) && parsed.events.length > 0 && !events?.length) {
    return null;
  }
  return {
    headline: stringValue(parsed.headline).slice(0, 600),
    ...(hasTargetGroups ? {
      stocks: parseAlphaSummaryTargets(parsed.stocks),
      crypto: parseAlphaSummaryTargets(parsed.crypto),
    } : {}),
    authors: parseAlphaSummaryAuthors(parsed.authors),
    consensus: parseStringArray(parsed.consensus),
    risks: parseStringArray(parsed.risks),
    watchlist: parseStringArray(parsed.watchlist),
    ...(events === undefined ? {} : { events }),
    ...(cached && Array.isArray(parsed.eventHistory) ? {
      eventHistory: parseSignalSummaryEvents(parsed.eventHistory, { maxEvents: 10, includeHints: false }),
    } : {}),
  };
}

function hasAlphaSummaryTargetGroups(value: AlphaSummaryContent | Record<string, unknown> | null): boolean {
  return Boolean(value && Array.isArray(value.stocks) && Array.isArray(value.crypto));
}

function parseAlphaSummaryTargets(value: unknown): AlphaSummaryTarget[] {
  if (!Array.isArray(value)) return [];
  const targets = new Map<string, AlphaSummaryTarget>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const target = stringValue(item.target).trim().slice(0, 100);
    if (!target || !Array.isArray(item.opinions)) continue;
    const group = targets.get(target) ?? { target, opinions: [] };
    for (const opinion of item.opinions) {
      if (!opinion || typeof opinion !== "object" || Array.isArray(opinion)) continue;
      const author = stringValue(opinion.author).trim().slice(0, 120);
      const view = stringValue(opinion.view).trim().slice(0, 600);
      if (!author || !view) continue;
      // Display names are not unique account identities. Only remove exact copies.
      if (!group.opinions.some((entry) => entry.author === author && entry.view === view)) {
        group.opinions.push({ author, view });
      }
    }
    if (group.opinions.length) targets.set(target, group);
  }
  return [...targets.values()];
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

function getAiProviderId(baseUrl: string) {
  return isMiniMaxBaseUrl(baseUrl)
    ? "minimax"
    : isDeepSeekBaseUrl(baseUrl)
      ? "deepseek"
      : "openai-compatible";
}

export function getAlphaSummaryProviderCandidates(
  env: EnvLike = process.env,
): AiProviderConfig[] {
  const baseUrl = getAlphaSummaryBaseUrl(env);
  const primary: AiProviderConfig = {
    id: getAiProviderId(baseUrl),
    baseUrl,
    apiKey: getAlphaSummaryApiKey(env),
    model: getAlphaSummaryModel(env),
  };
  const fallbackApiKey = env.AI_SUMMARY_FALLBACK_API_KEY?.trim() || "";
  const fallbackBaseUrl = (
    env.AI_SUMMARY_FALLBACK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL
  ).replace(/\/+$/, "");
  const fallback: AiProviderConfig = {
    id: getAiProviderId(fallbackBaseUrl),
    baseUrl: fallbackBaseUrl,
    apiKey: fallbackApiKey,
    model:
      env.AI_SUMMARY_FALLBACK_MODEL?.trim() ||
      (isDeepSeekBaseUrl(fallbackBaseUrl) ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_MODEL),
  };
  const providers = primary.apiKey ? [primary] : [];
  if (
    fallback.apiKey &&
    !providers.some(
      (provider) =>
        provider.baseUrl === fallback.baseUrl &&
        provider.apiKey === fallback.apiKey &&
        provider.model === fallback.model,
    )
  ) {
    providers.push(fallback);
  }
  return providers;
}

function getPreferredAlphaSummaryProvider(env: EnvLike = process.env) {
  const providers = getAlphaSummaryProviderCandidates(env);
  return getAvailableAiProviders(providers)[0] ?? providers[0] ?? null;
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

export function getAlphaSummaryRefreshIntervalMs(
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
  if (snapshot.period.audience === "signals" && snapshot.status === "error" && snapshot.lastAttemptAt) {
    const attemptedAt = timeValue(snapshot.lastAttemptAt);
    return attemptedAt > 0 &&
      now.getTime() - attemptedAt < Math.min(5 * 60_000, getAlphaSummaryRefreshIntervalMs(env, scope));
  }
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
  const signalMetadata = normalizedAudience === "signals"
    ? { signalContentVersion: SIGNAL_SUMMARY_CONTENT_VERSION }
    : {};
  const parts = getShanghaiLocalParts(now);
  const dateKey = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;

  if (normalizedScope === "today") {
    const periodKey = `today:${dateKey}`;
    return {
      key: periodKeyForAudience(normalizedAudience, periodKey),
      scope: normalizedScope,
      audience: normalizedAudience,
      inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
      ...signalMetadata,
      label: "最近 24 小时",
      startAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
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
      ...signalMetadata,
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
      ...signalMetadata,
      label: "近 7 天",
      startAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      timeZone,
    };
  }

  const startHour = parts.hour < 12 ? 0 : 12;
  const periodKey = `12h:${dateKey}-${pad2(startHour)}`;
  return {
    key: periodKeyForAudience(normalizedAudience, periodKey),
    scope: normalizedScope,
    audience: normalizedAudience,
    inputBudgetVersion: AI_SUMMARY_INPUT_BUDGET_VERSION,
    ...signalMetadata,
    label: "最近 12 小时",
    startAt: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
    endAt: now.toISOString(),
    timeZone,
  };
}

function openAlphaSummaryDb(
  path = getAlphaSummaryDbPath(),
  audience: AlphaSummaryAudience = "signals",
) {
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
  if (audience === "signals") {
    for (const column of ["last_attempt_at", "coverage_json"]) {
      const columns = db.prepare("pragma table_info(alpha_summary_cache)").all() as DbRow[];
      if (columns.some((entry) => entry.name === column)) continue;
      try {
        db.exec(`alter table alpha_summary_cache add column ${column} text`);
      } catch (error) {
        if (!(error instanceof Error) || !/duplicate column/i.test(error.message)) throw error;
      }
    }
  }
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
    ? normalizeAlphaSummaryRecord(summaryRecord, true)
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
  const isSignals = period.audience === "signals";
  const legacyFailure = isSignals && stringValue(row.status) === "error" && !row.last_attempt_at;
  const coverageRecord = isSignals ? parseJsonObject(row.coverage_json) : null;
  return {
    success: stringValue(row.status) !== "error",
    status: stringValue(row.status) === "error" ? "error" : "cached",
    configured: true,
    period,
    generatedAt: legacyFailure ? null : nullableString(row.generated_at),
    ...(isSignals ? {
      lastAttemptAt: nullableString(row.last_attempt_at) ??
        (legacyFailure ? nullableString(row.generated_at) : null),
      ...(coverageRecord ? { coverage: {
        candidateCount: Math.max(0, numberValue(coverageRecord.candidateCount)),
        selectedCount: Math.max(0, numberValue(coverageRecord.selectedCount)),
        startAt: nullableString(coverageRecord.startAt),
        endAt: nullableString(coverageRecord.endAt),
      } } : {}),
    } : {}),
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
  if (snapshot.period.audience === "signals") {
    db.prepare(`
      insert into alpha_summary_cache(
        period_key, period_json, model, input_hash, item_count,
        source_counts_json, summary_json, status, error, generated_at, updated_at,
        last_attempt_at, coverage_json
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(period_key) do update set
        period_json = excluded.period_json, model = excluded.model,
        input_hash = excluded.input_hash, item_count = excluded.item_count,
        source_counts_json = excluded.source_counts_json,
        summary_json = excluded.summary_json, status = excluded.status,
        error = excluded.error, generated_at = excluded.generated_at,
        updated_at = excluded.updated_at, last_attempt_at = excluded.last_attempt_at,
        coverage_json = excluded.coverage_json
    `).run(
      snapshot.period.key, JSON.stringify(snapshot.period), snapshot.model, inputHash,
      snapshot.itemCount, JSON.stringify(snapshot.sourceCounts),
      snapshot.summary ? JSON.stringify(snapshot.summary) : null,
      snapshot.status, snapshot.error, snapshot.generatedAt ?? "", at,
      snapshot.lastAttemptAt ?? null,
      snapshot.coverage ? JSON.stringify(snapshot.coverage) : null,
    );
    return;
  }
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
      select f.*, a.name as account_name
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
          author: xSummaryAuthorName(stringValue(row.username), row.display_name, row.account_name),
          authorUsername: stringValue(row.username),
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
  if (period.audience === "signals") {
    return collectSignalSummaryInput(period, env);
  }
  const telegram = filterItemsForAudience(
    readTelegramItems(period),
    period.audience,
  );
  const x = filterItemsForAudience(readXItems(period), period.audience);
  const stocks = await readStocksExternalSummaryItems(period, env);
  return {
    coverage: undefined as AlphaSummaryCoverage | undefined,
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
    return "24 小时视角：优先提炼最近 24 小时内已经形成共振的主题，并指出仍需要等待确认的变量。";
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
  previousEvents,
  previousGeneratedAt,
}: {
  period: AlphaSummaryPeriod;
  items: AlphaSummarySourceItem[];
  previousEvents?: readonly SignalSummaryEvent[];
  previousGeneratedAt?: string | null;
}) {
  if (period.audience === "signals") {
    return buildSignalSummaryPrompt({ period, items, previousEvents, previousGeneratedAt });
  }
  const sourceText = items
    .map((item, index) => {
      const translation = item.translation ? `\n中文翻译: ${item.translation}` : "";
      return [
        `[${index + 1}] ${item.source} ${item.author} ${item.createdAt}`,
        ...(item.authorUsername ? [`来源账号（仅用于区分同名博主）: ${item.authorUsername}`] : []),
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
- 普通消息如果只影响大盘、行业或美股风险偏好，纳入 headline 总结；不要强行映射到观察池 ticker。
- 忽略币圈、链上、代币、空投、DeFi、合约等内容；除非消息明确直接影响美股上市公司，否则不要纳入。crypto 返回空数组。
- ${alphaSummaryScopeInstruction(period.scope)}
- 只返回 JSON，不要 Markdown。
- headline: 用一段简短中文概括本周期最核心的美股投研观点。
- stocks: 按股票名称或代码分组，同一标的只出现一次；每个标的只有 target 和 opinions。
- opinions: 每条只包含 author 和 view。author 是实际发表该看法的博主或来源，view 只写与该标的相关的看法；X 使用消息 author 提供的推特显示名称，不使用账号 ID 或链接中的 @username，Telegram 使用频道名。
- 同一博主对同一标的的多条消息合并；一个博主涉及多个标的时分别归类，保留不同博主的分歧。
- 依据来源账号或链接判断是否同一博主；显示名称相同的不同账号分别保留观点。
- 外部行情、财报和新闻只归属于其实际来源，不要假称为博主观点；保留引用对象和语境，不把转发或引用自动当成作者认可。
- 不额外输出共识、风险、观察清单、作者简介或消息数量等模块；没有标的观点时 stocks 为 []。
- 不要编造消息中不存在的事实或博主观点；如果证据不足，明确写“证据不足”。

JSON 结构:
{
  "headline": "一段总结",
  "stocks": [{ "target": "股票名称或代码", "opinions": [{ "author": "推特显示名称或频道名", "view": "看法" }] }],
  "crypto": []
}

消息:
${sourceText}
`.trim();
  }

  throw new Error("Unsupported summary audience");
}

function repairCommonAiJsonIssues(content: string) {
  return content
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/"\s*\n\s*"/g, '",\n"')
    .replace(/([}\]])\s*\n\s*"/g, '$1,\n"');
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

export function parseAlphaSummaryContent(content: string): AlphaSummaryContent {
  const cleanedBase = content
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const cleaned = extractFirstJsonObject(cleanedBase) ?? cleanedBase;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    parsed = JSON.parse(repairCommonAiJsonIssues(cleaned)) as Record<string, unknown>;
  }
  if (!hasAlphaSummaryTargetGroups(parsed)) {
    throw new Error("AI summary missing target groups");
  }
  const normalized = normalizeAlphaSummaryRecord(parsed);
  if (!normalized) {
    throw new Error("AI summary contains invalid target groups or events");
  }
  return normalized;
}

export async function requestAiSummary({
  prompt,
  env,
  validateSummary,
}: {
  prompt: string;
  env: EnvLike;
  validateSummary?: (summary: AlphaSummaryContent) => AlphaSummaryContent;
}): Promise<{ summary: AlphaSummaryContent; provider: AiProviderConfig }> {
  const result = await runWithAiProviderFallback({
    providers: getAlphaSummaryProviderCandidates(env),
    cooldownMs: positiveInt(env.AI_SUMMARY_PROVIDER_COOLDOWN_MS, 6 * 60 * 60 * 1000),
    request: async (provider) => {
      const messages = [
        { role: "system", content: "You produce concise Chinese market intelligence summaries from supplied messages only. Return valid JSON only." },
        { role: "user", content: prompt },
      ];
      for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: 0.2,
          ...(isMiniMaxBaseUrl(provider.baseUrl)
            ? {}
            : { response_format: { type: "json_object" } }),
        }),
        signal: AbortSignal.timeout(positiveInt(env.AI_SUMMARY_TIMEOUT_MS, 60_000)),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
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
      try {
        if (!content) throw new Error("AI summary returned empty content");
        const parsed = parseAlphaSummaryContent(content);
        return validateSummary ? validateSummary(parsed) : parsed;
      } catch (error) {
        if (attempt === 1) throw error;
        messages.push(
          { role: "assistant", content: content.slice(0, 32_000) },
          { role: "user", content: validateSummary
            ? "The response did not satisfy the requested schema or source validation. Return the complete corrected JSON object including headline, stocks and crypto with target and opinions (author, view), and internal events with exact sourceIds from the supplied messages. Escape quotes inside strings, include required commas, and omit reasoning and Markdown. Do not add new facts or sources."
            : "The response could not be parsed. Return the complete corrected JSON object using the requested schema, including headline, stocks and crypto with target and opinions (author, view). Escape quotes inside strings, include required commas, and omit reasoning and Markdown. Do not add new facts." },
        );
      }
      }
      throw new Error("AI summary JSON retry exhausted");
    },
  });
  return {
    summary: result.value,
    provider: result.provider,
  };
}

export type AlphaSummaryRequest = {
  force?: boolean;
  now?: Date;
  env?: EnvLike;
  scope?: AlphaSummaryScope;
  audience?: AlphaSummaryAudience;
};

const alphaSummaryFlights = new Map<string, Promise<unknown>>();

export function runAlphaSummarySingleFlight<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = alphaSummaryFlights.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const created = factory();
  const run = created.finally(() => {
    if (alphaSummaryFlights.get(key) === run) {
      alphaSummaryFlights.delete(key);
    }
  });
  alphaSummaryFlights.set(key, run);
  return run;
}

async function getOrCreateAlphaSummaryInternal({
  force = false,
  now = new Date(),
  env = process.env,
  scope = "12h",
  audience = "signals",
}: AlphaSummaryRequest = {}): Promise<AlphaSummarySnapshot> {
  const normalizedScope = normalizeAlphaSummaryScope(scope);
  const normalizedAudience = normalizeAlphaSummaryAudience(audience);
  const period = getAlphaSummaryPeriod({
    now,
    env,
    scope: normalizedScope,
    audience: normalizedAudience,
  });
  const providers = getAlphaSummaryProviderCandidates(env);
  const model = getPreferredAlphaSummaryProvider(env)?.model ?? getAlphaSummaryModel(env);
  const db = openAlphaSummaryDb(getAlphaSummaryDbPath(env, normalizedAudience), normalizedAudience);
  try {
    const isSignals = normalizedAudience === "signals";
    let cached = readCachedSummary(period.key, db);
    if (isSignals && !cached?.summary) {
      const previous = db.prepare(`
        select period_key from alpha_summary_cache
        where summary_json is not null and json_extract(period_json, '$.scope') = ?
          and coalesce(json_extract(period_json, '$.audience'), 'signals') = 'signals'
        order by updated_at desc limit 1
      `).get(normalizedScope) as DbRow | undefined;
      if (previous) cached = readCachedSummary(stringValue(previous.period_key), db) ?? cached;
    }
    if (
      cached &&
      cached.period.key === period.key &&
      (!isSignals || cached.period.signalContentVersion === SIGNAL_SUMMARY_CONTENT_VERSION) &&
      (hasAlphaSummaryTargetGroups(cached.summary) || cached.status === "error") &&
      !force &&
      (cached.model === model || (isSignals && cached.status === "error")) &&
      shouldReuseCachedAlphaSummary({
        snapshot: cached,
        now,
        env,
        scope: normalizedScope,
      })
    ) {
      return cached;
    }

    const { items, sourceCounts, coverage } = await collectAlphaSummaryItems(period, env);
    const inputHash = inputHashForItems(items);
    if (items.length === 0) {
      return {
        success: true,
        status: "empty",
        configured: providers.length > 0,
        period,
        generatedAt: null,
        model,
        itemCount: 0,
        sourceCounts,
        summary: null,
        error: null,
        ...(isSignals ? { lastAttemptAt: null, coverage } : {}),
      };
    }

    if (providers.length === 0) {
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
        ...(isSignals ? {
          lastAttemptAt: null,
          coverage: cached?.summary ? cached.coverage : coverage,
          itemCount: cached?.summary ? cached.itemCount : items.length,
          sourceCounts: cached?.summary ? cached.sourceCounts : sourceCounts,
        } : {}),
      };
    }

    try {
      const { summary, provider } = await requestAiSummary({
        prompt: buildAlphaSummaryPrompt({ period, items,
          ...(isSignals ? {
            previousEvents: prepareSignalSummaryPreviousEvents({ period, previous: cached }),
            previousGeneratedAt: cached?.generatedAt ?? null,
          } : {}),
        }),
        env,
        ...(isSignals ? { validateSummary: (result: AlphaSummaryContent) => {
          if (!Array.isArray(result.events)) throw new Error("Signal summary must return event tracking cards");
          const events = bindSignalSummaryEvidence(result.events, items);
          if (result.events.length > 0 && events.length === 0) {
            throw new Error("Signal summary events do not cite supplied original messages");
          }
          return { ...result, events };
        } } : {}),
      });
      const completedAt = new Date().toISOString();
      const completedSummary = isSignals ? {
        ...summary,
        ...reconcileSignalSummaryContinuity({ events: summary.events ?? [], items, period, previous: cached, generatedAt: completedAt }),
      } : summary;
      const snapshot: AlphaSummarySnapshot = {
        success: true,
        status: "generated",
        configured: true,
        period,
        generatedAt: completedAt,
        model: provider.model,
        itemCount: items.length,
        sourceCounts,
        summary: completedSummary,
        error: null,
        ...(isSignals ? { lastAttemptAt: completedAt, coverage } : {}),
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
        ...(isSignals ? {
          generatedAt: cached?.generatedAt ?? null,
          lastAttemptAt: new Date().toISOString(),
          model: cached?.summary ? cached.model : model,
          itemCount: cached?.summary ? cached.itemCount : items.length,
          sourceCounts: cached?.summary ? cached.sourceCounts : sourceCounts,
          coverage: cached?.summary ? cached.coverage : coverage,
        } : {}),
      };
      writeCachedSummary(snapshot, inputHash, db);
      return snapshot;
    }
  } finally {
    db.close();
  }
}

export function getOrCreateAlphaSummary(
  request: AlphaSummaryRequest = {},
): Promise<AlphaSummarySnapshot> {
  const scope = normalizeAlphaSummaryScope(request.scope);
  const audience = normalizeAlphaSummaryAudience(request.audience);
  return runAlphaSummarySingleFlight(`${audience}:${scope}`, () =>
    getOrCreateAlphaSummaryInternal({ ...request, scope, audience }),
  ).then((snapshot) => withSummaryAuthorNames(snapshot, request.env ?? process.env));
}
