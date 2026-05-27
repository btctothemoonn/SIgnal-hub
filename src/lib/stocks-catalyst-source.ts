import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect as connectNet, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { AlphaResearchStock } from "./alpha-research-pool.ts";
import {
  buildMockStocksCatalystSnapshot,
  buildStocksCatalystSnapshotFromItems,
  parseAlphaVantageNewsPayload,
  parseFmpStockNewsPayload,
  parseFinnhubCompanyNewsPayload,
  parseGoogleNewsRss,
  parsePatreonPostApiResponse,
  parsePatreonPostsPage,
  parsePolygonNewsPayload,
  parseYahooFinanceRss,
  type StocksCatalystSnapshot,
  type StocksCatalystSourceItem,
} from "./stocks-catalyst-data.ts";
import {
  getProviderApiKeys,
  pickProviderApiKey,
} from "./provider-api-keys.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";
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

function waitForSocketConnect(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function waitForTlsConnect(socket: TLSSocket) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("secureConnect", onConnect);
    socket.once("error", onError);
  });
}

function readHttpHeader(socket: Socket | TLSSocket) {
  return new Promise<{ header: string; rest: Buffer }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      const buffer = Buffer.concat(chunks, totalLength);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      cleanup();
      resolve({
        header: buffer.subarray(0, headerEnd).toString("latin1"),
        rest: buffer.subarray(headerEnd + 4),
      });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("connection ended before HTTP headers"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
  });
}

function readSocketBody(socket: Socket | TLSSocket, initial: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = initial.length ? [initial] : [];
    let totalLength = initial.length;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, totalLength));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
  });
}

function decodeChunkedBody(body: Buffer) {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const sizeText = body
      .subarray(offset, lineEnd)
      .toString("ascii")
      .split(";", 1)[0]
      .trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    if (size === 0) break;
    const start = lineEnd + 2;
    const end = start + size;
    if (end > body.length) break;
    chunks.push(body.subarray(start, end));
    offset = end + 2;
  }
  return Buffer.concat(chunks);
}

function parseHttpResponse(header: string, body: Buffer) {
  const [statusLine, ...headerLines] = header.split("\r\n");
  const status = Number(statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
  const headers = new Headers();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const transferEncoding = headers.get("transfer-encoding")?.toLowerCase() ?? "";
  return {
    status,
    headers,
    body: transferEncoding.includes("chunked") ? decodeChunkedBody(body) : body,
  };
}

function formatHeaderLines(headers: Record<string, string>) {
  return Object.entries(headers)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value.replace(/\r?\n/g, " ")}`);
}

async function openHttpsProxyTunnel(target: URL, proxyUrl: string) {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== "http:") {
    throw new Error(`unsupported Patreon proxy protocol ${proxy.protocol}`);
  }
  const proxyPort = Number(proxy.port || 80);
  const targetPort = Number(target.port || 443);
  const socket = connectNet({ host: proxy.hostname, port: proxyPort });
  await waitForSocketConnect(socket);

  const auth =
    proxy.username || proxy.password
      ? [
          "Proxy-Authorization",
          `Basic ${Buffer.from(
            `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
          ).toString("base64")}`,
        ]
      : null;
  const connectHeaders: Record<string, string> = {
    Host: `${target.hostname}:${targetPort}`,
    "Proxy-Connection": "keep-alive",
  };
  if (auth) connectHeaders[auth[0]] = auth[1];
  socket.write(
    [
      `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
      ...formatHeaderLines(connectHeaders),
      "",
      "",
    ].join("\r\n"),
  );
  const tunnelResponse = await readHttpHeader(socket);
  const status = Number(tunnelResponse.header.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
  if (status < 200 || status >= 300) {
    socket.destroy();
    throw new Error(`Patreon proxy CONNECT HTTP ${status || "unknown"}`);
  }
  if (tunnelResponse.rest.length) socket.unshift(tunnelResponse.rest);
  const tlsSocket = connectTls({ socket, servername: target.hostname });
  await waitForTlsConnect(tlsSocket);
  return tlsSocket;
}

async function fetchPatreonThroughHttpProxy({
  url,
  headers,
  proxyUrl,
  redirects = 3,
}: {
  url: string;
  headers: Record<string, string>;
  proxyUrl: string;
  redirects?: number;
}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error(`unsupported Patreon URL protocol ${target.protocol}`);
  }
  const socket = await openHttpsProxyTunnel(target, proxyUrl);
  const path = `${target.pathname || "/"}${target.search}`;
  socket.write(
    [
      `GET ${path} HTTP/1.1`,
      ...formatHeaderLines({
        Host: target.host,
        Connection: "close",
        "Accept-Encoding": "identity",
        ...headers,
      }),
      "",
      "",
    ].join("\r\n"),
  );
  const responseHeader = await readHttpHeader(socket);
  const responseBody = await readSocketBody(socket, responseHeader.rest);
  socket.end();
  const response = parseHttpResponse(responseHeader.header, responseBody);
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location && redirects > 0) {
    return fetchPatreonThroughHttpProxy({
      url: new URL(location, target).toString(),
      headers,
      proxyUrl,
      redirects: redirects - 1,
    });
  }
  return new Response(response.body.toString("utf8"), {
    status: response.status || 500,
    headers: response.headers,
  });
}

async function fetchPatreonPage({
  url,
  headers,
  env,
  fetchImpl,
}: {
  url: string;
  headers: Record<string, string>;
  env: EnvLike;
  fetchImpl: FetchLike;
}) {
  const proxyUrl = patreonProxyUrl(env);
  if (fetchImpl === fetch && proxyUrl) {
    return fetchPatreonThroughHttpProxy({ url, headers, proxyUrl });
  }
  return fetchImpl(url, {
    cache: "no-store",
    headers,
  });
}

function patreonBodyText(item: StocksCatalystSourceItem) {
  const lines = item.text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0]?.toLowerCase() || "";
  if (lines[1] && lines[1].toLowerCase() === title) {
    lines.splice(1, 1);
  }
  if (lines[0]?.toLowerCase() === title) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

function shouldFetchPatreonPostDetail(item: StocksCatalystSourceItem) {
  return Boolean(item.link && patreonBodyText(item).length < 32);
}

function choosePatreonDetailItem(
  item: StocksCatalystSourceItem,
  detailItems: StocksCatalystSourceItem[],
) {
  return (
    detailItems.find((detail) => detail.link === item.link) ||
    detailItems.find((detail) => detail.id === item.id) ||
    detailItems[0] ||
    null
  );
}

function patreonPostId(item: StocksCatalystSourceItem) {
  return (
    item.link.match(/-(\d+)(?:[/?#]|$)/)?.[1] ||
    item.id.match(/^patreon:(\d+)$/)?.[1] ||
    null
  );
}

async function fetchPatreonApiDetail({
  item,
  headers,
  env,
  fetchImpl,
  creatorName,
}: {
  item: StocksCatalystSourceItem;
  headers: Record<string, string>;
  env: EnvLike;
  fetchImpl: FetchLike;
  creatorName: string;
}) {
  const id = patreonPostId(item);
  if (!id) return null;
  const response = await fetchPatreonPage({
    url: `https://www.patreon.com/api/posts/${id}?include=campaign,user,access_rules,attachments,images,media`,
    headers: {
      ...headers,
      accept: "application/json,text/plain,*/*",
      referer: item.link || headers.referer,
    },
    env,
    fetchImpl,
  });
  if (!response.ok) {
    throw new Error(`Patreon post API HTTP ${response.status}`);
  }
  return parsePatreonPostApiResponse(await response.text(), {
    sourceUrl: item.link,
    creatorName,
  });
}

async function enrichPatreonPostDetails({
  items,
  headers,
  env,
  fetchImpl,
  creatorName,
}: {
  items: StocksCatalystSourceItem[];
  headers: Record<string, string>;
  env: EnvLike;
  fetchImpl: FetchLike;
  creatorName: string;
}) {
  const errors: string[] = [];
  const enriched: StocksCatalystSourceItem[] = [];

  for (const item of items) {
    if (!shouldFetchPatreonPostDetail(item)) {
      enriched.push(item);
      continue;
    }

    try {
      const apiDetail = await fetchPatreonApiDetail({
        item,
        headers,
        env,
        fetchImpl,
        creatorName,
      });
      if (
        apiDetail &&
        patreonBodyText(apiDetail).length > patreonBodyText(item).length
      ) {
        enriched.push({
          ...item,
          text: apiDetail.text,
          translation: apiDetail.translation ?? item.translation,
          link: apiDetail.link || item.link,
        });
        continue;
      }

      const response = await fetchPatreonPage({
        url: item.link,
        headers,
        env,
        fetchImpl,
      });
      if (!response.ok) {
        throw new Error(`Patreon post HTTP ${response.status}`);
      }
      const detail = choosePatreonDetailItem(
        item,
        parsePatreonPostsPage(await response.text(), {
          sourceUrl: item.link,
          creatorName,
          maxPosts: 3,
        }),
      );
      if (detail && patreonBodyText(detail).length > patreonBodyText(item).length) {
        enriched.push({
          ...item,
          text: detail.text,
          translation: detail.translation ?? item.translation,
          link: detail.link || item.link,
        });
      } else {
        enriched.push(item);
      }
    } catch (error) {
      errors.push(`Patreon detail: ${errorMessage(error)}`);
      enriched.push(item);
    }
  }

  return { items: enriched, errors };
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

function fmpApiKeys(env: EnvLike) {
  return getProviderApiKeys(env, [
    "STOCKS_FMP_API_KEYS",
    "STOCKS_FMP_API_KEY",
    "FMP_API_KEYS",
    "FMP_API_KEY",
  ]);
}

function fmpApiKey(env: EnvLike) {
  return pickProviderApiKey(fmpApiKeys(env), 0);
}

function alphaVantageApiKey(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_API_KEY?.trim() ||
    env.ALPHA_VANTAGE_API_KEY?.trim() ||
    ""
  );
}

function finnhubApiKeys(env: EnvLike) {
  return getProviderApiKeys(env, [
    "STOCKS_FINNHUB_API_KEYS",
    "STOCKS_FINNHUB_API_KEY",
    "FINNHUB_API_KEYS",
    "FINNHUB_API_KEY",
  ]);
}

function finnhubApiKey(env: EnvLike) {
  return pickProviderApiKey(finnhubApiKeys(env), 0);
}

function shouldUseFmpNewsInAuto(env: EnvLike) {
  return env.STOCKS_FMP_NEWS_ENABLED?.trim().toLowerCase() !== "false";
}

function shouldUseAlphaVantageNewsInAuto(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_NEWS_ENABLED?.trim().toLowerCase() === "true"
  );
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

function patreonProxyUrl(env: EnvLike) {
  return (
    env.STOCKS_PATREON_PROXY_URL?.trim() ||
    env.PATREON_PROXY_URL?.trim() ||
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
    "translation-v5-fmp-articles",
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

type PatreonHistoryFile = {
  version: 1;
  updatedAt: string;
  items: StocksCatalystSourceItem[];
};

function configuredPatreonHistoryPath(env: EnvLike) {
  return env.STOCKS_PATREON_HISTORY_PATH?.trim() ?? "";
}

function patreonHistoryPath(env: EnvLike) {
  const configured = configuredPatreonHistoryPath(env);
  return configured
    ? resolve(configured)
    : getRuntimeDataPath(env, "stocks-patreon-history.json");
}

function patreonHistoryLimit(env: EnvLike) {
  return positiveInt(env.STOCKS_PATREON_HISTORY_LIMIT, 200, 1000);
}

function isPatreonSubscriptionItem(
  item: unknown,
): item is StocksCatalystSourceItem {
  return (
    Boolean(item) &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    (item as StocksCatalystSourceItem).source === "Patreon" &&
    (item as StocksCatalystSourceItem).sourceRole === "subscription" &&
    typeof (item as StocksCatalystSourceItem).id === "string" &&
    typeof (item as StocksCatalystSourceItem).createdAt === "string"
  );
}

function patreonHistoryItemKey(item: StocksCatalystSourceItem) {
  return item.link || item.id;
}

function sortPatreonHistoryItems(items: StocksCatalystSourceItem[]) {
  return [...items].sort((left, right) => {
    const dateDiff =
      (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0);
    if (dateDiff !== 0) return dateDiff;
    return patreonHistoryItemKey(left).localeCompare(
      patreonHistoryItemKey(right),
    );
  });
}

function readPatreonItemsFromLegacyCache(
  env: EnvLike,
): StocksCatalystSourceItem[] {
  if (configuredPatreonHistoryPath(env)) return [];
  if (env.STOCKS_PATREON_HISTORY_SEED_LEGACY_CACHE?.trim() !== "true") {
    return [];
  }
  const items: StocksCatalystSourceItem[] = [];
  for (const [key, entry] of Object.entries(readExternalNewsFileCache(env))) {
    if (!key.startsWith("patreon-v1|")) continue;
    for (const item of entry.result?.items ?? []) {
      if (isPatreonSubscriptionItem(item)) items.push(item);
    }
  }
  return sortPatreonHistoryItems(items);
}

function readPatreonHistoryItems(env: EnvLike): StocksCatalystSourceItem[] {
  try {
    const parsed = JSON.parse(
      readFileSync(patreonHistoryPath(env), "utf8"),
    ) as Partial<PatreonHistoryFile>;
    return sortPatreonHistoryItems(
      (Array.isArray(parsed.items) ? parsed.items : []).filter(
        isPatreonSubscriptionItem,
      ),
    );
  } catch {
    return readPatreonItemsFromLegacyCache(env);
  }
}

function writePatreonHistoryItems(
  env: EnvLike,
  items: StocksCatalystSourceItem[],
) {
  try {
    const historyPath = patreonHistoryPath(env);
    mkdirSync(dirname(historyPath), { recursive: true });
    writeFileSync(
      historyPath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        items,
      } satisfies PatreonHistoryFile),
      "utf8",
    );
  } catch {}
}

function mergePatreonHistoryItems({
  env,
  items,
}: {
  env: EnvLike;
  items: StocksCatalystSourceItem[];
}) {
  const merged = new Map<string, StocksCatalystSourceItem>();
  for (const item of readPatreonHistoryItems(env)) {
    merged.set(patreonHistoryItemKey(item), item);
  }
  for (const item of items) {
    if (isPatreonSubscriptionItem(item)) {
      merged.set(patreonHistoryItemKey(item), item);
    }
  }
  const next = sortPatreonHistoryItems([...merged.values()]).slice(
    0,
    patreonHistoryLimit(env),
  );
  writePatreonHistoryItems(env, next);
  return next;
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

function fmpArticlesUrl(apiKey: string, limit: number) {
  const params = new URLSearchParams({
    page: "0",
    limit: String(limit),
    apikey: apiKey,
  });
  return `https://financialmodelingprep.com/stable/fmp-articles?${params.toString()}`;
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
  const apiKeys = fmpApiKeys(env);
  if (apiKeys.length === 0) throw new Error("FMP API key is not configured");
  const stockTickers = new Set(stocks.map((stock) => stock.ticker));
  const filterStockItems = (items: StocksCatalystSourceItem[]) =>
    items.filter((item) =>
      (item.tickers ?? []).some((ticker) => stockTickers.has(ticker)),
    );
  const readLimit = positiveInt(env.STOCKS_NEWS_READ_LIMIT, 120, 300);
  const fetchArticleItems = async (apiKeyIndex = 0) => {
    const response = await fetchImpl(
      fmpArticlesUrl(pickProviderApiKey(apiKeys, apiKeyIndex), readLimit),
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`FMP articles HTTP ${response.status}`);
    }
    return filterStockItems(parseFmpStockNewsPayload(await response.json()));
  };
  const fetchLatestItems = async (apiKeyIndex = 0) => {
    let stockNewsError: unknown = null;
    try {
      const response = await fetchImpl(
        fmpNewsUrl(pickProviderApiKey(apiKeys, apiKeyIndex), readLimit),
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`FMP stock news HTTP ${response.status}`);
      }
      const items = filterStockItems(
        parseFmpStockNewsPayload(await response.json()),
      );
      if (items.length > 0) return items;
      stockNewsError = new Error("FMP stock news returned no matching items");
    } catch (error) {
      stockNewsError = error;
    }
    try {
      return await fetchArticleItems(apiKeyIndex + 1);
    } catch (articleError) {
      throw new Error(
        `${errorMessage(stockNewsError)}; articles fallback failed: ${errorMessage(
          articleError,
        )}`,
      );
    }
  };

  if (shouldFetchFmpByTicker(env)) {
    const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
    const providerStocks = selectProviderStocks(
      stocks,
      env.STOCKS_FMP_MAX_TICKERS,
      stocks.length,
    );
    const batchSize = positiveInt(env.STOCKS_FMP_BATCH_SIZE, 10, 25);
    const batches = chunks(providerStocks, batchSize);
    try {
      const tickerItems = await Promise.all(
        batches.map(async (batch, index) => {
          const response = await fetchImpl(
            fmpTickerNewsUrl(
              batch.map((stock) => stock.ticker),
              pickProviderApiKey(apiKeys, index),
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
      return filterStockItems(tickerItems.flat());
    } catch (error) {
      try {
        return await fetchLatestItems(batches.length);
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
  const apiKeys = finnhubApiKeys(env);
  if (apiKeys.length === 0) {
    throw new Error("Finnhub API key is not configured");
  }
  const limit = positiveInt(env.STOCKS_NEWS_ITEMS_PER_TICKER, 2, 5);
  const providerStocks = selectProviderStocks(
    stocks.filter((stock) => !stock.ticker.includes(".")),
    env.STOCKS_FINNHUB_NEWS_MAX_TICKERS,
    8,
  );
  if (providerStocks.length === 0) return [];
  const items = await Promise.all(
    providerStocks.map(async (stock, index) => {
      const response = await fetchImpl(
        finnhubCompanyNewsUrl({
          ticker: stock.ticker,
          apiKey: pickProviderApiKey(apiKeys, index),
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

  const cacheMs = patreonCacheMs(env);
  const cacheKey = patreonCacheKey({ stocks, env });
  const useHistory =
    fetchImpl === fetch || Boolean(configuredPatreonHistoryPath(env));
  if (fetchImpl === fetch && cacheMs > 0) {
    const cached = readCachedExternalNewsResult({
      env,
      key: cacheKey,
      now: Date.now(),
    });
    if (cached) return cached;
  }

  try {
    const headers = {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(cookie ? { cookie } : {}),
      referer: "https://www.patreon.com/home",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    };
    const response = await fetchPatreonPage({
      url,
      headers,
      env,
      fetchImpl,
    });
    if (!response.ok) {
      throw new Error(`Patreon posts HTTP ${response.status}`);
    }
    const creatorName = patreonCreatorName(env);
    const parsedItems = parsePatreonPostsPage(await response.text(), {
      sourceUrl: url,
      creatorName,
      maxPosts: positiveInt(env.STOCKS_PATREON_MAX_POSTS, 10, 25),
    });
    const detailResult = await enrichPatreonPostDetails({
      items: parsedItems,
      headers,
      env,
      fetchImpl,
      creatorName,
    });
    const latestItems = detailResult.items;
    if (latestItems.length === 0 && useHistory) {
      const historyItems = readPatreonHistoryItems(env);
      if (historyItems.length > 0) {
        return {
          items: historyItems,
          errors: [
            "Patreon: no subscription posts parsed",
            `history: using Patreon subscription history (${historyItems.length} items)`,
            ...detailResult.errors,
          ],
        };
      }
    }
    if (latestItems.length === 0 && fetchImpl === fetch && cacheMs > 0) {
      const stale = readStaleExternalNewsResult({
        env,
        key: cacheKey,
        now: Date.now(),
      });
      if (stale?.items.length) {
        return {
          items: stale.items,
          errors: [
            "Patreon: no subscription posts parsed",
            `cache: using stale Patreon subscription cache (${stale.items.length} items)`,
          ],
        };
      }
    }
    const items =
      latestItems.length > 0 && useHistory
        ? mergePatreonHistoryItems({ env, items: latestItems })
        : latestItems;
    const result = {
      items,
      errors:
        items.length > 0
          ? detailResult.errors
          : ["Patreon: no subscription posts parsed", ...detailResult.errors],
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
    const message = errorMessage(error);
    if (fetchImpl === fetch && cacheMs > 0) {
      const stale = readStaleExternalNewsResult({
        env,
        key: cacheKey,
        now: Date.now(),
      });
      if (stale?.items.length) {
        return {
          items: stale.items,
          errors: [
            `Patreon: ${message}`,
            `cache: using stale Patreon subscription cache (${stale.items.length} items)`,
          ],
        };
      }
    }
    if (
      useHistory &&
      !message.startsWith("unsupported Patreon proxy protocol")
    ) {
      const historyItems = readPatreonHistoryItems(env);
      if (historyItems.length > 0) {
        return {
          items: historyItems,
          errors: [
            `Patreon: ${message}`,
            `history: using Patreon subscription history (${historyItems.length} items)`,
          ],
        };
      }
    }
    return {
      items: [],
      errors: [`Patreon: ${message}`],
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
          ...(fmpApiKey(env) && shouldUseFmpNewsInAuto(env) ? ["fmp"] : []),
          ...(polygonApiKey(env) ? ["polygon"] : []),
          ...(finnhubApiKey(env) ? ["finnhub"] : []),
          "yahoo",
          "google-news",
          ...(alphaVantageApiKey(env) && shouldUseAlphaVantageNewsInAuto(env)
            ? ["alpha-vantage"]
            : []),
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
