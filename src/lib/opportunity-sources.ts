import { createHash } from "node:crypto";
import { ALPHA_RESEARCH_STOCK_UNIVERSE } from "./alpha-research-pool.ts";
import { readPersistedBinanceHoldingSnapshot } from "./binance-holdings-cache.ts";
import { getDouyinSnapshot } from "./douyin-monitor.ts";
import type { DouyinSnapshot } from "./douyin-monitor.ts";
import type {
  OpportunityEventType,
  OpportunityMarket,
  OpportunityMarketReaction,
  OpportunitySourceItem,
} from "./opportunity-types.ts";
import type { StocksCatalystSnapshot } from "./stocks-catalyst-data.ts";
import type { StocksMarketSnapshot } from "./stocks-market-data.ts";
import { readStocksSnapshotCache } from "./stocks-prewarm.ts";
import { getTelegramPipelineSnapshot } from "./telegram-pipeline-store.ts";
import type { TelegramDashboardSnapshot } from "./telegram-channels.ts";
import { readPersistedTigerHoldingData } from "./tiger-holdings-cache.ts";
import { getXPipelineSnapshot } from "./x-pipeline-store.ts";
import type { TwitterDashboardSnapshot } from "./6551-twitter.ts";

type EnvLike = Record<string, string | undefined>;
type OpportunitySourceItemWithExcerpt = OpportunitySourceItem & {
  textExcerpt: string;
};
type SourceNormalizerOptions = { now?: Date };
type MarketReaction = OpportunityMarketReaction;
type MaybePromise<T> = T | Promise<T>;

export type OpportunitySourceReaders = {
  telegram: (limit: number) => MaybePromise<Pick<TelegramDashboardSnapshot, "feed">>;
  x: (limit: number) => MaybePromise<Pick<TwitterDashboardSnapshot, "feed">>;
  catalysts: (env: EnvLike) => MaybePromise<StocksCatalystSnapshot | null>;
  douyin: (env: EnvLike) => MaybePromise<Pick<DouyinSnapshot, "videos">>;
  readPersistedTigerHoldingData: () => MaybePromise<Awaited<ReturnType<typeof readPersistedTigerHoldingData>>>;
  readPersistedBinanceHoldingSnapshot: () => MaybePromise<Awaited<ReturnType<typeof readPersistedBinanceHoldingSnapshot>>>;
  market: (env: EnvLike) => MaybePromise<StocksMarketSnapshot | null>;
};

const MAX_TEXT_EXCERPT_LENGTH = 2_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const TICKER_PATTERN = /\$([A-Z][A-Z0-9.]{0,9})\b/g;
const ORDER_TERMS = /order|contract|订单|中标|采购/i;
const EARNINGS_TERMS = /earnings|revenue|eps|guidance|财报|业绩|指引/i;
const POLICY_TERMS = /policy|regulation|tariff|ban|政策|监管|关税|禁令/i;
const CRYPTO_ASSET_KEYS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "SUI",
  "TON",
  "TRX",
]);
const STABLECOIN_ASSETS = new Set([
  "USDT",
  "USDC",
  "BUSD",
  "FDUSD",
  "TUSD",
  "DAI",
  "USDP",
  "USDD",
]);

function nonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  const text = nonEmptyString(value);
  return text || null;
}

function uniqueAssetKeys(values: Iterable<string>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(key);
  }
  return result;
}

function sourceMarket(assetKeys: string[], fallback: OpportunityMarket = "us") {
  return assetKeys.some((key) => CRYPTO_ASSET_KEYS.has(key.toUpperCase()))
    ? "crypto"
    : fallback;
}

function isWithinSevenDays(value: unknown, now: Date) {
  const timestamp = new Date(nonEmptyString(value)).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const nowMs = now.getTime();
  return timestamp <= nowMs && timestamp >= nowMs - SEVEN_DAYS_MS;
}

function textExcerpt(text: string) {
  return text.slice(0, MAX_TEXT_EXCERPT_LENGTH);
}

function buildSourceItem({
  id,
  sourceType,
  sourceName,
  market,
  assetKeys,
  eventType,
  publishedAt,
  text,
  translation,
  originalUrl,
}: OpportunitySourceItem): OpportunitySourceItemWithExcerpt {
  return {
    id,
    sourceType,
    sourceName,
    market,
    assetKeys: uniqueAssetKeys(assetKeys),
    eventType,
    publishedAt,
    text,
    textExcerpt: textExcerpt(text),
    translation,
    originalUrl,
  };
}

function catalystEventType(type: unknown, text: string): OpportunityEventType {
  const inferred = inferOpportunityEventType(text);
  if (inferred !== "other") return inferred;
  if (type === "product") return "product";
  if (type === "supply-chain") return "supply-chain";
  if (type === "regulatory") return "policy";
  if (type === "earnings") return "earnings";
  return "other";
}

function sourceTypeForCatalyst(source: string) {
  return source.toLowerCase() === "patreon" ? "patreon" : "news";
}

function stableCatalystId({
  sourceType,
  source,
  ticker,
  publishedAt,
  link,
  category,
}: {
  sourceType: string;
  source: string;
  ticker: string;
  publishedAt: string;
  link: string;
  category: string;
}) {
  if (link) return `${sourceType}:${ticker}:${link}`;
  const metadataHash = createHash("sha256")
    .update(
      [sourceType, source.trim().toLowerCase(), ticker, publishedAt, category]
        .join("\n"),
    )
    .digest("hex");
  return `${sourceType}:${source}:${ticker}:${publishedAt}:${metadataHash}`;
}

function isPositiveHoldingAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function inferOpportunityEventType(text: string): OpportunityEventType {
  if (ORDER_TERMS.test(text)) return "order";
  if (EARNINGS_TERMS.test(text)) return "earnings";
  if (POLICY_TERMS.test(text)) return "policy";
  return "other";
}

export function extractOpportunityAssetKeys(text: string) {
  return uniqueAssetKeys(
    [...text.matchAll(TICKER_PATTERN)].map((match) => match[1].toUpperCase()),
  );
}

export function normalizeTelegramOpportunityItems(
  snapshot: { feed?: Array<Record<string, unknown>> },
  { now = new Date() }: SourceNormalizerOptions = {},
): OpportunitySourceItemWithExcerpt[] {
  return (snapshot.feed ?? []).flatMap((item) => {
    const publishedAt = nonEmptyString(item.createdAt);
    if (!isWithinSevenDays(publishedAt, now)) return [];

    const text = nonEmptyString(item.text);
    if (!text) return [];
    const translation = optionalString((item.translation as { text?: unknown } | null)?.text);
    const assetKeys = extractOpportunityAssetKeys(`${text}\n${translation ?? ""}`);
    return [
      buildSourceItem({
        id: `telegram:${nonEmptyString(item.id)}`,
        sourceType: "telegram",
        sourceName:
          nonEmptyString(item.channelTitle) ||
          nonEmptyString(item.channelUsername) ||
          "Telegram",
        market: sourceMarket(assetKeys),
        assetKeys,
        eventType: inferOpportunityEventType(`${text}\n${translation ?? ""}`),
        publishedAt,
        text,
        translation,
        originalUrl: nonEmptyString(item.messageUrl),
      }),
    ];
  });
}

export function normalizeXOpportunityItems(
  snapshot: { feed?: Array<Record<string, unknown>> },
  { now = new Date() }: SourceNormalizerOptions = {},
): OpportunitySourceItemWithExcerpt[] {
  return (snapshot.feed ?? []).flatMap((item) => {
    const publishedAt = nonEmptyString(item.createdAt);
    if (!isWithinSevenDays(publishedAt, now)) return [];

    const text = nonEmptyString(item.text);
    if (!text) return [];
    const translation = optionalString((item.translation as { text?: unknown } | null)?.text);
    const assetKeys = extractOpportunityAssetKeys(`${text}\n${translation ?? ""}`);
    const username = nonEmptyString(item.username);
    return [
      buildSourceItem({
        id: `x:${nonEmptyString(item.id)}`,
        sourceType: "x",
        sourceName: username ? `@${username}` : nonEmptyString(item.displayName) || "X",
        market: sourceMarket(assetKeys),
        assetKeys,
        eventType: inferOpportunityEventType(`${text}\n${translation ?? ""}`),
        publishedAt,
        text,
        translation,
        originalUrl: nonEmptyString(item.tweetUrl),
      }),
    ];
  });
}

export function normalizeCatalystOpportunityItems(
  snapshot: { catalysts?: Record<string, Array<Record<string, unknown>>> },
  { now = new Date() }: SourceNormalizerOptions = {},
): OpportunitySourceItemWithExcerpt[] {
  const items: OpportunitySourceItemWithExcerpt[] = [];
  for (const [ticker, catalysts] of Object.entries(snapshot.catalysts ?? {})) {
    for (const catalyst of catalysts) {
      const publishedAt = nonEmptyString(catalyst.date);
      if (!isWithinSevenDays(publishedAt, now)) continue;

      const title = nonEmptyString(catalyst.title);
      const summary = nonEmptyString(catalyst.summary);
      const text = [title, summary].filter(Boolean).join("\n");
      if (!text) continue;

      const source = nonEmptyString(catalyst.source) || "Stocks catalyst";
      const sourceType = sourceTypeForCatalyst(source);
      const originalUrl = nonEmptyString(catalyst.link);
      const normalizedTicker = ticker.toUpperCase();
      const assetKeys = uniqueAssetKeys([
        normalizedTicker,
        ...extractOpportunityAssetKeys(text),
      ]);
      items.push(
        buildSourceItem({
          id: stableCatalystId({
            sourceType,
            source,
            ticker: normalizedTicker,
            publishedAt,
            link: originalUrl,
            category: nonEmptyString(catalyst.type).toLowerCase() || "other",
          }),
          sourceType,
          sourceName: nonEmptyString(catalyst.author) || source,
          market: sourceMarket(assetKeys),
          assetKeys,
          eventType: catalystEventType(catalyst.type, text),
          publishedAt,
          // Do not use fullSummary: it may contain private Patreon body text.
          text,
          translation: null,
          originalUrl,
        }),
      );
    }
  }
  return items;
}

export function normalizeDouyinOpportunityItems(
  snapshot: { videos?: Array<Record<string, unknown>> },
  { now = new Date() }: SourceNormalizerOptions = {},
): OpportunitySourceItemWithExcerpt[] {
  return (snapshot.videos ?? []).flatMap((video) => {
    const publishedAt = nonEmptyString(video.publishedAt);
    if (!isWithinSevenDays(publishedAt, now)) return [];

    const summary = video.summary as Record<string, unknown> | null;
    if (!summary || summary.status === "error") return [];
    const title = nonEmptyString(video.title);
    const coreView = nonEmptyString(summary.coreView);
    const reasons = Array.isArray(summary.recommendationReasons)
      ? summary.recommendationReasons.map(nonEmptyString).filter(Boolean)
      : [];
    const catalysts = Array.isArray(summary.catalysts)
      ? summary.catalysts.map(nonEmptyString).filter(Boolean)
      : [];
    const text = [title, coreView, ...reasons, ...catalysts].filter(Boolean).join("\n");
    if (!text) return [];

    const summaryAssets = Array.isArray(summary.assets)
      ? summary.assets.map(nonEmptyString).filter(Boolean)
      : [];
    const assetKeys = uniqueAssetKeys([
      ...summaryAssets,
      ...extractOpportunityAssetKeys(text),
    ]);
    return [
      buildSourceItem({
        id: `douyin:${nonEmptyString(video.id)}`,
        sourceType: "douyin",
        sourceName: nonEmptyString(video.creatorName) || "Douyin",
        market: "cn",
        assetKeys,
        eventType: inferOpportunityEventType(text),
        publishedAt,
        text,
        translation: null,
        originalUrl: nonEmptyString(video.videoUrl),
      }),
    ];
  });
}

export function dedupeOpportunitySourceItems(
  items: OpportunitySourceItemWithExcerpt[],
) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function emptyOnFailure<T>(loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

const defaultOpportunitySourceReaders: OpportunitySourceReaders = {
  telegram: (limit) => getTelegramPipelineSnapshot(limit),
  x: (limit) => getXPipelineSnapshot(limit),
  catalysts: (env) =>
    readStocksSnapshotCache<StocksCatalystSnapshot>({
      kind: "catalysts",
      env,
      allowStale: true,
    }),
  douyin: (env) => getDouyinSnapshot({ env }),
  readPersistedTigerHoldingData: () => readPersistedTigerHoldingData(),
  readPersistedBinanceHoldingSnapshot: () => readPersistedBinanceHoldingSnapshot(),
  market: (env) =>
    readStocksSnapshotCache<StocksMarketSnapshot>({
      kind: "market",
      env,
      allowStale: true,
    }),
};

export async function loadOpportunitySourceItems({
  env = process.env,
  readers = defaultOpportunitySourceReaders,
}: {
  env?: EnvLike;
  readers?: OpportunitySourceReaders;
} = {}) {
  const telegram = await emptyOnFailure<Pick<TelegramDashboardSnapshot, "feed">>(
    async () => await readers.telegram(1_000),
    { feed: [] },
  );
  const x = await emptyOnFailure<Pick<TwitterDashboardSnapshot, "feed">>(
    async () => await readers.x(1_000),
    { feed: [] },
  );
  const catalysts = await emptyOnFailure(
    async () => await readers.catalysts(env),
    null,
  );
  const douyin = await emptyOnFailure<Pick<DouyinSnapshot, "videos">>(
    async () => await readers.douyin(env),
    { videos: [] },
  );

  return dedupeOpportunitySourceItems([
    ...normalizeTelegramOpportunityItems(telegram),
    ...normalizeXOpportunityItems(x),
    ...normalizeCatalystOpportunityItems(catalysts ?? { catalysts: {} }),
    ...normalizeDouyinOpportunityItems(douyin),
  ]);
}

export async function loadOpportunityPriorityAssetKeys({
  readers = defaultOpportunitySourceReaders,
}: {
  readers?: OpportunitySourceReaders;
} = {}) {
  const [tiger, binance] = await Promise.all([
    emptyOnFailure(async () => await readers.readPersistedTigerHoldingData(), null),
    emptyOnFailure(async () => await readers.readPersistedBinanceHoldingSnapshot(), null),
  ]);
  const keys = new Set(ALPHA_RESEARCH_STOCK_UNIVERSE.map((ticker) => ticker.toUpperCase()));

  for (const position of tiger?.snapshot.positions ?? []) {
    const key = position.kind === "option" ? position.option?.underlying : position.symbol;
    if (key) keys.add(key.toUpperCase());
  }
  for (const position of binance?.futuresPositions ?? []) {
    if (position.symbol) keys.add(position.symbol.toUpperCase());
  }
  for (const balance of binance?.spotBalances ?? []) {
    const asset = balance.asset?.toUpperCase();
    if (asset && !STABLECOIN_ASSETS.has(asset) && isPositiveHoldingAmount(balance.total)) {
      keys.add(asset);
    }
  }
  return keys;
}

export async function loadOpportunityMarketReaction(
  assetKeys: string[],
  {
    env = process.env,
    readers = defaultOpportunitySourceReaders,
  }: {
    env?: EnvLike;
    readers?: OpportunitySourceReaders;
  } = {},
): Promise<MarketReaction> {
  const [market, binance] = await Promise.all([
    emptyOnFailure(async () => await readers.market(env), null),
    emptyOnFailure(async () => await readers.readPersistedBinanceHoldingSnapshot(), null),
  ]);

  for (const assetKey of assetKeys) {
    const normalized = assetKey.trim().toUpperCase();
    if (
      !normalized ||
      /[\u3400-\u9fff]/u.test(normalized) ||
      /^\d{6}(?:\.(?:SZ|SS))?$/.test(normalized)
    ) {
      continue;
    }
    const quote = market?.quotes?.[normalized];
    if (quote && Number.isFinite(quote.dayChangePct)) {
      return { available: true, absoluteMovePercent: Math.abs(quote.dayChangePct) };
    }

    const position = binance?.futuresPositions.find((item) =>
      [item.symbol, item.symbol.replace(/USDT$/, "")]
        .map((value) => value.toUpperCase())
        .includes(normalized),
    );
    if (position && position.entryPrice > 0 && Number.isFinite(position.markPrice)) {
      return {
        available: true,
        absoluteMovePercent: Math.abs(
          ((position.markPrice - position.entryPrice) / position.entryPrice) * 100,
        ),
      };
    }
  }
  return { available: false, absoluteMovePercent: null };
}
