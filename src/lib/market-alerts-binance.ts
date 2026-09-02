import { createHash } from "node:crypto";
import { getMarketAlertsConfig } from "./market-alerts-config.ts";
import type { MarketAlertsConfig } from "./market-alerts-config.ts";
import {
  evaluateRestVolatilitySignal,
  evaluateWsVolatilitySignal,
  isStableOrFiatBase,
  isTradFiContract,
  isVolatilityRecoveryCalm,
  scoreShortSqueeze,
  squeezeRecoveryDecision,
} from "./market-alerts-core.ts";
import type { VolatilitySignal } from "./market-alerts-core.ts";
import { isUncertainMarketAlertDeliveryError } from "./market-alerts-delivery.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";

type Store = ReturnType<typeof openMarketAlertsStore>;
type JsonRecord = Record<string, unknown>;
type KlineRow = unknown[];

export type MarketValuation = {
  symbol: string;
  marketCapUsd: number | null;
  fdvUsd: number | null;
};

type MarketValuationRequest = {
  symbol: string;
  price: number;
};

export interface BinanceMarketClient {
  getExchangeInfo(): Promise<{ symbols?: JsonRecord[] }>;
  getTickers24h(): Promise<JsonRecord[]>;
  getKlines(symbol: string, interval: "1m" | "5m", limit: number): Promise<KlineRow[]>;
  getFullyDilutedValuation?(symbol: string, price: number): Promise<number | null>;
  getMarketValuations?(markets: MarketValuationRequest[]): Promise<MarketValuation[]>;
  getPremiumIndex?(): Promise<JsonRecord[]>;
  getOpenInterestHistory?(symbol: string): Promise<JsonRecord[]>;
  getGlobalLongShortRatio?(symbol: string): Promise<number | null>;
  getTopTraderPositionRatio?(symbol: string): Promise<number | null>;
  getTakerBuySellRatio?(symbol: string): Promise<number | null>;
}

type DeliverAlert = (
  event: ReturnType<Store["insertMarketAlertEvent"]>,
) => Promise<{ status?: string; messageId?: number | null } | void>;

export type MarketAlertChartWriter = (input: {
  symbol: string;
  interval: "5m";
  klines: KlineRow[];
  generatedAt: string;
  sourceKey: string;
}) => Promise<{
  symbol: string;
  interval: string;
  updatedAt: string;
  sourceKey: string;
  removeSource?: (sourceKey: string) => Promise<void>;
  pruneOlder?: (sourceKey: string) => Promise<void>;
}>;

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown) {
  return String((error as { message?: unknown })?.message ?? error ?? "unknown error")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .slice(0, 800);
}

function reportDeliveryError(callback: ((error: unknown) => void) | undefined, error: unknown) {
  if (!callback) return;
  try {
    callback(error);
  } catch (reportError) {
    console.error(`[MARKET-ALERT-ERROR-REPORT] ${safeError(reportError)}`);
  }
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  operation: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), Math.max(1, values.length)) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function mergeConfig(overrides: Partial<MarketAlertsConfig> = {}): MarketAlertsConfig {
  return { ...getMarketAlertsConfig(), ...overrides };
}

export function createBinanceFuturesClient(
  configOverrides: Partial<MarketAlertsConfig> = {},
  runtime: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): BinanceMarketClient {
  const config = mergeConfig(configOverrides);
  const fetchImpl = runtime.fetch ?? fetch;
  const sleepImpl = runtime.sleep ?? sleep;
  const now = runtime.now ?? Date.now;
  let requestGate = Promise.resolve();
  let nextRequestAt = 0;
  let blockedUntil = 0;

  async function reserveRequestSlot() {
    let release = () => {};
    const previous = requestGate;
    requestGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(0, nextRequestAt - now(), blockedUntil - now());
      if (waitMs > 0) await sleepImpl(waitMs);
      nextRequestAt = now() + config.requestSpacingMs;
    } finally {
      release();
    }
  }

  function rateLimitDelay(response: Response, attempt: number) {
    const value = response.headers.get("retry-after")?.trim() ?? "";
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now());
    return config.requestRetryBaseMs * 2 ** attempt;
  }

  async function requestJson(path: string, params?: Record<string, string | number>) {
    const url = new URL(path, config.restBaseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await reserveRequestSlot();
        const response = await fetchImpl(url, {
          headers: { "user-agent": "SignalHubMarketAlerts/1.0" },
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status} ${response.statusText}`) as Error & {
            rateLimited?: boolean;
          };
          if (response.status === 429 || response.status === 418) {
            error.rateLimited = true;
            blockedUntil = Math.max(
              blockedUntil,
              now() + rateLimitDelay(response, attempt),
            );
          }
          throw error;
        }
        const body = await response.json();
        if (
          body &&
          typeof body === "object" &&
          "code" in body &&
          numberValue((body as JsonRecord).code) < 0
        ) {
          throw new Error(`Binance API ${(body as JsonRecord).code}: ${(body as JsonRecord).msg}`);
        }
        return body;
      } catch (error) {
        lastError = error;
        if (attempt < 2 && !(error as { rateLimited?: boolean })?.rateLimited) {
          await sleepImpl(config.requestRetryBaseMs * 2 ** attempt);
        }
      }
    }
    throw new Error(`Binance request failed: ${safeError(lastError)}`);
  }

  async function getMarketValuations(
    markets: MarketValuationRequest[],
  ): Promise<MarketValuation[]> {
    const requested = markets
      .slice(0, 50)
      .map((market) => ({
        ...market,
        base: market.symbol.replace(/USDT$/i, "").toLowerCase(),
      }));
    if (!requested.length) return [];
    try {
      const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("symbols", [...new Set(requested.map((item) => item.base))].join(","));
      url.searchParams.set("per_page", "50");
      url.searchParams.set("sparkline", "false");
      const response = await fetch(url, {
        headers: { "user-agent": "SignalHubMarketAlerts/1.0" },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
      const rows = (await response.json()) as JsonRecord[];
      return requested.map((market) => {
        const coin = Array.isArray(rows)
          ? rows.find((row) => stringValue(row.symbol).toLowerCase() === market.base)
          : undefined;
        const marketCapUsd = nullableNumber(coin?.market_cap);
        const directFdv = nullableNumber(coin?.fully_diluted_valuation);
        const supply = nullableNumber(coin?.total_supply) ?? nullableNumber(coin?.max_supply);
        const fallbackFdv = supply && supply > 0 ? supply * market.price : null;
        return {
          symbol: market.symbol,
          marketCapUsd: marketCapUsd && marketCapUsd > 0 ? marketCapUsd : null,
          fdvUsd: directFdv && directFdv > 0 ? directFdv : fallbackFdv,
        };
      });
    } catch {
      return requested.map((market) => ({
        symbol: market.symbol,
        marketCapUsd: null,
        fdvUsd: null,
      }));
    }
  }

  return {
    getExchangeInfo: () => requestJson("/fapi/v1/exchangeInfo") as Promise<{ symbols?: JsonRecord[] }>,
    getTickers24h: () => requestJson("/fapi/v1/ticker/24hr") as Promise<JsonRecord[]>,
    getKlines: (symbol, interval, limit) =>
      requestJson("/fapi/v1/klines", { symbol, interval, limit }) as Promise<KlineRow[]>,
    getMarketValuations,
    getPremiumIndex: () => requestJson("/fapi/v1/premiumIndex") as Promise<JsonRecord[]>,
    getOpenInterestHistory: (symbol) =>
      requestJson("/futures/data/openInterestHist", {
        symbol,
        period: "5m",
        limit: 5,
      }) as Promise<JsonRecord[]>,
    async getGlobalLongShortRatio(symbol) {
      const rows = (await requestJson("/futures/data/globalLongShortAccountRatio", {
        symbol,
        period: "5m",
        limit: 2,
      })) as JsonRecord[];
      return nullableNumber(rows.at(-1)?.longShortRatio);
    },
    async getTopTraderPositionRatio(symbol) {
      const rows = (await requestJson("/futures/data/topLongShortPositionRatio", {
        symbol,
        period: "5m",
        limit: 2,
      })) as JsonRecord[];
      return nullableNumber(rows.at(-1)?.longShortRatio);
    },
    async getTakerBuySellRatio(symbol) {
      const rows = (await requestJson("/futures/data/takerlongshortRatio", {
        symbol,
        period: "5m",
        limit: 2,
      })) as JsonRecord[];
      return nullableNumber(rows.at(-1)?.buySellRatio);
    },
    async getFullyDilutedValuation(symbol, price) {
      const [valuation] = await getMarketValuations([{ symbol, price }]);
      return valuation?.fdvUsd ?? null;
    },
  };
}

export async function refreshTriggeredMarketValuations(input: {
  client: Pick<BinanceMarketClient, "getMarketValuations">;
  store: Pick<
    Store,
    "getMarketValuationRefreshCandidates" | "upsertMarketValuations"
  >;
  nowMs?: number;
  refreshIntervalMs?: number;
}) {
  if (!input.client.getMarketValuations) return 0;
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const candidates = input.store.getMarketValuationRefreshCandidates({
    triggeredSince: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    staleBefore: new Date(nowMs - (input.refreshIntervalMs ?? 60 * 60 * 1000)).toISOString(),
    limit: 50,
  });
  if (!candidates.length) return 0;
  const received = await input.client.getMarketValuations(candidates);
  const bySymbol = new Map(received.map((valuation) => [valuation.symbol, valuation]));
  input.store.upsertMarketValuations(
    candidates.map((candidate) => bySymbol.get(candidate.symbol) ?? {
      symbol: candidate.symbol,
      marketCapUsd: null,
      fdvUsd: null,
    }),
    now,
  );
  return candidates.length;
}

export type SelectedMarket = {
  symbol: string;
  baseAsset: string;
  price: number;
  pct24h: number;
  quoteVolume: number;
  meta: JsonRecord;
};

export function selectFuturesUniverse(
  exchangeInfo: { symbols?: JsonRecord[] },
  tickers: JsonRecord[],
  options: { topN: number; excludeTradFi: boolean },
) {
  const metaBySymbol = new Map(
    (exchangeInfo.symbols ?? []).map((meta) => [stringValue(meta.symbol), meta]),
  );
  return tickers
    .map((ticker) => {
      const symbol = stringValue(ticker.symbol).toUpperCase();
      const meta = metaBySymbol.get(symbol) ?? {};
      const contractType = stringValue(meta.contractType);
      const baseAsset = stringValue(meta.baseAsset).toUpperCase();
      const eligibleContract = contractType === "PERPETUAL" || isTradFiContract(meta);
      if (
        !symbol.endsWith("USDT") ||
        stringValue(meta.status) !== "TRADING" ||
        stringValue(meta.quoteAsset) !== "USDT" ||
        !eligibleContract ||
        isStableOrFiatBase(baseAsset) ||
        (options.excludeTradFi && isTradFiContract(meta))
      ) {
        return null;
      }
      return {
        symbol,
        baseAsset,
        price: numberValue(ticker.lastPrice),
        pct24h: numberValue(ticker.priceChangePercent),
        quoteVolume: numberValue(ticker.quoteVolume),
        meta,
      } satisfies SelectedMarket;
    })
    .filter((item): item is SelectedMarket => Boolean(item))
    .sort((left, right) => right.quoteVolume - left.quoteVolume)
    .slice(0, Math.max(1, options.topN));
}

export function includeTrackedMarkets(
  primary: SelectedMarket[],
  allMarkets: SelectedMarket[],
  trackedSymbols: Set<string>,
) {
  const included = new Set(primary.map((market) => market.symbol));
  const result = [...primary];
  for (const market of allMarkets) {
    if (!trackedSymbols.has(market.symbol) || included.has(market.symbol)) continue;
    included.add(market.symbol);
    result.push(market);
  }
  return result;
}

function klineOpen(row: KlineRow) {
  return numberValue(row?.[1]);
}

function klineHigh(row: KlineRow) {
  return numberValue(row?.[2]);
}

function klineClose(row: KlineRow) {
  return numberValue(row?.[4]);
}

function klineVolume(row: KlineRow) {
  return numberValue(row?.[5]);
}

function klineQuoteVolume(row: KlineRow) {
  return numberValue(row?.[7]);
}

function klineCloseTime(row: KlineRow) {
  return numberValue(row?.[6]);
}

function percentChange(current: number, previous: number) {
  return current && previous ? ((current / previous) - 1) * 100 : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function candleStreak(rows: KlineRow[], direction: "green" | "red") {
  let count = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const open = klineOpen(rows[index]);
    const close = klineClose(rows[index]);
    if (direction === "green" ? close > open : close < open) count += 1;
    else break;
  }
  return count;
}

export function buildVolatilityInputFromKlines(input: {
  symbol: string;
  fiveMinuteKlines: KlineRow[];
  oneMinuteKlines: KlineRow[];
  ticker: JsonRecord | undefined;
  nowMs?: number;
}) {
  if (input.fiveMinuteKlines.length < 5 || input.oneMinuteKlines.length < 2) {
    throw new Error(`Kline data not enough for ${input.symbol}`);
  }
  const nowMs = input.nowMs ?? Date.now();
  const five = input.fiveMinuteKlines;
  const one = input.oneMinuteKlines;
  const latest5m = five.at(-1)!;
  const latest1m = one.at(-1)!;
  const rollingStart = five[Math.max(0, five.length - 5)];
  const prior5mVolumes = five.slice(Math.max(0, five.length - 31), -1).map(klineVolume);
  const prior1mVolumes = one.slice(Math.max(0, one.length - 21), -1).map(klineVolume);
  const average5m = average(prior5mVolumes);
  const average1m = average(prior1mVolumes);
  const pct25m = percentChange(klineClose(latest5m), klineOpen(rollingStart));
  return {
    symbol: input.symbol,
    price: numberValue(input.ticker?.lastPrice, klineClose(latest1m) || klineClose(latest5m)),
    pct1m: percentChange(klineClose(latest1m), klineOpen(latest1m)),
    pct5m: pct25m,
    pct25m,
    pct24h: numberValue(input.ticker?.priceChangePercent),
    candle5mPct: percentChange(klineClose(latest5m), klineOpen(latest5m)),
    streakGreen: candleStreak(five, "green"),
    streakRed: candleStreak(five, "red"),
    volRatio1m: average1m ? klineVolume(latest1m) / average1m : 0,
    volRatio5m: average5m ? klineVolume(latest5m) / average5m : 0,
    k1Closed: klineCloseTime(latest1m) <= nowMs,
    k5Closed: klineCloseTime(latest5m) <= nowMs,
    kTime: numberValue(latest5m[0]),
  };
}

function tickerInputs(markets: SelectedMarket[], updatedAt: string) {
  return markets.map((market) => ({
    symbol: market.symbol,
    price: market.price,
    pct24h: market.pct24h,
    quoteVolume: market.quoteVolume,
    updatedAt,
  }));
}

function volatilityReasons(signal: VolatilitySignal) {
  const direction = signal.side === "LONG" ? "上涨" : "下跌";
  return [
    `近25m${direction}${Math.abs(signal.changePct).toFixed(2)}%`,
    `成交量比${signal.volumeRatio.toFixed(2)}x`,
    signal.statusText,
  ];
}

async function isFdvEligible(
  market: SelectedMarket,
  client: BinanceMarketClient,
  minFdvUsd: number,
) {
  if (isTradFiContract(market.meta) || !client.getFullyDilutedValuation) return true;
  const fdv = await client.getFullyDilutedValuation(market.symbol, market.price);
  return fdv === null || !Number.isFinite(fdv) || fdv <= 0 || fdv >= minFdvUsd;
}

async function persistMarketAlertChart(input: {
  event: ReturnType<Store["insertMarketAlertEvent"]>;
  client: BinanceMarketClient;
  store: Store;
  writeChart?: MarketAlertChartWriter;
}) {
  if (!input.writeChart) return;
  try {
    const klines = await input.client.getKlines(input.event.symbol, "5m", 120);
    const occurredAtMs = Date.parse(input.event.occurredAt);
    const createdAtMs = Date.parse(input.event.createdAt);
    const sourceKey = [
      Math.max(0, Number.isFinite(occurredAtMs) ? occurredAtMs : 0)
        .toString()
        .padStart(13, "0"),
      Math.max(0, Number.isFinite(createdAtMs) ? createdAtMs : 0)
        .toString()
        .padStart(13, "0"),
      createHash("sha256").update(input.event.id).digest("hex").slice(0, 12),
    ].join("_");
    const generatedAt = new Date().toISOString();
    const result = await input.writeChart({
      symbol: input.event.symbol,
      interval: "5m",
      klines,
      generatedAt,
      sourceKey,
    });
    const registration = input.store.upsertMarketAlertChart({
      symbol: input.event.symbol,
      eventId: input.event.id,
      interval: result.interval,
      updatedAt: result.updatedAt,
      sourceKey: result.sourceKey,
    });
    if (!registration.accepted) {
      await result.removeSource?.(result.sourceKey);
    } else if (result.pruneOlder) {
      await result.pruneOlder(result.sourceKey);
    } else if (registration.replacedSourceKey) {
      await result.removeSource?.(registration.replacedSourceKey);
    }
  } catch (error) {
    console.error(`[MARKET-ALERT-CHART] ${input.event.symbol}: ${safeError(error)}`);
  }
}

function createMarketAlertChartQueue(input: {
  client: BinanceMarketClient;
  store: Store;
  writeChart?: MarketAlertChartWriter;
}) {
  const pending = new Set<Promise<void>>();
  const enqueue = (event: ReturnType<Store["insertMarketAlertEvent"]>) => {
    if (!input.writeChart) return;
    const task = persistMarketAlertChart({ ...input, event });
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
  };
  const drain = async () => {
    while (pending.size) {
      await Promise.allSettled([...pending]);
    }
  };
  return { enqueue, drain };
}

async function persistVolatilitySignal(input: {
  signal: VolatilitySignal;
  market: SelectedMarket;
  store: Store;
  owner: string;
  nowMs: number;
  deliverAlert?: DeliverAlert;
  scheduleChart?: (event: ReturnType<Store["insertMarketAlertEvent"]>) => void;
  onDeliveryError?: (error: unknown) => void;
  isEligible?: () => Promise<boolean>;
}) {
  const key = `${input.signal.side}:${input.signal.symbol}`;
  const reservation = input.store.reserveVolatilityAlert({
    key,
    strength: input.signal.strengthPct,
    nowMs: input.nowMs,
    owner: input.owner,
  });
  if (!reservation.send || !reservation.next) return false;
  let event: ReturnType<Store["insertMarketAlertEvent"]> | null = null;
  let chartScheduled = false;
  const scheduleChart = () => {
    if (!event || chartScheduled) return;
    chartScheduled = true;
    input.scheduleChart?.(event);
  };
  try {
    if (input.isEligible && !(await input.isEligible())) {
      input.store.releaseVolatilityAlert(key, input.owner);
      return false;
    }
    const occurredAt = new Date(input.signal.occurredAtMs || input.nowMs).toISOString();
    event = input.store.insertMarketAlertEvent({
      id: `volatility:${input.signal.side}:${input.signal.symbol}:${input.signal.occurredAtMs || input.nowMs}:${input.signal.level}`,
      type: "volatility",
      symbol: input.signal.symbol,
      side: input.signal.side,
      level: input.signal.level,
      stage: input.signal.stage,
      trigger: input.signal.trigger,
      source: input.owner.startsWith("ws:") ? "ws" : "rest",
      price: input.signal.price,
      changePct: input.signal.changePct,
      volumeRatio: input.signal.volumeRatio,
      score: null,
      metrics: {
        strengthPct: input.signal.strengthPct,
        pct24h: input.market.pct24h,
        quoteVolume: input.market.quoteVolume,
        statusText: input.signal.statusText,
      },
      reasons: volatilityReasons(input.signal),
      occurredAt,
    });
    if (input.deliverAlert) {
      try {
        const receipt = await input.deliverAlert(event);
        if (receipt?.status === "sent") {
          input.store.updateMarketAlertDelivery(
            event.id,
            "sent",
            receipt.messageId ?? null,
          );
        }
      } catch (error) {
        const uncertain = isUncertainMarketAlertDeliveryError(error);
        if (uncertain) {
          if (!input.store.commitVolatilityAlertUncertain(
            key,
            input.owner,
            reservation.next,
            event.id,
          )) {
            throw new Error(`volatility state commit lost ownership for ${key}`);
          }
          reportDeliveryError(input.onDeliveryError, error);
          console.error(`[MARKET-ALERT-DELIVERY] ${event.symbol}: ${safeError(error)}`);
          scheduleChart();
          return true;
        }
        input.store.updateMarketAlertDelivery(event.id, "failed");
        reportDeliveryError(input.onDeliveryError, error);
        throw error;
      }
    }
    if (!input.store.commitVolatilityAlert(key, input.owner, reservation.next)) {
      throw new Error(`volatility state commit lost ownership for ${key}`);
    }
    scheduleChart();
    return true;
  } catch (error) {
    input.store.releaseVolatilityAlert(key, input.owner);
    scheduleChart();
    throw error;
  }
}

function restScanSymbols(
  markets: SelectedMarket[],
  config: MarketAlertsConfig,
  nowMs: number,
  prioritySymbols = new Set<string>(),
) {
  const core = markets.slice(0, config.restCoreN);
  const coreSymbols = new Set(core.map((market) => market.symbol));
  const priority = markets.filter(
    (market) => prioritySymbols.has(market.symbol) && !coreSymbols.has(market.symbol),
  );
  const extended = markets.slice(config.restCoreN).filter(
    (market) => !prioritySymbols.has(market.symbol),
  );
  if (!extended.length) return core;
  const groups = Math.max(1, config.restExtendedIntervalMin);
  const group = Math.floor(nowMs / 60_000) % groups;
  return [
    ...core,
    ...priority,
    ...extended.filter((_, index) => index % groups === group),
  ];
}

export async function runVolatilityRestScan(input: {
  client?: BinanceMarketClient;
  store?: Store;
  nowMs?: number;
  config?: Partial<MarketAlertsConfig>;
  deliverAlert?: DeliverAlert;
  writeChart?: MarketAlertChartWriter;
} = {}) {
  const config = mergeConfig(input.config);
  const client = input.client ?? createBinanceFuturesClient(config);
  const store = input.store ?? openMarketAlertsStore();
  const ownsStore = !input.store;
  const nowMs = input.nowMs ?? Date.now();
  const scanIso = new Date(nowMs).toISOString();
  const chartQueue = createMarketAlertChartQueue({
    client,
    store,
    writeChart: input.writeChart,
  });
  try {
    store.setMarketAlertsHeartbeat({
      worker: "volatility-rest",
      status: "starting",
      detail: "正在读取 Binance 合约行情",
      now: scanIso,
    });
    const [exchangeInfo, tickers] = await Promise.all([
      client.getExchangeInfo(),
      client.getTickers24h(),
    ]);
    const allMarkets = selectFuturesUniverse(exchangeInfo, tickers, {
      topN: Math.max(1, tickers.length),
      excludeTradFi: false,
    });
    const activeSignals = store
      .getMarketAlertsSnapshot({ limit: 1, now: scanIso })
      .activeSignals;
    const activeVolatilitySymbols = new Set(
      activeSignals
        .filter((signal) => signal.kind === "volatility")
        .map((signal) => signal.symbol),
    );
    const triggeredSince = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const trackedSymbols = new Set([
      ...store.getRecentlyTriggeredSymbols(triggeredSince),
      ...activeVolatilitySymbols,
    ]);
    const markets = includeTrackedMarkets(
      allMarkets.slice(0, config.restTopN),
      allMarkets,
      trackedSymbols,
    );
    store.upsertMarketTickers(tickerInputs(markets, scanIso));
    const valuationRefreshes = await refreshTriggeredMarketValuations({
      client,
      store,
      nowMs,
    });
    const selected = restScanSymbols(
      markets,
      config,
      nowMs,
      activeVolatilitySymbols,
    );
    const chartBackfills = input.writeChart
      ? store.getMarketAlertChartBackfillEvents({
          since: new Date(
            nowMs - config.chartBackfillHours * 60 * 60 * 1_000,
          ).toISOString(),
          symbols: markets.map((market) => market.symbol),
          limit: config.chartBackfillPerScan,
        })
      : [];
    let latestError: string | null = null;
    const results = await mapLimit(selected, 12, async (market) => {
      try {
        const [fiveMinuteKlines, oneMinuteKlines] = await Promise.all([
          client.getKlines(market.symbol, "5m", 36),
          client.getKlines(market.symbol, "1m", 40),
        ]);
        const metrics = buildVolatilityInputFromKlines({
          symbol: market.symbol,
          fiveMinuteKlines,
          oneMinuteKlines,
          ticker: tickers.find((ticker) => stringValue(ticker.symbol) === market.symbol),
          nowMs,
        });
        const signal = evaluateRestVolatilitySignal(metrics);
        const recoveryCalm = isVolatilityRecoveryCalm(metrics);
        if (signal?.side !== "LONG" && recoveryCalm) {
          store.recoverVolatilityAlert(`LONG:${market.symbol}`, nowMs);
        } else if (!recoveryCalm) {
          store.resetVolatilityRecovery(`LONG:${market.symbol}`, nowMs);
        }
        if (signal?.side !== "SHORT" && recoveryCalm) {
          store.recoverVolatilityAlert(`SHORT:${market.symbol}`, nowMs);
        } else if (!recoveryCalm) {
          store.resetVolatilityRecovery(`SHORT:${market.symbol}`, nowMs);
        }
        if (!signal) return false;
        return persistVolatilitySignal({
          signal,
          market,
          store,
          owner: `rest:${process.pid}:${market.symbol}:${nowMs}`,
          nowMs,
          deliverAlert: input.deliverAlert,
          scheduleChart: chartQueue.enqueue,
          onDeliveryError: (error) => {
            latestError = safeError(error);
          },
          isEligible: () => isFdvEligible(market, client, config.minFdvUsd),
        });
      } catch (error) {
        latestError = safeError(error);
        console.error(`[VOLATILITY-REST] ${market.symbol}: ${safeError(error)}`);
        return false;
      }
    });
    for (const event of chartBackfills) chartQueue.enqueue(event);
    const alerts = results.filter(Boolean).length;
    store.setMarketAlertsHeartbeat({
      worker: "volatility-rest",
      status: "live",
      detail: `扫描 ${selected.length} 个合约，新增 ${alerts} 条预警`,
      meta: {
        primaryUniverse: Math.min(config.restTopN, allMarkets.length),
        tracked: markets.length - Math.min(config.restTopN, allMarkets.length),
        universe: markets.length,
        scanned: selected.length,
        alerts,
        valuationRefreshes,
        chartBackfills: chartBackfills.length,
      },
      lastError: latestError,
      now: new Date().toISOString(),
    });
    return { universe: markets.length, scanned: selected.length, alerts };
  } catch (error) {
    store.setMarketAlertsHeartbeat({
      worker: "volatility-rest",
      status: "error",
      detail: safeError(error),
      now: new Date().toISOString(),
    });
    throw error;
  } finally {
    await chartQueue.drain();
    if (ownsStore) store.close();
  }
}

function openInterestMetrics(rows: JsonRecord[]) {
  if (!Array.isArray(rows) || rows.length < 4) return null;
  const latest = nullableNumber(rows.at(-1)?.sumOpenInterestValue);
  const prior = nullableNumber(rows.at(-4)?.sumOpenInterestValue);
  if (!latest || !prior) return null;
  return {
    oiNotional: latest,
    oiGrowth15m: ((latest / prior) - 1) * 100,
  };
}

async function enrichSqueezeMetrics(
  symbol: string,
  base: {
    funding: number;
    basis: number;
    oiNotional: number;
    oiGrowth15m: number;
  },
  client: BinanceMarketClient,
) {
  if (
    !client.getGlobalLongShortRatio ||
    !client.getTopTraderPositionRatio ||
    !client.getTakerBuySellRatio
  ) {
    return null;
  }
  const [klines, globalLongShortRatio, topTraderLongShortRatio, takerBuySellRatio] =
    await Promise.all([
      client.getKlines(symbol, "5m", 25),
      client.getGlobalLongShortRatio(symbol),
      client.getTopTraderPositionRatio(symbol),
      client.getTakerBuySellRatio(symbol),
    ]);
  if (klines.length < 22) return null;
  const latest = klines.at(-1)!;
  const old = klines.at(-4)!;
  const priorHigh = Math.max(...klines.slice(-21, -1).map(klineHigh));
  const priorQuoteVolumes = klines.slice(-22, -2).map(klineQuoteVolume);
  const averageQuoteVolume = average(priorQuoteVolumes);
  return {
    ...base,
    price: klineClose(latest),
    priceChange15m: percentChange(klineClose(latest), klineClose(old)),
    volRatio: averageQuoteVolume
      ? klineQuoteVolume(klines.at(-2)!) / averageQuoteVolume
      : 0,
    breakout20: klineClose(latest) > priorHigh,
    globalLongShortRatio,
    topTraderLongShortRatio,
    takerBuySellRatio,
  };
}

export async function runSqueezeScan(input: {
  client?: BinanceMarketClient;
  store?: Store;
  nowMs?: number;
  config?: Partial<MarketAlertsConfig>;
  deliverAlert?: DeliverAlert;
  writeChart?: MarketAlertChartWriter;
} = {}) {
  const config = mergeConfig(input.config);
  const client = input.client ?? createBinanceFuturesClient(config);
  const store = input.store ?? openMarketAlertsStore();
  const ownsStore = !input.store;
  const nowMs = input.nowMs ?? Date.now();
  const scanIso = new Date(nowMs).toISOString();
  const chartQueue = createMarketAlertChartQueue({
    client,
    store,
    writeChart: input.writeChart,
  });
  try {
    if (!client.getPremiumIndex || !client.getOpenInterestHistory) {
      throw new Error("Binance client does not support squeeze metrics");
    }
    store.setMarketAlertsHeartbeat({
      worker: "squeeze",
      status: "starting",
      detail: "正在扫描轧空条件",
      now: scanIso,
    });
    const [exchangeInfo, tickers, premiums] = await Promise.all([
      client.getExchangeInfo(),
      client.getTickers24h(),
      client.getPremiumIndex(),
    ]);
    const active = store.getTrackedSqueezeSignals();
    const allMarkets = selectFuturesUniverse(exchangeInfo, tickers, {
      topN: Math.max(1, tickers.length),
      excludeTradFi: true,
    });
    const markets = includeTrackedMarkets(
      allMarkets.slice(0, config.squeezeTopN),
      allMarkets,
      new Set(active.map((signal) => signal.symbol)),
    );
    store.upsertMarketTickers(tickerInputs(markets, scanIso));
    const premiumBySymbol = new Map(
      premiums.map((row) => [stringValue(row.symbol), row]),
    );
    const oiRows = await mapLimit(markets, config.squeezeWorkers, async (market) => {
      try {
        const rows = await client.getOpenInterestHistory!(market.symbol);
        return { market, oi: openInterestMetrics(rows) };
      } catch (error) {
        console.error(`[SQUEEZE-OI] ${market.symbol}: ${safeError(error)}`);
        return { market, oi: null };
      }
    });
    const covered = oiRows.filter((item) => item.oi).length;
    const minimumCoverage = Math.max(1, Math.ceil(markets.length * 0.7));
    if (covered < minimumCoverage) {
      throw new Error(`OI coverage too low: ${covered}/${markets.length}`);
    }
    const coarse = new Map<
      string,
      { funding: number; basis: number; oiNotional: number; oiGrowth15m: number }
    >();
    const candidates: SelectedMarket[] = [];
    for (const item of oiRows) {
      if (!item.oi) continue;
      const premium = premiumBySymbol.get(item.market.symbol);
      const funding = nullableNumber(premium?.lastFundingRate);
      const mark = nullableNumber(premium?.markPrice);
      const index = nullableNumber(premium?.indexPrice);
      if (funding === null || mark === null || index === null || !index) continue;
      const base = {
        funding,
        basis: (mark / index) - 1,
        oiNotional: item.oi.oiNotional,
        oiGrowth15m: item.oi.oiGrowth15m,
      };
      coarse.set(item.market.symbol, base);
      if (
        funding <= -0.0003 &&
        base.oiGrowth15m >= 4 &&
        base.oiNotional >= config.minOiNotional * 0.5
      ) {
        candidates.push(item.market);
      }
    }
    const detailed = await mapLimit(
      candidates,
      Math.min(config.squeezeWorkers, 8),
      async (market) => {
        try {
          const metrics = await enrichSqueezeMetrics(
            market.symbol,
            coarse.get(market.symbol)!,
            client,
          );
          return metrics ? { market, metrics } : null;
        } catch (error) {
          console.error(`[SQUEEZE-DETAIL] ${market.symbol}: ${safeError(error)}`);
          return null;
        }
      },
    );
    const scored = detailed
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        ...item,
        result: scoreShortSqueeze(item.metrics, {
          minOiNotional: config.minOiNotional,
        }),
      }))
      .sort((left, right) => right.result.score - left.result.score);

    const eligibleSymbols = new Set(
      scored.filter((item) => item.result.eligible).map((item) => item.market.symbol),
    );
    for (const signal of active) {
      if (eligibleSymbols.has(signal.symbol)) {
        store.updateSqueezeRecovery(signal.symbol, false);
        continue;
      }
      const base = coarse.get(signal.symbol);
      const recovered = squeezeRecoveryDecision(
        base
          ? { funding: base.funding, oiGrowth15m: base.oiGrowth15m }
          : null,
      );
      if (recovered !== null) store.updateSqueezeRecovery(signal.symbol, recovered);
    }

    let alerts = 0;
    for (const item of scored) {
      if (!item.result.eligible) continue;
      const level = item.result.level;
      if (!store.beginSqueezeDelivery(item.market.symbol, level, nowMs)) continue;
      let event: ReturnType<Store["insertMarketAlertEvent"]> | null = null;
      let chartScheduled = false;
      const scheduleChart = () => {
        if (!event || chartScheduled) return;
        chartScheduled = true;
        chartQueue.enqueue(event);
      };
      try {
        event = store.insertMarketAlertEvent({
          id: `short_squeeze:LONG:${item.market.symbol}:${nowMs}:${level}`,
          type: "short_squeeze",
          symbol: item.market.symbol,
          side: "LONG",
          level,
          stage: item.result.stage,
          trigger: item.result.stage,
          source: "squeeze",
          price: item.metrics.price,
          changePct: item.metrics.priceChange15m,
          volumeRatio: item.metrics.volRatio,
          score: item.result.score,
          metrics: {
            funding: item.metrics.funding,
            basis: item.metrics.basis,
            oiGrowth15m: item.metrics.oiGrowth15m,
            oiNotional: item.metrics.oiNotional,
            priceChange15m: item.metrics.priceChange15m,
            globalLongShortRatio: item.metrics.globalLongShortRatio,
            topTraderLongShortRatio: item.metrics.topTraderLongShortRatio,
            takerBuySellRatio: item.metrics.takerBuySellRatio,
            pct24h: item.market.pct24h,
            quoteVolume: item.market.quoteVolume,
          },
          reasons: item.result.reasons,
          occurredAt: scanIso,
        });
        if (input.deliverAlert) {
          try {
            const receipt = await input.deliverAlert(event);
            if (receipt?.status === "sent") {
              store.updateMarketAlertDelivery(
                event.id,
                "sent",
                receipt.messageId ?? null,
              );
            }
          } catch (error) {
            const uncertain = isUncertainMarketAlertDeliveryError(error);
            if (uncertain) {
              if (!store.commitSqueezeDeliveryUncertain(
                item.market.symbol,
                level,
                event.id,
                safeError(error),
              )) {
                throw new Error(
                  `squeeze delivery guard lost ownership for ${item.market.symbol}:${level}`,
                );
              }
            } else {
              store.updateMarketAlertDelivery(event.id, "failed");
            }
            throw error;
          }
        }
        store.commitSqueezeDeliverySuccess(
          item.market.symbol,
          level,
          item.result.score,
          nowMs,
        );
        scheduleChart();
        alerts += 1;
      } catch (error) {
        store.releaseSqueezeDelivery(item.market.symbol, level);
        scheduleChart();
        throw error;
      }
    }
    store.setMarketAlertsHeartbeat({
      worker: "squeeze",
      status: "live",
      detail: `扫描 ${markets.length} 个合约，候选 ${candidates.length} 个，新增 ${alerts} 条预警`,
      meta: { scanned: markets.length, candidates: candidates.length, alerts, oiCoverage: covered },
      now: new Date().toISOString(),
    });
    return { scanned: markets.length, candidates: candidates.length, alerts, oiCoverage: covered };
  } catch (error) {
    store.setMarketAlertsHeartbeat({
      worker: "squeeze",
      status: "error",
      detail: safeError(error),
      now: new Date().toISOString(),
    });
    throw error;
  } finally {
    await chartQueue.drain();
    if (ownsStore) store.close();
  }
}

function wsKlineToRow(kline: JsonRecord): KlineRow {
  return [
    numberValue(kline.t),
    stringValue(kline.o),
    stringValue(kline.h),
    stringValue(kline.l),
    stringValue(kline.c),
    stringValue(kline.v),
    numberValue(kline.T),
    stringValue(kline.q),
  ];
}

function upsertKline(rows: KlineRow[], next: KlineRow, maxLength: number) {
  const openTime = numberValue(next[0]);
  const index = rows.findIndex((row) => numberValue(row[0]) === openTime);
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  rows.sort((left, right) => numberValue(left[0]) - numberValue(right[0]));
  while (rows.length > maxLength) rows.shift();
}

export function createMarketWebSocketUrl(baseUrl: string, symbols: string[]) {
  const streams = symbols.flatMap((symbol) => [
    `${symbol.toLowerCase()}@kline_1m`,
    `${symbol.toLowerCase()}@kline_5m`,
    `${symbol.toLowerCase()}@ticker`,
  ]);
  return `${baseUrl.replace(/\/$/, "")}/stream?streams=${streams.join("/")}`;
}

export async function startVolatilityWebSocketWorker(input: {
  client?: BinanceMarketClient;
  store?: Store;
  config?: Partial<MarketAlertsConfig>;
  deliverAlert?: DeliverAlert;
  writeChart?: MarketAlertChartWriter;
  createWebSocket?: (url: string) => Pick<WebSocket, "addEventListener" | "close">;
  once?: boolean;
  signal?: AbortSignal;
} = {}) {
  const config = mergeConfig(input.config);
  const client = input.client ?? createBinanceFuturesClient(config);
  const store = input.store ?? openMarketAlertsStore();
  const ownsStore = !input.store;
  const chartQueue = createMarketAlertChartQueue({
    client,
    store,
    writeChart: input.writeChart,
  });
  try {
    const [exchangeInfo, tickers] = await Promise.all([
      client.getExchangeInfo(),
      client.getTickers24h(),
    ]);
    const activeVolatilitySymbols = new Set(
      store
        .getMarketAlertsSnapshot({ limit: 1, now: new Date().toISOString() })
        .activeSignals.filter((signal) => signal.kind === "volatility")
        .map((signal) => signal.symbol),
    );
    const allMarkets = selectFuturesUniverse(exchangeInfo, tickers, {
      topN: Math.max(1, tickers.length),
      excludeTradFi: false,
    });
    const markets = includeTrackedMarkets(
      allMarkets.slice(0, config.wsTopN),
      allMarkets,
      activeVolatilitySymbols,
    );
    const now = new Date().toISOString();
    store.upsertMarketTickers(tickerInputs(markets, now));
    const subscribedMarkets = input.once ? markets.slice(0, 5) : markets;

    const cache = new Map<
      string,
      { one: KlineRow[]; five: KlineRow[]; ticker: JsonRecord; market: SelectedMarket }
    >();
    await mapLimit(subscribedMarkets, 10, async (market) => {
      const [one, five] = await Promise.all([
        client.getKlines(market.symbol, "1m", 40),
        client.getKlines(market.symbol, "5m", 36),
      ]);
      cache.set(market.symbol, {
        one,
        five,
        ticker: {
          symbol: market.symbol,
          lastPrice: market.price,
          priceChangePercent: market.pct24h,
          quoteVolume: market.quoteVolume,
        },
        market,
      });
    });

    store.setMarketAlertsHeartbeat({
      worker: "volatility-ws",
      status: "connecting",
      detail: input.once
        ? `正在验证 WebSocket 实时链路`
        : `正在订阅 ${subscribedMarkets.length} 个合约`,
      meta: { universe: markets.length, subscribed: subscribedMarkets.length, probe: input.once },
    });
    const url = createMarketWebSocketUrl(
      config.wsBaseUrl,
      subscribedMarkets.map((market) => market.symbol),
    );
    const pendingAlerts = new Map<string, Promise<unknown>>();
    const fdvCache = new Map<string, { eligible: boolean; expiresAt: number }>();
    const cachedFdvEligibility = async (market: SelectedMarket) => {
      const nowMs = Date.now();
      const cached = fdvCache.get(market.symbol);
      if (cached && cached.expiresAt > nowMs) return cached.eligible;
      const eligible = await isFdvEligible(market, client, config.minFdvUsd);
      fdvCache.set(market.symbol, {
        eligible,
        expiresAt: nowMs + 10 * 60 * 1000,
      });
      return eligible;
    };
    const recordWsError = (error: unknown) => {
      store.setMarketAlertsHeartbeat({
        worker: "volatility-ws",
        status: "live",
        detail: `实时接收 ${subscribedMarkets.length} 个合约`,
        meta: { universe: markets.length, subscribed: subscribedMarkets.length },
        lastError: safeError(error),
      });
    };
    try {
      await new Promise<void>((resolve, reject) => {
      const socket = input.createWebSocket?.(url) ?? new WebSocket(url);
      let lastHeartbeatAt = 0;
      let lastTickerPersistAt = Date.now();
      let receivedFirstMessage = false;
      let firstMessageTimer: ReturnType<typeof setTimeout> | null = null;
      const refreshTimer = setTimeout(() => socket.close(1000, "refresh-universe"), config.wsRankRefreshMs);
      const onAbort = () => socket.close(1000, "shutdown");
      input.signal?.addEventListener("abort", onAbort, { once: true });
      socket.addEventListener("open", () => {
        store.setMarketAlertsHeartbeat({
          worker: "volatility-ws",
          status: "connecting",
          detail: `连接已建立，等待 ${subscribedMarkets.length} 个合约的首帧行情`,
          meta: { universe: markets.length, subscribed: subscribedMarkets.length, probe: input.once },
        });
        firstMessageTimer = setTimeout(
          () => socket.close(4000, "first-message-timeout"),
          config.wsFirstMessageTimeoutMs,
        );
      });
      socket.addEventListener("message", (event) => {
        try {
          const envelope = JSON.parse(String(event.data)) as JsonRecord;
          const stream = stringValue(envelope.stream);
          const payload = (envelope.data ?? {}) as JsonRecord;
          if (!receivedFirstMessage) {
            receivedFirstMessage = true;
            if (firstMessageTimer) clearTimeout(firstMessageTimer);
            firstMessageTimer = null;
            store.setMarketAlertsHeartbeat({
              worker: "volatility-ws",
              status: "live",
              detail: input.once
                ? "WebSocket 实时链路验证成功"
                : `实时接收 ${subscribedMarkets.length} 个合约`,
              meta: {
                universe: markets.length,
                subscribed: subscribedMarkets.length,
                latestStream: stream,
                probe: input.once,
              },
            });
            if (input.once) socket.close(1000, "probe-complete");
          }
          const symbol = stringValue(payload.s).toUpperCase();
          const item = cache.get(symbol);
          if (!item) return;
          if (stream.endsWith("@ticker")) {
            item.ticker = {
              symbol,
              lastPrice: payload.c,
              priceChangePercent: payload.P,
              quoteVolume: payload.q,
            };
            item.market.price = numberValue(payload.c);
            item.market.pct24h = numberValue(payload.P);
            item.market.quoteVolume = numberValue(payload.q);
            const tickerNowMs = Date.now();
            if (tickerNowMs - lastTickerPersistAt >= 30_000) {
              lastTickerPersistAt = tickerNowMs;
              store.upsertMarketTickers(
                tickerInputs(
                  [...cache.values()].map((cachedItem) => cachedItem.market),
                  new Date(tickerNowMs).toISOString(),
                ),
              );
            }
            return;
          }
          const kline = payload.k as JsonRecord | undefined;
          if (!kline) return;
          const row = wsKlineToRow(kline);
          if (stream.includes("@kline_1m")) upsertKline(item.one, row, 40);
          if (stream.includes("@kline_5m")) upsertKline(item.five, row, 36);
          if (item.one.length < 21 || item.five.length < 5) return;
          const nowMs = Date.now();
          const metrics = buildVolatilityInputFromKlines({
            symbol,
            fiveMinuteKlines: item.five,
            oneMinuteKlines: item.one,
            ticker: item.ticker,
            nowMs,
          });
          const signal = evaluateWsVolatilitySignal(metrics);
          const recoveryCalm = isVolatilityRecoveryCalm(metrics);
          if (signal?.side !== "LONG" && recoveryCalm) {
            store.recoverVolatilityAlert(`LONG:${symbol}`, nowMs);
          } else if (!recoveryCalm) {
            store.resetVolatilityRecovery(`LONG:${symbol}`, nowMs);
          }
          if (signal?.side !== "SHORT" && recoveryCalm) {
            store.recoverVolatilityAlert(`SHORT:${symbol}`, nowMs);
          } else if (!recoveryCalm) {
            store.resetVolatilityRecovery(`SHORT:${symbol}`, nowMs);
          }
          if (signal) {
            const taskKey = `${signal.side}:${symbol}`;
            if (!pendingAlerts.has(taskKey)) {
              const task = persistVolatilitySignal({
                signal,
                market: item.market,
                store,
                owner: `ws:${process.pid}:${symbol}:${nowMs}`,
                nowMs,
                deliverAlert: input.deliverAlert,
                scheduleChart: chartQueue.enqueue,
                onDeliveryError: recordWsError,
                isEligible: () => cachedFdvEligibility(item.market),
              })
                .catch((error) => {
                  recordWsError(error);
                  console.error(`[VOLATILITY-WS] ${symbol}: ${safeError(error)}`);
                });
              pendingAlerts.set(taskKey, task);
              void task.then(
                () => {
                  if (pendingAlerts.get(taskKey) === task) pendingAlerts.delete(taskKey);
                },
                () => {
                  if (pendingAlerts.get(taskKey) === task) pendingAlerts.delete(taskKey);
                },
              );
            }
          }
          if (nowMs - lastHeartbeatAt >= 30_000) {
            lastHeartbeatAt = nowMs;
            store.setMarketAlertsHeartbeat({
              worker: "volatility-ws",
              status: "live",
              detail: `实时接收 ${subscribedMarkets.length} 个合约`,
              meta: {
                universe: markets.length,
                subscribed: subscribedMarkets.length,
                latestSymbol: symbol,
              },
            });
          }
        } catch (error) {
          console.error(`[VOLATILITY-WS-MESSAGE] ${safeError(error)}`);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(refreshTimer);
        if (firstMessageTimer) clearTimeout(firstMessageTimer);
        reject(new Error("Binance WebSocket connection failed"));
      });
      socket.addEventListener("close", (event) => {
        clearTimeout(refreshTimer);
        if (firstMessageTimer) clearTimeout(firstMessageTimer);
        input.signal?.removeEventListener("abort", onAbort);
        if (input.signal?.aborted) resolve();
        else if (event.reason === "refresh-universe") resolve();
        else if (event.reason === "probe-complete") resolve();
        else if (event.code === 1000 && receivedFirstMessage) resolve();
        else if (event.reason === "first-message-timeout" || event.code === 4000) {
          reject(new Error("Binance WebSocket did not deliver the first market message in time"));
        }
        else reject(new Error(`Binance WebSocket closed: ${event.code} ${event.reason}`));
      });
      });
    } finally {
      await Promise.allSettled([...pendingAlerts.values()]);
    }
    return { universe: markets.length, probe: Boolean(input.once) };
  } catch (error) {
    store.setMarketAlertsHeartbeat({
      worker: "volatility-ws",
      status: "error",
      detail: safeError(error),
    });
    throw error;
  } finally {
    await chartQueue.drain();
    if (ownsStore) store.close();
  }
}

export async function runWorkerLoop(
  operation: () => Promise<unknown>,
  intervalMs: number,
  signal?: AbortSignal,
) {
  while (!signal?.aborted) {
    const startedAt = Date.now();
    try {
      await operation();
    } catch (error) {
      console.error(`[MARKET-WORKER] ${safeError(error)}`);
    }
    const waitMs = Math.max(1_000, intervalMs - (Date.now() - startedAt));
    await Promise.race([
      sleep(waitMs),
      new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true })),
    ]);
  }
}
