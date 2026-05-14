import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as netConnect, Socket as NetSocket } from "node:net";
import { dirname, resolve } from "node:path";
import { connect as tlsConnect } from "node:tls";
import type { Socket } from "node:net";
import type { RequestOptions } from "node:https";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";

const BINANCE_API_CONFIG_PATH = resolve(
  process.cwd(),
  ".signal-hub",
  "binance-api.json",
);

export type BinanceSpotBalance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdtPrice?: number;
  usdtValue?: number;
};

export type BinanceFuturesPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  amount: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  leverage: number;
  marginType: string;
  notional: number;
};

export type BinanceHoldingSummary = {
  spotAssetCount: number;
  futuresPositionCount: number;
  futuresWalletBalance: number;
  futuresUnrealizedPnl: number;
  futuresMarginBalance: number;
  futuresAvailableBalance: number;
  futuresLongNotional: number;
  futuresShortNotional: number;
  futuresGrossNotional: number;
  futuresNetNotional: number;
};

export type BinanceFuturesEquityPoint = {
  at: string;
  walletBalance: number;
  unrealizedPnl: number;
  marginBalance: number;
  availableBalance: number;
};

export type BinanceHoldingWarning = {
  scope: "spot" | "futures";
  endpoint: string;
  status?: number;
  message: string;
};

export type BinanceHoldingSnapshot = {
  exchange: "binance";
  accountMode: "standard" | "portfolioMargin";
  updatedAt: string;
  spotBalances: BinanceSpotBalance[];
  futuresPositions: BinanceFuturesPosition[];
  summary: BinanceHoldingSummary;
  warnings: BinanceHoldingWarning[];
};

type RawSpotBalance = {
  asset?: unknown;
  free?: unknown;
  locked?: unknown;
};

type RawSpotTicker = {
  symbol?: unknown;
  price?: unknown;
};

type RawBinanceServerTime = {
  serverTime?: unknown;
};

type RawFuturesPosition = {
  symbol?: unknown;
  positionAmt?: unknown;
  entryPrice?: unknown;
  markPrice?: unknown;
  unRealizedProfit?: unknown;
  unrealizedProfit?: unknown;
  liquidationPrice?: unknown;
  leverage?: unknown;
  marginType?: unknown;
  notional?: unknown;
  positionSide?: unknown;
};

type RawFuturesAccount = {
  totalWalletBalance?: unknown;
  totalUnrealizedProfit?: unknown;
  totalMarginBalance?: unknown;
  availableBalance?: unknown;
  positions?: unknown;
};

type RawPortfolioMarginAccount = {
  accountEquity?: unknown;
  actualEquity?: unknown;
  totalAvailableBalance?: unknown;
  totalMarginOpenLoss?: unknown;
};

type SignedQueryParams = Record<string, string | number | boolean | null | undefined>;

type BinanceConfig = {
  apiKey: string;
  apiSecret: string;
  spotBaseUrl: string;
  futuresBaseUrl: string;
  portfolioBaseUrl: string;
  recvWindow: number;
  proxyUrl: string | null;
};

export type BinanceStoredCredentials = {
  apiKey: string;
  apiSecret: string;
};

type SignedRequestOptions = BinanceConfig & {
  path: string;
  market: "spot" | "futures" | "portfolio";
  fetcher?: typeof fetch;
  now?: () => number;
};

type PublicRequestOptions = Pick<
  BinanceConfig,
  "spotBaseUrl" | "futuresBaseUrl" | "portfolioBaseUrl" | "proxyUrl"
> & {
  path: string;
  market: "spot" | "futures" | "portfolio";
  fetcher?: typeof fetch;
};

const MIN_SPOT_USDT_VALUE = 500;
const USDT_PEGGED_ASSETS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "BUSD",
  "DAI",
]);

export class BinanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinanceConfigError";
  }
}

export class BinanceUpstreamError extends Error {
  status: number;
  endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "BinanceUpstreamError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class BinanceNetworkError extends Error {
  endpoint: string;

  constructor(message: string, endpoint: string) {
    super(message);
    this.name = "BinanceNetworkError";
    this.endpoint = endpoint;
  }
}

function toNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeProxyUrl(raw: unknown): string | null {
  const value = toText(raw);
  if (!value) return null;
  try {
    const proxyUrl = new URL(value);
    if (proxyUrl.protocol !== "http:") return null;
    return proxyUrl.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sanitizeCredentials(raw: unknown): BinanceStoredCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { apiKey?: unknown; apiSecret?: unknown };
  const apiKey = toText(value.apiKey);
  const apiSecret = toText(value.apiSecret);
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function createBinanceSignature(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

export function buildSignedBinanceQuery({
  params,
  secret,
}: {
  params: SignedQueryParams;
  secret: string;
}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.append(key, String(value));
  }
  const unsigned = query.toString();
  query.append("signature", createBinanceSignature(unsigned, secret));
  return query.toString();
}

export function normalizeSpotBalances(
  balances: RawSpotBalance[] | unknown,
): BinanceSpotBalance[] {
  if (!Array.isArray(balances)) return [];

  return balances
    .map((balance) => {
      const asset = toText(balance.asset).toUpperCase();
      const free = toNumber(balance.free);
      const locked = toNumber(balance.locked);
      return {
        asset,
        free,
        locked,
        total: free + locked,
      };
    })
    .filter((balance) => balance.asset && balance.total !== 0)
    .sort((left, right) => {
      if (left.asset === "USDT") return -1;
      if (right.asset === "USDT") return 1;
      return right.total - left.total || left.asset.localeCompare(right.asset);
    });
}

function buildSpotUsdtPriceMap(tickers: RawSpotTicker[] | unknown): Map<string, number> {
  const prices = new Map<string, number>();
  for (const asset of USDT_PEGGED_ASSETS) prices.set(asset, 1);

  if (!Array.isArray(tickers)) return prices;

  for (const ticker of tickers) {
    const symbol = toText(ticker.symbol).toUpperCase();
    if (!symbol.endsWith("USDT")) continue;
    const asset = symbol.slice(0, -4);
    const price = toNumber(ticker.price);
    if (!asset || price <= 0) continue;
    prices.set(asset, price);
  }

  return prices;
}

export function filterSpotBalancesByUsdtValue({
  balances,
  tickers,
  minUsdtValue = MIN_SPOT_USDT_VALUE,
}: {
  balances: BinanceSpotBalance[];
  tickers: RawSpotTicker[] | unknown;
  minUsdtValue?: number;
}): BinanceSpotBalance[] {
  const prices = buildSpotUsdtPriceMap(tickers);

  return balances
    .map((balance) => {
      const usdtPrice = prices.get(balance.asset);
      const usdtValue =
        typeof usdtPrice === "number" ? balance.total * usdtPrice : 0;
      return {
        ...balance,
        usdtPrice,
        usdtValue,
      };
    })
    .filter((balance) => (balance.usdtValue ?? 0) >= minUsdtValue)
    .sort(
      (left, right) =>
        (right.usdtValue ?? 0) - (left.usdtValue ?? 0) ||
        left.asset.localeCompare(right.asset),
    );
}

export function normalizeFuturesPositions(
  positions: RawFuturesPosition[] | unknown,
): BinanceFuturesPosition[] {
  if (!Array.isArray(positions)) return [];

  return positions
    .map((position) => {
      const amount = toNumber(position.positionAmt);
      const markPrice = toNumber(position.markPrice);
      const rawNotional = toNumber(position.notional);
      const notional = rawNotional || amount * markPrice;
      return {
        symbol: toText(position.symbol).toUpperCase(),
        side: amount >= 0 ? ("LONG" as const) : ("SHORT" as const),
        amount,
        entryPrice: toNumber(position.entryPrice),
        markPrice,
        unrealizedPnl:
          toNumber(position.unRealizedProfit) ||
          toNumber(position.unrealizedProfit),
        liquidationPrice: toNumber(position.liquidationPrice),
        leverage: toNumber(position.leverage),
        marginType: toText(position.marginType) || "cross",
        notional,
      };
    })
    .filter((position) => position.symbol && position.amount !== 0)
    .sort(
      (left, right) =>
        Math.abs(right.notional) - Math.abs(left.notional) ||
        left.symbol.localeCompare(right.symbol),
    );
}

export function buildHoldingSummary({
  spotBalances,
  futuresPositions,
  futuresAccount,
}: {
  spotBalances: BinanceSpotBalance[];
  futuresPositions: BinanceFuturesPosition[];
  futuresAccount: RawFuturesAccount;
}): BinanceHoldingSummary {
  let futuresLongNotional = 0;
  let futuresShortNotional = 0;
  let futuresNetNotional = 0;

  for (const position of futuresPositions) {
    futuresNetNotional += position.notional;
    if (position.notional >= 0) {
      futuresLongNotional += Math.abs(position.notional);
    } else {
      futuresShortNotional += Math.abs(position.notional);
    }
  }

  return {
    spotAssetCount: spotBalances.length,
    futuresPositionCount: futuresPositions.length,
    futuresWalletBalance: toNumber(futuresAccount.totalWalletBalance),
    futuresUnrealizedPnl: toNumber(futuresAccount.totalUnrealizedProfit),
    futuresMarginBalance: toNumber(futuresAccount.totalMarginBalance),
    futuresAvailableBalance: toNumber(futuresAccount.availableBalance),
    futuresLongNotional,
    futuresShortNotional,
    futuresGrossNotional: futuresLongNotional + futuresShortNotional,
    futuresNetNotional,
  };
}

export function buildPortfolioMarginSummary({
  spotBalances,
  futuresPositions,
  portfolioAccount,
}: {
  spotBalances: BinanceSpotBalance[];
  futuresPositions: BinanceFuturesPosition[];
  portfolioAccount: RawPortfolioMarginAccount;
}): BinanceHoldingSummary {
  const positionPnl = futuresPositions.reduce(
    (total, position) => total + position.unrealizedPnl,
    0,
  );
  const accountEquity =
    toNumber(portfolioAccount.accountEquity) ||
    toNumber(portfolioAccount.actualEquity);

  return {
    ...buildHoldingSummary({
      spotBalances,
      futuresPositions,
      futuresAccount: {},
    }),
    futuresWalletBalance: accountEquity,
    futuresUnrealizedPnl:
      positionPnl || toNumber(portfolioAccount.totalMarginOpenLoss),
    futuresMarginBalance: accountEquity,
    futuresAvailableBalance: toNumber(portfolioAccount.totalAvailableBalance),
  };
}

export function resolveBinanceConfig({
  env = process.env,
  storedCredentials = null,
}: {
  env?: NodeJS.ProcessEnv;
  storedCredentials?: BinanceStoredCredentials | null;
} = {}): BinanceConfig {
  const apiKey = env.BINANCE_API_KEY?.trim() ?? "";
  const apiSecret = env.BINANCE_API_SECRET?.trim() ?? "";
  const stored = sanitizeCredentials(storedCredentials);
  const resolvedApiKey = apiKey || stored?.apiKey || "";
  const resolvedApiSecret = apiSecret || stored?.apiSecret || "";

  if (!resolvedApiKey || !resolvedApiSecret) {
    throw new BinanceConfigError(
      "Missing BINANCE_API_KEY or BINANCE_API_SECRET.",
    );
  }

  return {
    apiKey: resolvedApiKey,
    apiSecret: resolvedApiSecret,
    spotBaseUrl: env.BINANCE_SPOT_BASE_URL?.trim() || "https://api.binance.com",
    futuresBaseUrl:
      env.BINANCE_FUTURES_BASE_URL?.trim() || "https://fapi.binance.com",
    portfolioBaseUrl:
      env.BINANCE_PORTFOLIO_BASE_URL?.trim() || "https://papi.binance.com",
    recvWindow: toNumber(env.BINANCE_RECV_WINDOW) || 5000,
    proxyUrl: normalizeProxyUrl(env.BINANCE_PROXY_URL),
  };
}

export async function readStoredBinanceCredentials(): Promise<BinanceStoredCredentials | null> {
  try {
    const content = await readFile(BINANCE_API_CONFIG_PATH, "utf-8");
    return sanitizeCredentials(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function saveStoredBinanceCredentials(
  credentials: BinanceStoredCredentials,
): Promise<void> {
  const cleaned = sanitizeCredentials(credentials);
  if (!cleaned) {
    throw new BinanceConfigError("Binance API Key and Secret are required.");
  }

  await mkdir(dirname(BINANCE_API_CONFIG_PATH), { recursive: true });
  const tmpPath = `${BINANCE_API_CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(cleaned, null, 2), "utf-8");
  await rename(tmpPath, BINANCE_API_CONFIG_PATH);
}

export async function getBinanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BinanceConfig> {
  return resolveBinanceConfig({
    env,
    storedCredentials: await readStoredBinanceCredentials(),
  });
}

async function readUpstreamMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { msg?: unknown; message?: unknown };
    return toText(payload.msg) || toText(payload.message) || response.statusText;
  } catch {
    return response.statusText;
  }
}

function connectSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, host);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readConnectResponse(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!buffer.includes(Buffer.from("\r\n\r\n"))) return;
      socket.off("data", onData);
      socket.off("error", reject);
      resolve(buffer);
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function createProxyTlsSocket({
  targetHost,
  targetPort,
  proxyUrl,
}: {
  targetHost: string;
  targetPort: number;
  proxyUrl: string;
}): Promise<TLSSocket> {
  const proxy = new URL(proxyUrl);
  const proxyPort = Number(proxy.port || 80);
  const socket = await connectSocket(proxy.hostname, proxyPort);
  const auth =
    proxy.username || proxy.password
      ? `Proxy-Authorization: Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(
            proxy.password,
          )}`,
        ).toString("base64")}\r\n`
      : "";
  socket.write(
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}Connection: keep-alive\r\n\r\n`,
  );
  const responseHead = await readConnectResponse(socket);
  const firstLine = responseHead.toString("utf-8").split("\r\n")[0] ?? "";
  if (!/^HTTP\/1\.[01] 200\b/.test(firstLine)) {
    socket.destroy();
    throw new Error(firstLine || "Proxy CONNECT failed");
  }

  return await new Promise((resolve, reject) => {
    const secureSocket = tlsConnect({
      socket,
      servername: targetHost,
    });
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

class BinanceProxyAgent extends HttpsAgent {
  private readonly proxyUrl: string;
  private readonly target: URL;

  constructor(proxyUrl: string, target: URL) {
    super({ keepAlive: false });
    this.proxyUrl = proxyUrl;
    this.target = target;
  }

  override createConnection(
    options: RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const targetHost = String(
      options.servername || options.host || this.target.hostname,
    );
    const targetPort = Number(this.target.port || 443);
    createProxyTlsSocket({
      targetHost,
      targetPort,
      proxyUrl: this.proxyUrl,
    }).then(
      (socket) => callback?.(null, socket),
      (error: Error) => callback?.(error, new NetSocket()),
    );
    return undefined;
  }
}

async function requestViaHttpProxy({
  url,
  headers,
  proxyUrl,
}: {
  url: string;
  headers: Record<string, string>;
  proxyUrl: string;
}): Promise<Response> {
  const target = new URL(url);
  const agent = new BinanceProxyAgent(proxyUrl, target);

  return await new Promise((resolve, reject) => {
    const request = httpsRequest(
      target,
      {
        agent,
        headers,
        method: "GET",
        timeout: 20000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
            }),
          );
        });
      },
    );
    request.once("timeout", () => {
      request.destroy(new Error("Binance proxy request timed out"));
    });
    request.once("error", reject);
    request.end();
  });
}

async function requestBinanceResponse({
  url,
  headers,
  proxyUrl,
  fetcher,
}: {
  url: string;
  headers: Record<string, string>;
  proxyUrl: string | null;
  fetcher: typeof fetch;
}): Promise<Response> {
  if (proxyUrl && fetcher === fetch) {
    return requestViaHttpProxy({ url, headers, proxyUrl });
  }

  return fetcher(url, {
    cache: "no-store",
    headers,
  });
}

async function requestPublicJson<T>({
  path,
  market,
  fetcher = fetch,
  ...config
}: PublicRequestOptions): Promise<T> {
  const baseUrl =
    market === "spot"
      ? config.spotBaseUrl
      : market === "portfolio"
        ? config.portfolioBaseUrl
        : config.futuresBaseUrl;
  const endpoint = `${path}`;
  let response: Response;

  try {
    response = await requestBinanceResponse({
      url: `${trimBaseUrl(baseUrl)}${path}`,
      headers: {},
      proxyUrl: config.proxyUrl,
      fetcher,
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";
    const suffix = causeCode ? ` (${causeCode})` : "";
    throw new BinanceNetworkError(
      `无法连接 Binance ${market === "spot" ? "现货" : "合约"}公共行情接口${suffix}。`,
      endpoint,
    );
  }

  if (!response.ok) {
    const message = await readUpstreamMessage(response);
    throw new BinanceUpstreamError(message, response.status, endpoint);
  }

  return (await response.json()) as T;
}

async function createBinanceSyncedNow({
  config,
  fetcher,
  now,
}: {
  config: BinanceConfig;
  fetcher: typeof fetch;
  now: () => number;
}): Promise<() => number> {
  try {
    const localTime = now();
    const response = await requestPublicJson<RawBinanceServerTime>({
      ...config,
      path: "/api/v3/time",
      market: "spot",
      fetcher,
    });
    const serverTime = toNumber(response.serverTime);
    if (serverTime <= 0) return now;
    const offset = serverTime - localTime;
    return () => now() + offset;
  } catch {
    return now;
  }
}

async function requestSignedJson<T>({
  path,
  market,
  fetcher = fetch,
  now = Date.now,
  ...config
}: SignedRequestOptions): Promise<T> {
  const query = buildSignedBinanceQuery({
    params: {
      recvWindow: config.recvWindow,
      timestamp: now(),
    },
    secret: config.apiSecret,
  });
  const baseUrl =
    market === "spot"
      ? config.spotBaseUrl
      : market === "portfolio"
        ? config.portfolioBaseUrl
        : config.futuresBaseUrl;
  const endpoint = `${path}`;
  let response: Response;
  try {
    response = await requestBinanceResponse({
      url: `${trimBaseUrl(baseUrl)}${path}?${query}`,
      headers: {
        "X-MBX-APIKEY": config.apiKey,
      },
      proxyUrl: config.proxyUrl,
      fetcher,
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";
    const suffix = causeCode ? ` (${causeCode})` : "";
    throw new BinanceNetworkError(
      `无法连接 Binance ${market === "spot" ? "现货" : "合约"}接口${suffix}。请确认本机服务端可以访问 ${trimBaseUrl(baseUrl)}，必要时为 Node/Next 服务配置代理或 VPN。`,
      endpoint,
    );
  }

  if (!response.ok) {
    const message = await readUpstreamMessage(response);
    throw new BinanceUpstreamError(message, response.status, endpoint);
  }

  return (await response.json()) as T;
}

function isRejectedResult<T>(
  result: PromiseSettledResult<T>,
): result is PromiseRejectedResult {
  return result.status === "rejected";
}

function isFulfilledResult<T>(
  result: PromiseSettledResult<T>,
): result is PromiseFulfilledResult<T> {
  return result.status === "fulfilled";
}

function isFuturesPermissionError(error: BinanceUpstreamError): boolean {
  return (
    error.status === 401 &&
    /invalid api-key|ip|permissions/i.test(error.message)
  );
}

function buildWarningFromError({
  scope,
  fallbackEndpoint,
  error,
}: {
  scope: BinanceHoldingWarning["scope"];
  fallbackEndpoint: string;
  error: unknown;
}): BinanceHoldingWarning {
  if (error instanceof BinanceUpstreamError) {
    const isPermissionError =
      scope === "futures" && isFuturesPermissionError(error);
    return {
      scope,
      endpoint: error.endpoint || fallbackEndpoint,
      status: error.status,
      message: isPermissionError
        ? "这组 Binance API 尚未开启合约读取权限。请在 Binance API 管理中开启合约或统一账户相关权限后再查看合约持仓。"
        : `Binance ${scope === "spot" ? "现货" : "合约"}请求失败：${error.message}`,
    };
  }

  if (error instanceof BinanceNetworkError) {
    return {
      scope,
      endpoint: error.endpoint || fallbackEndpoint,
      message: error.message,
    };
  }

  return {
    scope,
    endpoint: fallbackEndpoint,
    message:
      error instanceof Error
        ? error.message
        : `Binance ${scope === "spot" ? "现货" : "合约"}请求失败。`,
  };
}

function addMarketWarning(
  warnings: BinanceHoldingWarning[],
  warning: BinanceHoldingWarning,
) {
  const existing = warnings.find(
    (item) => item.scope === warning.scope && item.status === warning.status,
  );
  if (!existing) warnings.push(warning);
}

let preferredFuturesAccountMode: BinanceHoldingSnapshot["accountMode"] | null =
  null;

export function resetBinanceHoldingRuntimeHints() {
  preferredFuturesAccountMode = null;
}

async function requestStandardFuturesResults({
  config,
  fetcher,
  signedNow,
}: {
  config: BinanceConfig;
  fetcher: typeof fetch;
  signedNow: () => number;
}): Promise<{
  account: PromiseSettledResult<RawFuturesAccount>;
  risk: PromiseSettledResult<RawFuturesPosition[]>;
}> {
  const [account, risk] = await Promise.allSettled([
    requestSignedJson<RawFuturesAccount>({
      ...config,
      path: "/fapi/v3/account",
      market: "futures",
      fetcher,
      now: signedNow,
    }),
    requestSignedJson<RawFuturesPosition[]>({
      ...config,
      path: "/fapi/v3/positionRisk",
      market: "futures",
      fetcher,
      now: signedNow,
    }),
  ]);
  return { account, risk };
}

async function requestPortfolioFuturesResults({
  config,
  fetcher,
  signedNow,
}: {
  config: BinanceConfig;
  fetcher: typeof fetch;
  signedNow: () => number;
}): Promise<{
  account: PromiseSettledResult<RawPortfolioMarginAccount>;
  risk: PromiseSettledResult<RawFuturesPosition[]>;
}> {
  const [account, risk] = await Promise.allSettled([
    requestSignedJson<RawPortfolioMarginAccount>({
      ...config,
      path: "/papi/v1/account",
      market: "portfolio",
      fetcher,
      now: signedNow,
    }),
    requestSignedJson<RawFuturesPosition[]>({
      ...config,
      path: "/papi/v1/um/positionRisk",
      market: "portfolio",
      fetcher,
      now: signedNow,
    }),
  ]);
  return { account, risk };
}

export async function getBinanceHoldingSnapshot({
  env = process.env,
  fetcher = fetch,
  now = Date.now,
}: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  now?: () => number;
} = {}): Promise<BinanceHoldingSnapshot> {
  const config = await getBinanceConfig(env);
  const signedNow = await createBinanceSyncedNow({ config, fetcher, now });
  const [spotAccountResult, spotTickerResult] = await Promise.allSettled([
    requestSignedJson<{ balances?: unknown }>({
      ...config,
      path: "/api/v3/account",
      market: "spot",
      fetcher,
      now: signedNow,
    }),
    requestPublicJson<RawSpotTicker[]>({
      ...config,
      path: "/api/v3/ticker/price",
      market: "spot",
      fetcher,
    }),
  ]);
  const standardFuturesResults =
    preferredFuturesAccountMode === "portfolioMargin"
      ? null
      : await requestStandardFuturesResults({ config, fetcher, signedNow });
  const skippedStandardFuturesResult: PromiseRejectedResult = {
    status: "rejected",
    reason: new Error("Standard futures request skipped"),
  };
  const futuresAccountResult =
    standardFuturesResults?.account ?? skippedStandardFuturesResult;
  const futuresRiskResult =
    standardFuturesResults?.risk ?? skippedStandardFuturesResult;

  const warnings: BinanceHoldingWarning[] = [];

  if (isRejectedResult(spotAccountResult)) {
    addMarketWarning(
      warnings,
      buildWarningFromError({
        scope: "spot",
        fallbackEndpoint: "/api/v3/account",
        error: spotAccountResult.reason,
      }),
    );
  }

  if (isRejectedResult(spotTickerResult)) {
    addMarketWarning(
      warnings,
      buildWarningFromError({
        scope: "spot",
        fallbackEndpoint: "/api/v3/ticker/price",
        error: spotTickerResult.reason,
      }),
    );
  }

  const spotAccount =
    spotAccountResult.status === "fulfilled" ? spotAccountResult.value : {};
  const spotBalances = filterSpotBalancesByUsdtValue({
    balances: normalizeSpotBalances(spotAccount.balances),
    tickers:
      spotTickerResult.status === "fulfilled" ? spotTickerResult.value : [],
  });
  let accountMode: BinanceHoldingSnapshot["accountMode"] = "standard";
  let futuresPositions: BinanceFuturesPosition[] = [];
  let summary: BinanceHoldingSummary;

  if (
    isFulfilledResult(futuresAccountResult) &&
    isFulfilledResult(futuresRiskResult)
  ) {
    preferredFuturesAccountMode = "standard";
    const futuresAccount = futuresAccountResult.value;
    const futuresRiskPositions = futuresRiskResult.value;
    futuresPositions = normalizeFuturesPositions(
      Array.isArray(futuresRiskPositions)
        ? futuresRiskPositions
        : futuresAccount.positions,
    );
    summary = buildHoldingSummary({
      spotBalances,
      futuresPositions,
      futuresAccount,
    });
  } else {
    const portfolioResults = await requestPortfolioFuturesResults({
      config,
      fetcher,
      signedNow,
    });
    if (
      isFulfilledResult(portfolioResults.account) &&
      isFulfilledResult(portfolioResults.risk)
    ) {
      preferredFuturesAccountMode = "portfolioMargin";
      accountMode = "portfolioMargin";
      futuresPositions = normalizeFuturesPositions(portfolioResults.risk.value);
      summary = buildPortfolioMarginSummary({
        spotBalances,
        futuresPositions,
        portfolioAccount: portfolioResults.account.value,
      });
    } else {
      if (
        isRejectedResult(spotAccountResult) &&
        (!standardFuturesResults ||
          (isRejectedResult(standardFuturesResults.account) &&
            isRejectedResult(standardFuturesResults.risk))) &&
        isRejectedResult(portfolioResults.account) &&
        isRejectedResult(portfolioResults.risk)
      ) {
        throw spotAccountResult.reason;
      }

      if (
        standardFuturesResults &&
        isRejectedResult(standardFuturesResults.account)
      ) {
        addMarketWarning(
          warnings,
          buildWarningFromError({
            scope: "futures",
            fallbackEndpoint: "/fapi/v3/account",
            error: standardFuturesResults.account.reason,
          }),
        );
      }

      if (
        standardFuturesResults &&
        isRejectedResult(standardFuturesResults.risk)
      ) {
        addMarketWarning(
          warnings,
          buildWarningFromError({
            scope: "futures",
            fallbackEndpoint: "/fapi/v3/positionRisk",
            error: standardFuturesResults.risk.reason,
          }),
        );
      }

      if (isRejectedResult(portfolioResults.account)) {
        addMarketWarning(
          warnings,
          buildWarningFromError({
            scope: "futures",
            fallbackEndpoint: "/papi/v1/account",
            error: portfolioResults.account.reason,
          }),
        );
      }

      if (isRejectedResult(portfolioResults.risk)) {
        addMarketWarning(
          warnings,
          buildWarningFromError({
            scope: "futures",
            fallbackEndpoint: "/papi/v1/um/positionRisk",
            error: portfolioResults.risk.reason,
          }),
        );
      }

      summary = buildHoldingSummary({
        spotBalances,
        futuresPositions,
        futuresAccount: {},
      });
    }
  }

  return {
    exchange: "binance",
    accountMode,
    updatedAt: new Date(now()).toISOString(),
    spotBalances,
    futuresPositions,
    summary,
    warnings,
  };
}
