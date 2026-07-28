type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BinanceHynixPremiumProvider = "binance-futures";
export type BinanceHynixPremiumInterval = "5m" | "1h" | "1d";

export type BinanceKlinePoint = {
  symbol: string;
  interval: BinanceHynixPremiumInterval;
  openTime: number;
  closeTime: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
};

export type BinanceFuturesMarkPrice = {
  symbol: string;
  markPrice: number;
  indexPrice: number | null;
  lastFundingRate: number | null;
  nextFundingTime: number | null;
  time: number;
};

export type BinanceFundingRatePoint = {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
};

export type BinanceHynixFundingRecord = {
  fundingTime: number;
  capturedAt: string;
  shanghaiDate: string;
  baseSymbol: string;
  benchmarkSymbol: string;
  baseFundingRate: number;
  benchmarkFundingRate: number;
  shortBaseFundingRate: number;
  longBenchmarkFundingRate: number;
  combinedFundingRate: number;
  combinedFundingRatePct: number;
  combinedFundingFeePer10kUsdt: number;
};

export type BinanceHynixFundingDaily = {
  date: string;
  records: number;
  combinedFundingRate: number;
  combinedFundingRatePct: number;
  combinedFundingFeePer10kUsdt: number;
};

export type BinanceHynixPremiumPoint = {
  openTime: number;
  closeTime: number;
  capturedAt: string;
  baseSymbol: string;
  benchmarkSymbol: string;
  basePrice: number;
  baseOpenPrice: number;
  baseHighPrice: number;
  baseLowPrice: number;
  baseClosePrice: number;
  benchmarkPrice: number;
  benchmarkOpenPrice: number;
  benchmarkHighPrice: number;
  benchmarkLowPrice: number;
  benchmarkClosePrice: number;
  premiumPct: number;
  premiumOpenPct: number;
  premiumHighPct: number;
  premiumLowPct: number;
  premiumClosePct: number;
  volume: number;
};

export type BinanceHynixPremiumSnapshot = {
  generatedAt: string;
  source: "live" | "empty";
  provider: BinanceHynixPremiumProvider;
  interval: BinanceHynixPremiumInterval;
  symbols: {
    base: string;
    benchmark: string;
  };
  websocket: {
    url: string;
    streams: string[];
  };
  points: BinanceHynixPremiumPoint[];
  latest: BinanceHynixPremiumPoint | null;
  errors: string[];
};

export type BinanceHynixFundingSnapshot = {
  generatedAt: string;
  source: "live" | "empty";
  provider: BinanceHynixPremiumProvider;
  symbols: {
    base: string;
    benchmark: string;
  };
  strategy: "short-base-long-benchmark";
  records: BinanceHynixFundingRecord[];
  daily: BinanceHynixFundingDaily[];
  latest: BinanceHynixFundingRecord | null;
  errors: string[];
};

export type BinanceFuturesWebSocketMessage =
  | {
      type: "kline";
      point: BinanceKlinePoint;
      eventTime: number;
      closed: boolean;
    }
  | {
      type: "markPrice";
      symbol: string;
      markPrice: number;
      indexPrice: number | null;
      eventTime: number;
    };

type SnapshotInput = {
  generatedAt?: string;
  provider?: BinanceHynixPremiumProvider;
  interval?: BinanceHynixPremiumInterval;
  baseSymbol: string;
  benchmarkSymbol: string;
  baseKlines: BinanceKlinePoint[];
  benchmarkKlines: BinanceKlinePoint[];
  errors: string[];
  websocketBaseUrl?: string;
};

const DEFAULT_BASE_SYMBOL = "SKHYUSDT";
const DEFAULT_BENCHMARK_SYMBOL = "SKHYNIXUSDT";
const DEFAULT_FUTURES_REST_BASE_URL = "https://fapi.binance.com";
const DEFAULT_FUTURES_WS_BASE_URL = "wss://fstream.binance.com";
export const BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS = Date.parse(
  "2026-07-13T16:00:00.000Z",
);
const HYNIX_PREMIUM_BASE_MULTIPLIER = 10;
const DEFAULT_INTERVAL = "5m" satisfies BinanceHynixPremiumInterval;
const INTERVAL_MS: Record<BinanceHynixPremiumInterval, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};
const DEFAULT_KLINE_PAGE_LIMIT = 1500;
const MAX_KLINE_PAGE_LIMIT = 1500;
const MAX_TOTAL_KLINES = 20000;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function roundNumber(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calculatePremiumPct({
  basePrice,
  benchmarkPrice,
}: {
  basePrice: number;
  benchmarkPrice: number;
}) {
  if (!Number.isFinite(basePrice) || !Number.isFinite(benchmarkPrice)) {
    return null;
  }
  if (benchmarkPrice === 0) return null;
  return roundNumber(
    ((basePrice * HYNIX_PREMIUM_BASE_MULTIPLIER) / benchmarkPrice - 1) * 100,
  );
}

function normalizeSymbol(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).toUpperCase();
}

function normalizeLimit(value: number | undefined) {
  const parsed = Math.floor(Number(value ?? DEFAULT_KLINE_PAGE_LIMIT));
  return Number.isFinite(parsed)
    ? Math.max(2, Math.min(parsed, MAX_KLINE_PAGE_LIMIT))
    : DEFAULT_KLINE_PAGE_LIMIT;
}

function normalizeInterval(value: string | undefined): BinanceHynixPremiumInterval {
  return value === "1h" || value === "1d" || value === "5m"
    ? value
    : DEFAULT_INTERVAL;
}

export function binanceHynixPremiumIntervalMs(
  interval: BinanceHynixPremiumInterval,
) {
  return INTERVAL_MS[interval];
}

function normalizeStartTime(value: number | string | undefined) {
  const parsed = Number(value ?? BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.floor(parsed))
    : BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS;
}

function normalizeEndTime(value: number | string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function timestampFromChartTime(value: number | string | { year: number; month: number; day: number }) {
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") return Date.parse(value);
  return Date.UTC(value.year, value.month - 1, value.day);
}

export function formatShanghaiChartTime(
  value: number | string | { year: number; month: number; day: number },
  interval: BinanceHynixPremiumInterval = DEFAULT_INTERVAL,
) {
  const timestamp = timestampFromChartTime(value);
  if (!Number.isFinite(timestamp)) return "";
  const options: Intl.DateTimeFormatOptions =
    interval === "1d"
      ? {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
        }
      : {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        };
  return new Intl.DateTimeFormat("zh-CN", options)
    .format(new Date(timestamp))
    .replace(/\//g, "-");
}

function formatShanghaiDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveRestBaseUrl(env: EnvLike) {
  return trimBaseUrl(
    env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL?.trim() ||
      env.BINANCE_HYNIX_PREMIUM_BASE_URL?.trim() ||
      env.BINANCE_FUTURES_BASE_URL?.trim() ||
      DEFAULT_FUTURES_REST_BASE_URL,
  );
}

function resolveWebSocketBaseUrl(env: EnvLike) {
  return trimBaseUrl(
    env.BINANCE_HYNIX_PREMIUM_WS_BASE_URL?.trim() ||
      env.BINANCE_FUTURES_WS_BASE_URL?.trim() ||
      DEFAULT_FUTURES_WS_BASE_URL,
  );
}

function klineUrl({
  baseUrl,
  symbol,
  interval,
  startTime,
  endTime,
  limit,
}: {
  baseUrl: string;
  symbol: string;
  interval: BinanceHynixPremiumInterval;
  startTime?: number;
  endTime?: number;
  limit: number;
}) {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (startTime !== undefined) params.set("startTime", String(startTime));
  if (endTime !== undefined) params.set("endTime", String(endTime));
  return `${baseUrl}/fapi/v1/klines?${params.toString()}`;
}

function premiumIndexUrl({ baseUrl, symbol }: { baseUrl: string; symbol: string }) {
  const params = new URLSearchParams({ symbol });
  return `${baseUrl}/fapi/v1/premiumIndex?${params.toString()}`;
}

function fundingRateUrl({
  baseUrl,
  symbol,
  startTime,
  endTime,
  limit,
}: {
  baseUrl: string;
  symbol: string;
  startTime?: number;
  endTime?: number;
  limit: number;
}) {
  const params = new URLSearchParams({
    symbol,
    limit: String(limit),
  });
  if (startTime !== undefined) params.set("startTime", String(startTime));
  if (endTime !== undefined) params.set("endTime", String(endTime));
  return `${baseUrl}/fapi/v1/fundingRate?${params.toString()}`;
}

export function binanceHynixPremiumWebSocketStreams({
  baseSymbol,
  benchmarkSymbol,
  interval = DEFAULT_INTERVAL,
}: {
  baseSymbol: string;
  benchmarkSymbol: string;
  interval?: BinanceHynixPremiumInterval;
}) {
  const base = baseSymbol.toLowerCase();
  const benchmark = benchmarkSymbol.toLowerCase();
  return [
    `${base}@markPrice`,
    `${benchmark}@markPrice`,
    `${base}@kline_${interval}`,
    `${benchmark}@kline_${interval}`,
  ];
}

export function binanceHynixPremiumWebSocketUrl({
  baseSymbol = DEFAULT_BASE_SYMBOL,
  benchmarkSymbol = DEFAULT_BENCHMARK_SYMBOL,
  interval = DEFAULT_INTERVAL,
  baseUrl = DEFAULT_FUTURES_WS_BASE_URL,
}: {
  baseSymbol?: string;
  benchmarkSymbol?: string;
  interval?: BinanceHynixPremiumInterval;
  baseUrl?: string;
} = {}) {
  const streams = binanceHynixPremiumWebSocketStreams({
    baseSymbol,
    benchmarkSymbol,
    interval,
  });
  return `${trimBaseUrl(baseUrl)}/public/stream?streams=${streams.join("/")}`;
}

function payloadRows(payload: unknown) {
  const record = asRecord(payload);
  const data = record.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(data)) return data;
  const nestedData = asRecord(data);
  if (Array.isArray(nestedData.klineInfos)) return nestedData.klineInfos;
  if (Array.isArray(nestedData.klines)) return nestedData.klines;
  if (Array.isArray(nestedData.rows)) return nestedData.rows;
  return [];
}

function parseArrayKline(
  row: unknown[],
  symbol: string,
  interval: BinanceHynixPremiumInterval,
): BinanceKlinePoint | null {
  const openTime = numberValue(row[0]);
  const closeTime = numberValue(row[6]);
  const openPrice = numberValue(row[1]);
  const highPrice = numberValue(row[2]);
  const lowPrice = numberValue(row[3]);
  const closePrice = numberValue(row[4]);
  const volume = numberValue(row[5]);
  if (
    openTime === null ||
    closeTime === null ||
    openPrice === null ||
    highPrice === null ||
    lowPrice === null ||
    closePrice === null ||
    volume === null
  ) {
    return null;
  }
  return {
    symbol,
    interval,
    openTime,
    closeTime,
    openPrice,
    highPrice,
    lowPrice,
    closePrice,
    volume,
  };
}

function parseObjectKline(
  row: Record<string, unknown>,
  symbol: string,
  expectedInterval: BinanceHynixPremiumInterval = DEFAULT_INTERVAL,
): BinanceKlinePoint | null {
  const interval = stringValue(row.interval ?? row.i);
  if (interval && interval !== expectedInterval) return null;
  const openTime = numberValue(row.openTime ?? row.open_time ?? row.t);
  const closeTime = numberValue(row.closeTime ?? row.close_time ?? row.T);
  const openPrice = numberValue(row.open ?? row.openPrice ?? row.o);
  const highPrice = numberValue(row.high ?? row.highPrice ?? row.h);
  const lowPrice = numberValue(row.low ?? row.lowPrice ?? row.l);
  const closePrice = numberValue(row.close ?? row.closePrice ?? row.c);
  const volume = numberValue(row.volume ?? row.v ?? 0);
  if (
    openTime === null ||
    closeTime === null ||
    openPrice === null ||
    highPrice === null ||
    lowPrice === null ||
    closePrice === null ||
    volume === null
  ) {
    return null;
  }
  return {
    symbol,
    interval: expectedInterval,
    openTime,
    closeTime,
    openPrice,
    highPrice,
    lowPrice,
    closePrice,
    volume,
  };
}

export function parseBinanceKlinePayload(
  payload: unknown,
  symbol: string,
  interval: BinanceHynixPremiumInterval = DEFAULT_INTERVAL,
): BinanceKlinePoint[] {
  const normalizedSymbol = normalizeSymbol(symbol, symbol);
  return payloadRows(payload)
    .map((row) => {
      if (Array.isArray(row)) return parseArrayKline(row, normalizedSymbol, interval);
      const record = asRecord(row);
      return Object.keys(record).length > 0
        ? parseObjectKline(record, normalizedSymbol, interval)
        : null;
    })
    .filter((point): point is BinanceKlinePoint => Boolean(point))
    .sort((left, right) => left.openTime - right.openTime);
}

function parseJsonPayload(payload: unknown) {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

export function parseBinanceFuturesWebSocketMessage(
  payload: unknown,
): BinanceFuturesWebSocketMessage | null {
  const parsed = parseJsonPayload(payload);
  const wrapper = asRecord(parsed);
  const data = asRecord(wrapper.data);
  const message = Object.keys(data).length > 0 ? data : wrapper;
  const eventType = stringValue(message.e);

  if (eventType === "kline" || Object.keys(asRecord(message.k)).length > 0) {
    const kline = asRecord(message.k);
    const symbol = normalizeSymbol(
      stringValue(kline.s) || stringValue(message.s),
      DEFAULT_BASE_SYMBOL,
    );
    const interval = normalizeInterval(stringValue(kline.i) || DEFAULT_INTERVAL);
    const point = parseObjectKline(kline, symbol, interval);
    const eventTime = numberValue(message.E) ?? point?.closeTime ?? Date.now();
    if (!point) return null;
    return {
      type: "kline",
      point,
      eventTime,
      closed: booleanValue(kline.x),
    };
  }

  if (eventType === "markPriceUpdate" || message.p !== undefined) {
    const symbol = normalizeSymbol(stringValue(message.s), DEFAULT_BASE_SYMBOL);
    const markPrice = numberValue(message.p);
    const indexPrice = numberValue(message.i);
    const eventTime = numberValue(message.E) ?? Date.now();
    if (markPrice === null) return null;
    return {
      type: "markPrice",
      symbol,
      markPrice,
      indexPrice,
      eventTime,
    };
  }

  return null;
}

export function buildBinanceHynixPremiumPoint({
  openTime,
  closeTime,
  capturedAt,
  baseSymbol,
  benchmarkSymbol,
  basePrice,
  baseOpenPrice = basePrice,
  baseHighPrice = basePrice,
  baseLowPrice = basePrice,
  baseClosePrice = basePrice,
  benchmarkPrice,
  benchmarkOpenPrice = benchmarkPrice,
  benchmarkHighPrice = benchmarkPrice,
  benchmarkLowPrice = benchmarkPrice,
  benchmarkClosePrice = benchmarkPrice,
  volume = 0,
}: {
  openTime: number;
  closeTime: number;
  capturedAt: string;
  baseSymbol: string;
  benchmarkSymbol: string;
  basePrice: number;
  baseOpenPrice?: number;
  baseHighPrice?: number;
  baseLowPrice?: number;
  baseClosePrice?: number;
  benchmarkPrice: number;
  benchmarkOpenPrice?: number;
  benchmarkHighPrice?: number;
  benchmarkLowPrice?: number;
  benchmarkClosePrice?: number;
  volume?: number;
}): BinanceHynixPremiumPoint | null {
  const premiumOpenPct = calculatePremiumPct({
    basePrice: baseOpenPrice,
    benchmarkPrice: benchmarkOpenPrice,
  });
  const premiumHighCandidatePct = calculatePremiumPct({
    basePrice: baseHighPrice,
    benchmarkPrice: benchmarkLowPrice,
  });
  const premiumLowCandidatePct = calculatePremiumPct({
    basePrice: baseLowPrice,
    benchmarkPrice: benchmarkHighPrice,
  });
  const premiumClosePct = calculatePremiumPct({
    basePrice: baseClosePrice,
    benchmarkPrice: benchmarkClosePrice,
  });
  if (
    premiumOpenPct === null ||
    premiumHighCandidatePct === null ||
    premiumLowCandidatePct === null ||
    premiumClosePct === null
  ) {
    return null;
  }
  const premiumHighPct = Math.max(
    premiumOpenPct,
    premiumHighCandidatePct,
    premiumLowCandidatePct,
    premiumClosePct,
  );
  const premiumLowPct = Math.min(
    premiumOpenPct,
    premiumHighCandidatePct,
    premiumLowCandidatePct,
    premiumClosePct,
  );
  return {
    openTime,
    closeTime,
    capturedAt,
    baseSymbol,
    benchmarkSymbol,
    basePrice: baseClosePrice,
    baseOpenPrice,
    baseHighPrice,
    baseLowPrice,
    baseClosePrice,
    benchmarkPrice: benchmarkClosePrice,
    benchmarkOpenPrice,
    benchmarkHighPrice,
    benchmarkLowPrice,
    benchmarkClosePrice,
    premiumPct: premiumClosePct,
    premiumOpenPct,
    premiumHighPct,
    premiumLowPct,
    premiumClosePct,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

export function upsertBinanceHynixPremiumPoint(
  snapshot: BinanceHynixPremiumSnapshot,
  point: BinanceHynixPremiumPoint,
  limit = 288,
): BinanceHynixPremiumSnapshot {
  const points = [
    ...snapshot.points.filter((candidate) => candidate.openTime !== point.openTime),
    point,
  ]
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-Math.max(2, limit));
  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    source: "live",
    points,
    latest: points.at(-1) ?? null,
  };
}

function markPremiumPoint({
  baseMark,
  benchmarkMark,
  baseSymbol,
  benchmarkSymbol,
  interval,
}: {
  baseMark: BinanceFuturesMarkPrice;
  benchmarkMark: BinanceFuturesMarkPrice;
  baseSymbol: string;
  benchmarkSymbol: string;
  interval: BinanceHynixPremiumInterval;
}) {
  const capturedTime = Math.min(baseMark.time, benchmarkMark.time);
  const intervalMs = binanceHynixPremiumIntervalMs(interval);
  const openTime = Math.floor(capturedTime / intervalMs) * intervalMs;
  return buildBinanceHynixPremiumPoint({
    openTime,
    closeTime: openTime + intervalMs - 1,
    capturedAt: new Date(capturedTime).toISOString(),
    baseSymbol,
    benchmarkSymbol,
    basePrice: baseMark.markPrice,
    benchmarkPrice: benchmarkMark.markPrice,
  });
}

export function buildBinanceHynixPremiumSnapshot({
  generatedAt = new Date().toISOString(),
  provider = "binance-futures",
  interval = DEFAULT_INTERVAL,
  baseSymbol,
  benchmarkSymbol,
  baseKlines,
  benchmarkKlines,
  errors,
  websocketBaseUrl = DEFAULT_FUTURES_WS_BASE_URL,
}: SnapshotInput): BinanceHynixPremiumSnapshot {
  const benchmarkByOpenTime = new Map(
    benchmarkKlines.map((point) => [point.openTime, point]),
  );
  const points = baseKlines
    .map((basePoint): BinanceHynixPremiumPoint | null => {
      const benchmarkPoint = benchmarkByOpenTime.get(basePoint.openTime);
      if (!benchmarkPoint) return null;
      return buildBinanceHynixPremiumPoint({
        openTime: basePoint.openTime,
        closeTime: Math.min(basePoint.closeTime, benchmarkPoint.closeTime),
        capturedAt: new Date(
          Math.min(basePoint.closeTime, benchmarkPoint.closeTime),
        ).toISOString(),
        baseSymbol,
        benchmarkSymbol,
        basePrice: basePoint.closePrice,
        baseOpenPrice: basePoint.openPrice,
        baseHighPrice: basePoint.highPrice,
        baseLowPrice: basePoint.lowPrice,
        baseClosePrice: basePoint.closePrice,
        benchmarkPrice: benchmarkPoint.closePrice,
        benchmarkOpenPrice: benchmarkPoint.openPrice,
        benchmarkHighPrice: benchmarkPoint.highPrice,
        benchmarkLowPrice: benchmarkPoint.lowPrice,
        benchmarkClosePrice: benchmarkPoint.closePrice,
        volume: basePoint.volume,
      });
    })
    .filter((point): point is BinanceHynixPremiumPoint => Boolean(point));
  const streams = binanceHynixPremiumWebSocketStreams({
    baseSymbol,
    benchmarkSymbol,
    interval,
  });

  return {
    generatedAt,
    source: points.length > 0 ? "live" : "empty",
    provider,
    interval,
    symbols: {
      base: baseSymbol,
      benchmark: benchmarkSymbol,
    },
    websocket: {
      url: binanceHynixPremiumWebSocketUrl({
        baseSymbol,
        benchmarkSymbol,
        interval,
        baseUrl: websocketBaseUrl,
      }),
      streams,
    },
    points,
    latest: points.at(-1) ?? null,
    errors,
  };
}

async function readPayload(response: Response) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function errorFromPayload(payload: unknown) {
  const record = asRecord(payload);
  const code = stringValue(record.code);
  const message = stringValue(record.message) || stringValue(record.msg);
  return code ? `${code}${message ? `: ${message}` : ""}` : "";
}

async function fetchKlines({
  fetchImpl,
  baseUrl,
  symbol,
  interval,
  startTime,
  endTime,
  limit,
}: {
  fetchImpl: FetchLike;
  baseUrl: string;
  symbol: string;
  interval: BinanceHynixPremiumInterval;
  startTime: number;
  endTime?: number;
  limit: number;
}) {
  const points: BinanceKlinePoint[] = [];
  let cursor = startTime;
  let requests = 0;

  while (points.length < MAX_TOTAL_KLINES) {
    const url = klineUrl({
      baseUrl,
      symbol,
      interval,
      startTime: cursor,
      endTime,
      limit,
    });
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept: "application/json,text/plain,*/*",
      },
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new Error(
        `${symbol} Binance futures kline HTTP ${response.status}${
          errorFromPayload(payload) ? `: ${errorFromPayload(payload)}` : ""
        }`,
      );
    }
    const error = errorFromPayload(payload);
    if (error && !Array.isArray(payload)) {
      throw new Error(`${symbol} Binance futures kline error ${error}`);
    }
    const page = parseBinanceKlinePayload(payload, symbol, interval);
    points.push(...page);
    requests += 1;
    const last = page.at(-1);
    if (!last) break;
    const nextCursor = last.openTime + binanceHynixPremiumIntervalMs(interval);
    if (nextCursor <= cursor) break;
    if (endTime !== undefined && nextCursor > endTime) break;
    if (page.length < limit && endTime === undefined) break;
    cursor = nextCursor;
    if (requests > Math.ceil(MAX_TOTAL_KLINES / Math.max(1, limit)) + 1) break;
  }

  return points
    .filter((point) => point.openTime >= startTime)
    .filter((point) => endTime === undefined || point.openTime <= endTime)
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-MAX_TOTAL_KLINES);
}

function parseMarkPricePayload(
  payload: unknown,
  symbol: string,
): BinanceFuturesMarkPrice | null {
  const record = asRecord(payload);
  const markPrice = numberValue(record.markPrice);
  const indexPrice = numberValue(record.indexPrice);
  const lastFundingRate = numberValue(record.lastFundingRate);
  const nextFundingTime = numberValue(record.nextFundingTime);
  const time = numberValue(record.time);
  if (markPrice === null || time === null) return null;
  return {
    symbol: normalizeSymbol(stringValue(record.symbol), symbol),
    markPrice,
    indexPrice,
    lastFundingRate,
    nextFundingTime,
    time,
  };
}

async function fetchMarkPrice({
  fetchImpl,
  url,
  symbol,
}: {
  fetchImpl: FetchLike;
  url: string;
  symbol: string;
}) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
    },
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new Error(
      `${symbol} Binance futures premiumIndex HTTP ${response.status}${
        errorFromPayload(payload) ? `: ${errorFromPayload(payload)}` : ""
      }`,
    );
  }
  const parsed = parseMarkPricePayload(payload, symbol);
  if (!parsed) {
    throw new Error(`${symbol} Binance futures premiumIndex invalid payload`);
  }
  return parsed;
}

function parseFundingRatePayload(
  payload: unknown,
  symbol: string,
): BinanceFundingRatePoint[] {
  return payloadRows(payload)
    .map((row): BinanceFundingRatePoint | null => {
      const record = asRecord(row);
      const fundingRate = numberValue(record.fundingRate);
      const fundingTime = numberValue(record.fundingTime);
      if (fundingRate === null || fundingTime === null) return null;
      return {
        symbol: normalizeSymbol(stringValue(record.symbol), symbol),
        fundingRate,
        fundingTime,
        markPrice: numberValue(record.markPrice),
      };
    })
    .filter((point): point is BinanceFundingRatePoint => Boolean(point))
    .sort((left, right) => left.fundingTime - right.fundingTime);
}

async function fetchFundingRates({
  fetchImpl,
  baseUrl,
  symbol,
  startTime,
  endTime,
  limit,
}: {
  fetchImpl: FetchLike;
  baseUrl: string;
  symbol: string;
  startTime: number;
  endTime?: number;
  limit: number;
}) {
  const points: BinanceFundingRatePoint[] = [];
  let cursor = startTime;

  while (points.length < MAX_TOTAL_KLINES) {
    const url = fundingRateUrl({
      baseUrl,
      symbol,
      startTime: cursor,
      endTime,
      limit,
    });
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept: "application/json,text/plain,*/*",
      },
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new Error(
        `${symbol} Binance futures fundingRate HTTP ${response.status}${
          errorFromPayload(payload) ? `: ${errorFromPayload(payload)}` : ""
        }`,
      );
    }
    const page = parseFundingRatePayload(payload, symbol);
    points.push(...page);
    if (page.length < limit) break;
    const last = page.at(-1);
    if (!last) break;
    const nextCursor = last.fundingTime + 1;
    if (nextCursor <= cursor) break;
    if (endTime !== undefined && nextCursor > endTime) break;
    cursor = nextCursor;
  }

  return points
    .filter((point) => point.fundingTime >= startTime)
    .filter((point) => endTime === undefined || point.fundingTime <= endTime)
    .sort((left, right) => left.fundingTime - right.fundingTime)
    .slice(-MAX_TOTAL_KLINES);
}

function buildBinanceHynixFundingSnapshot({
  generatedAt = new Date().toISOString(),
  provider = "binance-futures",
  baseSymbol,
  benchmarkSymbol,
  baseFundingRates,
  benchmarkFundingRates,
  errors,
}: {
  generatedAt?: string;
  provider?: BinanceHynixPremiumProvider;
  baseSymbol: string;
  benchmarkSymbol: string;
  baseFundingRates: BinanceFundingRatePoint[];
  benchmarkFundingRates: BinanceFundingRatePoint[];
  errors: string[];
}): BinanceHynixFundingSnapshot {
  const benchmarkByFundingTime = new Map(
    benchmarkFundingRates.map((point) => [point.fundingTime, point]),
  );
  const records = baseFundingRates
    .map((basePoint): BinanceHynixFundingRecord | null => {
      const benchmarkPoint = benchmarkByFundingTime.get(basePoint.fundingTime);
      if (!benchmarkPoint) return null;
      const shortBaseFundingRate = basePoint.fundingRate;
      const longBenchmarkFundingRate = -benchmarkPoint.fundingRate;
      const combinedFundingRate =
        shortBaseFundingRate + longBenchmarkFundingRate;
      return {
        fundingTime: basePoint.fundingTime,
        capturedAt: new Date(basePoint.fundingTime).toISOString(),
        shanghaiDate: formatShanghaiDate(basePoint.fundingTime),
        baseSymbol,
        benchmarkSymbol,
        baseFundingRate: basePoint.fundingRate,
        benchmarkFundingRate: benchmarkPoint.fundingRate,
        shortBaseFundingRate,
        longBenchmarkFundingRate,
        combinedFundingRate: roundNumber(combinedFundingRate, 8),
        combinedFundingRatePct: roundNumber(combinedFundingRate * 100, 4),
        combinedFundingFeePer10kUsdt: roundNumber(combinedFundingRate * 10000, 4),
      };
    })
    .filter((record): record is BinanceHynixFundingRecord => Boolean(record));
  const dailyMap = new Map<string, BinanceHynixFundingDaily>();
  for (const record of records) {
    const existing = dailyMap.get(record.shanghaiDate) ?? {
      date: record.shanghaiDate,
      records: 0,
      combinedFundingRate: 0,
      combinedFundingRatePct: 0,
      combinedFundingFeePer10kUsdt: 0,
    };
    existing.records += 1;
    existing.combinedFundingRate += record.combinedFundingRate;
    existing.combinedFundingRatePct += record.combinedFundingRatePct;
    existing.combinedFundingFeePer10kUsdt +=
      record.combinedFundingFeePer10kUsdt;
    dailyMap.set(record.shanghaiDate, existing);
  }
  const daily = [...dailyMap.values()].map((entry) => ({
    ...entry,
    combinedFundingRate: roundNumber(entry.combinedFundingRate, 8),
    combinedFundingRatePct: roundNumber(entry.combinedFundingRatePct, 4),
    combinedFundingFeePer10kUsdt: roundNumber(
      entry.combinedFundingFeePer10kUsdt,
      4,
    ),
  }));

  return {
    generatedAt,
    source: records.length > 0 ? "live" : "empty",
    provider,
    symbols: {
      base: baseSymbol,
      benchmark: benchmarkSymbol,
    },
    strategy: "short-base-long-benchmark",
    records,
    daily,
    latest: records.at(-1) ?? null,
    errors,
  };
}

export async function fetchBinanceHynixPremiumSnapshot({
  fetchImpl = fetch,
  env = process.env,
  interval,
  startTime,
  endTime,
  limit,
}: {
  fetchImpl?: FetchLike;
  env?: EnvLike;
  interval?: BinanceHynixPremiumInterval;
  startTime?: number | string;
  endTime?: number | string;
  limit?: number;
} = {}): Promise<BinanceHynixPremiumSnapshot> {
  const provider: BinanceHynixPremiumProvider = "binance-futures";
  const baseSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BASE_SYMBOL,
    DEFAULT_BASE_SYMBOL,
  );
  const benchmarkSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BENCHMARK_SYMBOL,
    DEFAULT_BENCHMARK_SYMBOL,
  );
  const restBaseUrl = resolveRestBaseUrl(env);
  const websocketBaseUrl = resolveWebSocketBaseUrl(env);
  const normalizedInterval = normalizeInterval(interval);
  const normalizedStartTime = normalizeStartTime(startTime);
  const normalizedEndTime = normalizeEndTime(endTime);
  const normalizedLimit = normalizeLimit(limit);
  const klineRequests = [
    {
      symbol: baseSymbol,
      baseUrl: restBaseUrl,
      interval: normalizedInterval,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      limit: normalizedLimit,
    },
    {
      symbol: benchmarkSymbol,
      baseUrl: restBaseUrl,
      interval: normalizedInterval,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      limit: normalizedLimit,
    },
  ];
  const markRequests = [
    {
      symbol: baseSymbol,
      url: premiumIndexUrl({ baseUrl: restBaseUrl, symbol: baseSymbol }),
    },
    {
      symbol: benchmarkSymbol,
      url: premiumIndexUrl({ baseUrl: restBaseUrl, symbol: benchmarkSymbol }),
    },
  ];
  const [baseResult, benchmarkResult] = await Promise.allSettled(
    klineRequests.map((request) => fetchKlines({ fetchImpl, ...request })),
  );
  const [baseMarkResult, benchmarkMarkResult] = await Promise.allSettled(
    markRequests.map((request) => fetchMarkPrice({ fetchImpl, ...request })),
  );
  const errors = [
    baseResult,
    benchmarkResult,
    baseMarkResult,
    benchmarkMarkResult,
  ]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason),
    );

  const snapshot = buildBinanceHynixPremiumSnapshot({
    provider,
    interval: normalizedInterval,
    baseSymbol,
    benchmarkSymbol,
    baseKlines: baseResult.status === "fulfilled" ? baseResult.value : [],
    benchmarkKlines:
      benchmarkResult.status === "fulfilled" ? benchmarkResult.value : [],
    errors,
    websocketBaseUrl,
  });
  if (
    baseMarkResult.status !== "fulfilled" ||
    benchmarkMarkResult.status !== "fulfilled"
  ) {
    return snapshot;
  }
  const latestMarkPoint = markPremiumPoint({
    baseMark: baseMarkResult.value,
    benchmarkMark: benchmarkMarkResult.value,
    baseSymbol,
    benchmarkSymbol,
    interval: normalizedInterval,
  });
  return latestMarkPoint
    ? upsertBinanceHynixPremiumPoint(snapshot, latestMarkPoint, MAX_TOTAL_KLINES)
    : snapshot;
}

export async function fetchBinanceHynixFundingSnapshot({
  fetchImpl = fetch,
  env = process.env,
  startTime,
  endTime,
  limit,
}: {
  fetchImpl?: FetchLike;
  env?: EnvLike;
  startTime?: number | string;
  endTime?: number | string;
  limit?: number;
} = {}): Promise<BinanceHynixFundingSnapshot> {
  const provider: BinanceHynixPremiumProvider = "binance-futures";
  const baseSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BASE_SYMBOL,
    DEFAULT_BASE_SYMBOL,
  );
  const benchmarkSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BENCHMARK_SYMBOL,
    DEFAULT_BENCHMARK_SYMBOL,
  );
  const restBaseUrl = resolveRestBaseUrl(env);
  const normalizedStartTime = normalizeStartTime(startTime);
  const normalizedEndTime = normalizeEndTime(endTime);
  const normalizedLimit = normalizeLimit(limit);
  const fundingRequests = [
    {
      symbol: baseSymbol,
      baseUrl: restBaseUrl,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      limit: normalizedLimit,
    },
    {
      symbol: benchmarkSymbol,
      baseUrl: restBaseUrl,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      limit: normalizedLimit,
    },
  ];
  const [baseResult, benchmarkResult] = await Promise.allSettled(
    fundingRequests.map((request) => fetchFundingRates({ fetchImpl, ...request })),
  );
  const errors = [
    baseResult,
    benchmarkResult,
  ]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason),
    );

  return buildBinanceHynixFundingSnapshot({
    provider,
    baseSymbol,
    benchmarkSymbol,
    baseFundingRates: baseResult.status === "fulfilled" ? baseResult.value : [],
    benchmarkFundingRates:
      benchmarkResult.status === "fulfilled" ? benchmarkResult.value : [],
    errors,
  });
}
