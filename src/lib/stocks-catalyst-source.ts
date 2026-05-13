import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AlphaResearchStock } from "./alpha-research-pool.ts";
import {
  buildMockStocksCatalystSnapshot,
  buildStocksCatalystSnapshotFromItems,
  parseAlphaVantageNewsPayload,
  parseFmpStockNewsPayload,
  parseFinnhubCompanyNewsPayload,
  parseGoogleNewsRss,
  parsePatreonPostsPage,
  parsePolygonNewsPayload,
  parseYahooFinanceRss,
  type StocksCatalystSnapshot,
  type StocksCatalystSourceItem,
} from "./stocks-catalyst-data.ts";
import { getTelegramPipelineSnapshot } from "./telegram-pipeline-store.ts";
import { getXPipelineSnapshot } from "./x-pipeline-store.ts";
import { translateText, type TranslationNote } from "./translate.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type TranslateLike = (
  text: string,
  options?: {
    enabled?: boolean;
    targetLanguage?: string;
    cacheNamespace?: string;
  },
) => Promise<TranslationNote | null>;
type ExternalNewsProvider =
  | "auto"
  | "polygon"
  | "fmp"
  | "finnhub"
  | "alpha-vantage"
  | "yahoo"
  | "google-news"
  | "mock";
type ExternalCatalystResult = {
  items: StocksCatalystSourceItem[];
  errors: string[];
};

const STOCK_PRIORITY_RANK: Record<AlphaResearchStock["priority"], number> = {
  A: 0,
  B: 1,
  C: 2,
};

const externalCatalystCache = new Map<
  string,
  { expiresAt: number; result: ExternalCatalystResult }
>();

type ExternalCatalystCacheFile = Record<
  string,
  { expiresAt: number; result: ExternalCatalystResult }
>;

function positiveInt(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function nonNegativeInt(
  raw: string | undefined,
  fallback: number,
  max: number,
) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeExternalNewsProvider(
  raw: string | undefined,
): ExternalNewsProvider {
  const value = raw?.trim().toLowerCase();
  if (
    value === "polygon" ||
    value === "fmp" ||
    value === "finnhub" ||
    value === "alpha-vantage" ||
    value === "alphavantage" ||
    value === "yahoo" ||
    value === "google-news" ||
    value === "googlenews" ||
    value === "mock"
  ) {
    if (value === "alphavantage") return "alpha-vantage";
    if (value === "googlenews") return "google-news";
    return value;
  }
  return "auto";
}

function polygonApiKey(env: EnvLike) {
  return (
    env.STOCKS_POLYGON_API_KEY?.trim() ||
    env.STOCKS_MASSIVE_API_KEY?.trim() ||
    env.POLYGON_API_KEY?.trim() ||
    env.MASSIVE_API_KEY?.trim() ||
    ""
  );
}

function fmpApiKey(env: EnvLike) {
  return env.STOCKS_FMP_API_KEY?.trim() || env.FMP_API_KEY?.trim() || "";
}

function alphaVantageApiKey(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_API_KEY?.trim() ||
    env.ALPHA_VANTAGE_API_KEY?.trim() ||
    ""
  );
}

function finnhubApiKey(env: EnvLike) {
  return env.STOCKS_FINNHUB_API_KEY?.trim() || env.FINNHUB_API_KEY?.trim() || "";
}

function shouldUseFmpNewsInAuto(env: EnvLike) {
  return env.STOCKS_FMP_NEWS_ENABLED?.trim().toLowerCase() === "true";
}

function shouldIncludeLocalSignals(env: EnvLike) {
  return env.STOCKS_INCLUDE_LOCAL_SIGNALS?.trim().toLowerCase() !== "false";
}

function shouldIncludePatreonSubscription(env: EnvLike) {
  return (
    env.STOCKS_PATREON_ENABLED?.trim().toLowerCase() === "true" ||
    env.STOCKS_SUBSCRIPTION_RESEARCH_ENABLED?.trim().toLowerCase() === "true"
  );
}

function patreonPostsUrl(env: EnvLike) {
  return (
    env.STOCKS_PATREON_URL?.trim() ||
    env.PATREON_POSTS_URL?.trim() ||
    ""
  );
}

function patreonCookie(env: EnvLike) {
  return (
    env.STOCKS_PATREON_COOKIE?.trim() ||
    env.PATREON_COOKIE?.trim() ||
    ""
  );
}

function patreonCreatorName(env: EnvLike) {
  const configured = env.STOCKS_PATREON_CREATOR_NAME?.trim();
  if (configured) return configured;
  const url = patreonPostsUrl(env);
  const match = url.match(/patreon\.com\/(?:c\/)?([^/?#]+)/i);
  return match?.[1] || "Patreon";
}

function sortedStocksByPriority(stocks: AlphaResearchStock[]) {
  return stocks
    .map((stock, index) => ({ stock, index }))
    .sort(
      (left, right) =>
        STOCK_PRIORITY_RANK[left.stock.priority] -
          STOCK_PRIORITY_RANK[right.stock.priority] || left.index - right.index,
    )
    .map((item) => item.stock);
}

function selectProviderStocks(
  stocks: AlphaResearchStock[],
  rawLimit: string | undefined,
  fallback: number,
) {
  const limit = positiveInt(rawLimit, fallback, stocks.length);
  return sortedStocksByPriority(stocks).slice(0, limit);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function externalNewsCacheMs(env: EnvLike) {
  return nonNegativeInt(env.STOCKS_NEWS_CACHE_MS, 10 * 60 * 1000, 60 * 60 * 1000);
}

function externalNewsStaleCacheMs(env: EnvLike) {
  return nonNegativeInt(
    env.STOCKS_NEWS_STALE_CACHE_MS,
    24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
  );
}

function externalNewsCacheKey({
  stocks,
  provider,
  env,
}: {
  stocks: AlphaResearchStock[];
  provider: ExternalNewsProvider;
  env: EnvLike;
}) {
  return [
    provider,
    stocks.map((stock) => `${stock.ticker}:${stock.priority}`).join(","),
    env.STOCKS_NEWS_ITEMS_PER_TICKER ?? "",
    env.STOCKS_POLYGON_MAX_TICKERS ?? "",
    env.STOCKS_FMP_BY_TICKER ?? "",
    env.STOCKS_FMP_BATCH_SIZE ?? "",
    env.STOCKS_FMP_MAX_TICKERS ?? "",
    env.STOCKS_ALPHA_VANTAGE_MAX_TICKERS ?? "",
    env.STOCKS_ALPHA_VANTAGE_BATCH_SIZE ?? "",
    env.STOCKS_ALPHA_VANTAGE_LIMIT ?? "",
    env.STOCKS_ALPHA_VANTAGE_REQUEST_DELAY_MS ?? "",
    env.STOCKS_FINNHUB_NEWS_MAX_TICKERS ?? "",
    env.STOCKS_FINNHUB_NEWS_LOOKBACK_DAYS ?? "",
    env.STOCKS_GOOGLE_NEWS_MAX_TICKERS ?? "",
    env.STOCKS_YAHOO_NEWS_MAX_TICKERS ?? "",
    env.STOCKS_FMP_NEWS_ENABLED ?? "",
    env.STOCKS_POLYGON_BASE_URL ?? env.STOCKS_MASSIVE_BASE_URL ?? "",
    "translation-v4",
    env.STOCKS_NEWS_TRANSLATE_ENABLED ?? "",
    env.STOCKS_NEWS_TRANSLATE_TARGET ?? env.TELEGRAM_TRANSLATE_TARGET ?? "",
    env.STOCKS_NEWS_TRANSLATE_MAX_ITEMS ?? "",
    env.STOCKS_NEWS_TRANSLATE_TIMEOUT_MS ?? "",
    env.STOCKS_NEWS_TRANSLATE_CONCURRENCY ?? "",
    env.TRANSLATION_PROVIDERS ?? "",
    env.AI_TRANSLATION_TIMEOUT_MS ?? "",
    env.AI_TRANSLATION_BASE_URL ?? env.AI_SUMMARY_BASE_URL ?? "",
    env.AI_TRANSLATION_MODEL ?? env.AI_SUMMARY_MODEL ?? "",
  ].join("|");
}

function patreonCacheMs(env: EnvLike) {
  return nonNegativeInt(
    env.STOCKS_PATREON_CACHE_MS,
    30 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );
}

function patreonCacheKey({
  stocks,
  env,
}: {
  stocks: AlphaResearchStock[];
  env: EnvLike;
}) {
  return [
    "patreon-v1",
    stocks.map((stock) => `${stock.ticker}:${stock.priority}`).join(","),
    patreonPostsUrl(env),
    env.STOCKS_PATREON_CREATOR_NAME ?? "",
    env.STOCKS_PATREON_MAX_POSTS ?? "",
  ].join("|");
}

function externalNewsCachePath(env: EnvLike) {
  const configured = env.STOCKS_NEWS_CACHE_PATH?.trim();
  return configured
    ? resolve(configured)
    : resolve(process.cwd(), ".signal-hub", "stocks-catalysts-cache.json");
}

function readExternalNewsFileCache(env: EnvLike): ExternalCatalystCacheFile {
  try {
    return JSON.parse(
      readFileSync(externalNewsCachePath(env), "utf8"),
    ) as ExternalCatalystCacheFile;
  } catch {
    return {};
  }
}

function writeExternalNewsFileCache(
  env: EnvLike,
  key: string,
  entry: { expiresAt: number; result: ExternalCatalystResult },
) {
  try {
    const cachePath = externalNewsCachePath(env);
    const cache = readExternalNewsFileCache(env);
    cache[key] = entry;
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache), "utf8");
  } catch {}
}

function readCachedExternalNewsResult({
  env,
  key,
  now,
}: {
  env: EnvLike;
  key: string;
  now: number;
}) {
  const memoryEntry = externalCatalystCache.get(key);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    return memoryEntry.result;
  }
  const fileEntry = readExternalNewsFileCache(env)[key];
  if (fileEntry && fileEntry.expiresAt > now) {
    externalCatalystCache.set(key, fileEntry);
    return fileEntry.result;
  }
  return null;
}

function readStaleExternalNewsResult({
  env,
  key,
  now,
}: {
  env: EnvLike;
  key: string;
  now: number;
}) {
  const staleMs = externalNewsStaleCacheMs(env);
  if (staleMs <= 0) return null;
  const memoryEntry = externalCatalystCache.get(key);
  if (memoryEntry && memoryEntry.expiresAt + staleMs > now) {
    return memoryEntry.result;
  }
  const fileEntry = readExternalNewsFileCache(env)[key];
  if (fileEntry && fileEntry.expiresAt + staleMs > now) {
    externalCatalystCache.set(key, fileEntry);
    return fileEntry.result;
  }
  return null;
}

function yahooRssUrl(ticker: string) {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    ticker,
  )}&region=US&lang=en-US`;
}

function googleNewsRssUrl(stock: AlphaResearchStock) {
  const query = `${stock.ticker} stock OR ${stock.companyName}`;
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function polygonNewsUrl(ticker: string, apiKey: string, limit: number) {
  const params = new URLSearchParams({
    ticker,
    limit: String(limit),
    order: "desc",
    sort: "published_utc",
    apiKey,
  });
  return `https://api.polygon.io/v2/reference/news?${params.toString()}`;
}

function polygonNewsUrlForEnv(
  ticker: string,
  apiKey: string,
  limit: number,
  env: EnvLike,
) {
  const baseUrl =
    env.STOCKS_POLYGON_BASE_URL?.trim().replace(/\/+$/, "") ||
    env.STOCKS_MASSIVE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://api.polygon.io";
  return polygonNewsUrl(ticker, apiKey, limit).replace(
    "https://api.polygon.io",
    baseUrl,
  );
}

function fmpNewsUrl(apiKey: string, limit: number) {
  const params = new URLSearchParams({
    page: "0",
    limit: String(limit),
    apikey: apiKey,
  });
  return `https://financialmodelingprep.com/stable/news/stock-latest?${params.toString()}`;
}

function fmpTickerNewsUrl(tickers: string[], apiKey: string, limit: number) {
  const params = new URLSearchParams({
    symbols: tickers.join(","),
    limit: String(limit),
    apikey: apiKey,
  });
  return `https://financialmodelingprep.com/stable/news/stock?${params.toString()}`;
}

function alphaVantageNewsUrl(tickers: string[], apiKey: string, limit: number) {
  const params = new URLSearchParams({
    function: "NEWS_SENTIMENT",
    tickers: tickers.join(","),
    sort: "LATEST",
    limit: String(limit),
    apikey: apiKey,
  });
  return `https://www.alphavantage.co/query?${params.toString()}`;
}

function finnhubCompanyNewsUrl({
  ticker,
  apiKey,
  env,
}: {
  ticker: string;
  apiKey: string;
  env: EnvLike;
}) {
  const lookbackDays = positiveInt(
    env.STOCKS_FINNHUB_NEWS_LOOKBACK_DAYS,
    7,
    30,
  );
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    symbol: ticker,
    from: formatDate(from),
    to: formatDate(to),
    token: apiKey,
  });
  return `https://finnhub.io/api/v1/company-news?${params.toString()}`;
}

function shouldFetchFmpByTicker(env: EnvLike) {
  return env.STOCKS_FMP_BY_TICKER?.trim().toLowerCase() !== "false";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerErrorFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["Note", "Information", "Error Message"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  return "";
}

function shouldTranslateStocksNews(env: EnvLike) {
  return env.STOCKS_NEWS_TRANSLATE_ENABLED?.trim().toLowerCase() !== "false";
}

function stocksNewsTranslateTarget(env: EnvLike) {
  return (
    env.STOCKS_NEWS_TRANSLATE_TARGET?.trim() ||
    env.TELEGRAM_TRANSLATE_TARGET?.trim() ||
    "zh-CN"
  );
}

function stocksNewsTranslateMaxItems(env: EnvLike) {
  return nonNegativeInt(env.STOCKS_NEWS_TRANSLATE_MAX_ITEMS, 160, 250);
}

function stocksNewsTranslateTimeoutMs(env: EnvLike) {
  return nonNegativeInt(env.STOCKS_NEWS_TRANSLATE_TIMEOUT_MS, 30000, 120000);
}

function stocksNewsTranslateConcurrency(env: EnvLike) {
  return positiveInt(env.STOCKS_NEWS_TRANSLATE_CONCURRENCY, 4, 8);
}

async function translateWithTimeout(
  request: Promise<TranslationNote | null>,
  timeoutMs: number,
) {
  if (timeoutMs <= 0) return request;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      request,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function translateExternalCatalystItems({
  items,
  env,
  translateImpl,
}: {
  items: StocksCatalystSourceItem[];
  env: EnvLike;
  translateImpl: TranslateLike;
}): Promise<{
  items: StocksCatalystSourceItem[];
  attemptedCount: number;
  translatedCount: number;
}> {
  if (!shouldTranslateStocksNews(env)) {
    return { items, attemptedCount: 0, translatedCount: 0 };
  }
  const targetLanguage = stocksNewsTranslateTarget(env);
  const maxItems = stocksNewsTranslateMaxItems(env);
  if (maxItems <= 0) return { items, attemptedCount: 0, translatedCount: 0 };
  const timeoutMs = stocksNewsTranslateTimeoutMs(env);
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => !item.translation && item.sourceRole === "external",
    )
    .slice(0, maxItems);
  if (candidates.length === 0) {
    return { items, attemptedCount: 0, translatedCount: 0 };
  }

  const translated = [...items];
  let translatedCount = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor];
      cursor += 1;
      if (!current) continue;
      const { item, index } = current;
      const note = await translateWithTimeout(
        translateImpl(item.text, {
          enabled: true,
          targetLanguage,
          cacheNamespace: "stocks-news",
        }),
        timeoutMs,
      ).catch(() => null);
      if (note?.text) {
        translatedCount += 1;
      }
      translated[index] = {
        ...item,
        translation: note?.text ?? null,
      };
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          stocksNewsTranslateConcurrency(env),
          candidates.length,
        ),
      },
      worker,
    ),
  );

  return {
    items: translated,
    attemptedCount: candidates.length,
    translatedCount,
  };
}

async function fetchPolygonCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const apiKey = polygonApiKey(env);
  if (!apiKey) throw new Error("Polygon API key is not configured");
  const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
  const providerStocks = selectProviderStocks(
    stocks,
    env.STOCKS_POLYGON_MAX_TICKERS,
    5,
  );
  const items = await Promise.all(
    providerStocks.map(async (stock) => {
      const response = await fetchImpl(
        polygonNewsUrlForEnv(stock.ticker, apiKey, limit, env),
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Polygon news HTTP ${response.status}`);
      }
      return parsePolygonNewsPayload(await response.json());
    }),
  );
  return items.flat();
}

async function fetchFmpCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const apiKey = fmpApiKey(env);
  if (!apiKey) throw new Error("FMP API key is not configured");
  const stockTickers = new Set(stocks.map((stock) => stock.ticker));
  const fetchLatestItems = async () => {
    const response = await fetchImpl(
      fmpNewsUrl(apiKey, positiveInt(env.STOCKS_NEWS_READ_LIMIT, 120, 300)),
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`FMP stock news HTTP ${response.status}`);
    }
    return parseFmpStockNewsPayload(await response.json()).filter((item) =>
      (item.tickers ?? []).some((ticker) => stockTickers.has(ticker)),
    );
  };

  if (shouldFetchFmpByTicker(env)) {
    const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
    const providerStocks = selectProviderStocks(
      stocks,
      env.STOCKS_FMP_MAX_TICKERS,
      stocks.length,
    );
    const batchSize = positiveInt(env.STOCKS_FMP_BATCH_SIZE, 10, 25);
    try {
      const tickerItems = await Promise.all(
        chunks(providerStocks, batchSize).map(async (batch) => {
          const response = await fetchImpl(
            fmpTickerNewsUrl(
              batch.map((stock) => stock.ticker),
              apiKey,
              limit,
            ),
            { cache: "no-store" },
          );
          if (!response.ok) {
            throw new Error(`FMP stock news HTTP ${response.status}`);
          }
          return parseFmpStockNewsPayload(await response.json());
        }),
      );
      return tickerItems.flat().filter((item) =>
        (item.tickers ?? []).some((ticker) => stockTickers.has(ticker)),
      );
    } catch (error) {
      try {
        return await fetchLatestItems();
      } catch (fallbackError) {
        throw new Error(
          `${errorMessage(error)}; latest fallback failed: ${errorMessage(
            fallbackError,
          )}`,
        );
      }
    }
  }
  return fetchLatestItems();
}

async function fetchAlphaVantageCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const apiKey = alphaVantageApiKey(env);
  if (!apiKey) throw new Error("Alpha Vantage API key is not configured");
  const providerStocks = selectProviderStocks(
    stocks,
    env.STOCKS_ALPHA_VANTAGE_MAX_TICKERS,
    5,
  );
  const batchSize = positiveInt(env.STOCKS_ALPHA_VANTAGE_BATCH_SIZE, 5, 10);
  const limit = positiveInt(env.STOCKS_ALPHA_VANTAGE_LIMIT, 50, 1000);
  const requestDelay =
    fetchImpl === fetch
      ? nonNegativeInt(
          env.STOCKS_ALPHA_VANTAGE_REQUEST_DELAY_MS,
          1200,
          5000,
        )
      : 0;
  const items: StocksCatalystSourceItem[][] = [];
  const batches = chunks(providerStocks, batchSize);
  for (const [index, batch] of batches.entries()) {
    if (index > 0 && requestDelay > 0) {
      await sleep(requestDelay);
    }
    const response = await fetchImpl(
      alphaVantageNewsUrl(
        batch.map((stock) => stock.ticker),
        apiKey,
        limit,
      ),
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Alpha Vantage news HTTP ${response.status}`);
    }
    const payload = await response.json();
    const providerError = providerErrorFromPayload(payload);
    if (providerError) throw new Error(providerError);
    items.push(parseAlphaVantageNewsPayload(payload));
  }
  return items.flat();
}

async function fetchFinnhubCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const apiKey = finnhubApiKey(env);
  if (!apiKey) throw new Error("Finnhub API key is not configured");
  const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
  const providerStocks = selectProviderStocks(
    stocks.filter((stock) => !stock.ticker.includes(".")),
    env.STOCKS_FINNHUB_NEWS_MAX_TICKERS,
    8,
  );
  if (providerStocks.length === 0) return [];
  const items = await Promise.all(
    providerStocks.map(async (stock) => {
      const response = await fetchImpl(
        finnhubCompanyNewsUrl({
          ticker: stock.ticker,
          apiKey,
          env,
        }),
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Finnhub company news HTTP ${response.status}`);
      }
      return parseFinnhubCompanyNewsPayload(
        await response.json(),
        stock.ticker,
      ).slice(0, limit);
    }),
  );
  return items.flat();
}

async function fetchYahooCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
  const providerStocks = selectProviderStocks(
    stocks,
    env.STOCKS_YAHOO_NEWS_MAX_TICKERS,
    stocks.length,
  );
  const items = await Promise.all(
    providerStocks.map(async (stock) => {
      const response = await fetchImpl(yahooRssUrl(stock.ticker), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Yahoo Finance RSS HTTP ${response.status}`);
      }
      const xml = await response.text();
      return parseYahooFinanceRss(xml, stock.ticker).slice(0, limit);
    }),
  );
  return items.flat();
}

async function fetchGoogleNewsCatalystItems({
  stocks,
  fetchImpl,
  env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
  const providerStocks = selectProviderStocks(
    stocks,
    env.STOCKS_GOOGLE_NEWS_MAX_TICKERS,
    8,
  );
  const items = await Promise.all(
    providerStocks.map(async (stock) => {
      const response = await fetchImpl(googleNewsRssUrl(stock), {
        cache: "no-store",
        headers: {
          accept: "application/rss+xml,text/xml,*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Google News RSS HTTP ${response.status}`);
      }
      const xml = await response.text();
      return parseGoogleNewsRss(xml, stock.ticker).slice(0, limit);
    }),
  );
  return items.flat();
}

export async function fetchPatreonSubscriptionItems({
  stocks,
  fetchImpl = fetch,
  env = process.env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<ExternalCatalystResult> {
  if (!shouldIncludePatreonSubscription(env)) return { items: [], errors: [] };

  const url = patreonPostsUrl(env);
  if (!url) {
    return { items: [], errors: ["Patreon: STOCKS_PATREON_URL is not configured"] };
  }
  const cookie = patreonCookie(env);
  if (!cookie) {
    return { items: [], errors: ["Patreon: STOCKS_PATREON_COOKIE is not configured"] };
  }

  const cacheMs = patreonCacheMs(env);
  const cacheKey = patreonCacheKey({ stocks, env });
  if (fetchImpl === fetch && cacheMs > 0) {
    const cached = readCachedExternalNewsResult({
      env,
      key: cacheKey,
      now: Date.now(),
    });
    if (cached) return cached;
  }

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        cookie,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Patreon posts HTTP ${response.status}`);
    }
    const items = parsePatreonPostsPage(await response.text(), {
      sourceUrl: url,
      creatorName: patreonCreatorName(env),
      maxPosts: positiveInt(env.STOCKS_PATREON_MAX_POSTS, 10, 25),
    });
    const result = {
      items,
      errors: items.length > 0 ? [] : ["Patreon: no subscription posts parsed"],
    };
    if (fetchImpl === fetch && cacheMs > 0 && result.items.length > 0) {
      const entry = {
        expiresAt: Date.now() + cacheMs,
        result,
      };
      externalCatalystCache.set(cacheKey, entry);
      writeExternalNewsFileCache(env, cacheKey, entry);
    }
    return result;
  } catch (error) {
    return {
      items: [],
      errors: [`Patreon: ${errorMessage(error)}`],
    };
  }
}

export async function fetchExternalCatalystItems({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  provider = normalizeExternalNewsProvider(env.STOCKS_NEWS_PROVIDER),
  translateImpl = translateText,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  provider?: ExternalNewsProvider;
  translateImpl?: TranslateLike;
}): Promise<ExternalCatalystResult> {
  if (provider === "mock") return { items: [], errors: [] };
  const cacheMs = externalNewsCacheMs(env);
  const cacheKey = externalNewsCacheKey({ stocks, provider, env });
  if (fetchImpl === fetch && cacheMs > 0) {
    const cached = readCachedExternalNewsResult({
      env,
      key: cacheKey,
      now: Date.now(),
    });
    if (cached) return cached;
  }

  const providers =
    provider === "auto"
      ? ([
          ...(polygonApiKey(env) ? ["polygon"] : []),
          ...(finnhubApiKey(env) ? ["finnhub"] : []),
          ...(alphaVantageApiKey(env) ? ["alpha-vantage"] : []),
          "yahoo",
          "google-news",
          ...(fmpApiKey(env) && shouldUseFmpNewsInAuto(env) ? ["fmp"] : []),
        ] as ExternalNewsProvider[])
      : [provider];
  const errors: string[] = [];
  const collected: StocksCatalystSourceItem[] = [];

  for (const candidate of providers) {
    try {
      const items =
        candidate === "polygon"
          ? await fetchPolygonCatalystItems({ stocks, fetchImpl, env })
          : candidate === "fmp"
            ? await fetchFmpCatalystItems({ stocks, fetchImpl, env })
            : candidate === "finnhub"
              ? await fetchFinnhubCatalystItems({ stocks, fetchImpl, env })
              : candidate === "alpha-vantage"
                ? await fetchAlphaVantageCatalystItems({ stocks, fetchImpl, env })
                : candidate === "google-news"
                  ? await fetchGoogleNewsCatalystItems({ stocks, fetchImpl, env })
                  : await fetchYahooCatalystItems({ stocks, fetchImpl, env });
      if (items.length > 0) {
        collected.push(...items);
      } else {
        errors.push(`${candidate}: no stock news items returned`);
      }
    } catch (error) {
      errors.push(
        `${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const seen = new Set<string>();
  const deduped = collected.filter((item) => {
    const key = item.link || `${item.source}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length === 0 && fetchImpl === fetch && cacheMs > 0) {
    const stale = readStaleExternalNewsResult({
      env,
      key: cacheKey,
      now: Date.now(),
    });
    if (stale?.items.length) {
      return {
        items: stale.items,
        errors: [
          ...errors,
          `cache: using stale external news cache (${stale.items.length} items)`,
        ],
      };
    }
  }
  const translationResult = await translateExternalCatalystItems({
    items: deduped,
    env,
    translateImpl,
  });
  if (
    translationResult.attemptedCount > 0 &&
    translationResult.translatedCount === 0
  ) {
    errors.push(
      `translation: no Chinese translations produced for ${translationResult.attemptedCount} external news items`,
    );
  }
  const result = { items: translationResult.items, errors };
  const translationFailedCompletely =
    translationResult.attemptedCount > 0 && translationResult.translatedCount === 0;
  if (
    fetchImpl === fetch &&
    cacheMs > 0 &&
    result.items.length > 0 &&
    !translationFailedCompletely
  ) {
    const entry = {
      expiresAt: Date.now() + cacheMs,
      result,
    };
    externalCatalystCache.set(cacheKey, entry);
    writeExternalNewsFileCache(env, cacheKey, entry);
  }
  return result;
}

export function readLocalFeedCatalystItems(limit = 180): {
  items: StocksCatalystSourceItem[];
  errors: string[];
} {
  const errors: string[] = [];
  const items: StocksCatalystSourceItem[] = [];

  try {
    const telegram = getTelegramPipelineSnapshot(limit);
    for (const item of telegram.feed) {
      items.push({
        id: `telegram:${item.id}`,
        source: "Telegram",
        sourceRole: "supplemental",
        author: item.channelTitle || item.channelUsername,
        createdAt: item.createdAt,
        text: item.text,
        translation: item.translation?.text ?? null,
        link: item.messageUrl,
      });
    }
  } catch (error) {
    errors.push(
      `Telegram: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const x = getXPipelineSnapshot(limit);
    for (const item of x.feed) {
      items.push({
        id: `x:${item.id}`,
        source: "X",
        sourceRole: "supplemental",
        author: item.username ? `@${item.username}` : item.displayName,
        createdAt: item.createdAt,
        text: item.text,
        translation: item.translation?.text ?? null,
        link: item.tweetUrl,
      });
    }
  } catch (error) {
    errors.push(`X: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    items: items.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    ),
    errors,
  };
}

export async function getStocksCatalystSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  translateImpl = translateText,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  translateImpl?: TranslateLike;
}): Promise<StocksCatalystSnapshot> {
  const generatedAt = new Date().toISOString();
  const external = await fetchExternalCatalystItems({
    stocks,
    fetchImpl,
    env,
    translateImpl,
  });
  const subscription = await fetchPatreonSubscriptionItems({
    stocks,
    fetchImpl,
    env,
  });
  const supplemental = shouldIncludeLocalSignals(env)
    ? readLocalFeedCatalystItems()
    : { items: [], errors: [] };
  const items = [...subscription.items, ...external.items, ...supplemental.items];
  const errors = [
    ...subscription.errors,
    ...external.errors,
    ...supplemental.errors,
  ];
  const snapshot = buildStocksCatalystSnapshotFromItems({
    stocks,
    items,
    generatedAt,
  });
  if (snapshot.source === "live") {
    return { ...snapshot, errors };
  }
  return {
    ...buildMockStocksCatalystSnapshot(stocks),
    generatedAt,
    errors: errors.length > 0 ? errors : ["No stock catalyst items found"],
  };
}
