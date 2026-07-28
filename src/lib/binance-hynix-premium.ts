type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BinanceHynixPremiumProvider = "binance-futures";

export type BinanceKlinePoint = {
  symbol: string;
  interval: "5m";
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
  time: number;
};

export type BinanceHynixPremiumPoint = {
  openTime: number;
  closeTime: number;
  capturedAt: string;
  baseSymbol: string;
  benchmarkSymbol: string;
  basePrice: number;
  benchmarkPrice: number;
  premiumPct: number;
};

export type BinanceHynixPremiumSnapshot = {
  generatedAt: string;
  source: "live" | "empty";
  provider: BinanceHynixPremiumProvider;
  interval: "5m";
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
const HYNIX_PREMIUM_BASE_MULTIPLIER = 10;
const INTERVAL = "5m" as const;
const INTERVAL_MS = 5 * 60 * 1000;

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

function normalizeSymbol(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).toUpperCase();
}

function normalizeLimit(value: number | undefined) {
  const parsed = Math.floor(Number(value ?? 144));
  return Number.isFinite(parsed) ? Math.max(2, Math.min(parsed, 288)) : 144;
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
  limit,
}: {
  baseUrl: string;
  symbol: string;
  limit: number;
}) {
  const params = new URLSearchParams({
    symbol,
    interval: INTERVAL,
    limit: String(limit),
  });
  return `${baseUrl}/fapi/v1/klines?${params.toString()}`;
}

function premiumIndexUrl({ baseUrl, symbol }: { baseUrl: string; symbol: string }) {
  const params = new URLSearchParams({ symbol });
  return `${baseUrl}/fapi/v1/premiumIndex?${params.toString()}`;
}

export function binanceHynixPremiumWebSocketStreams({
  baseSymbol,
  benchmarkSymbol,
}: {
  baseSymbol: string;
  benchmarkSymbol: string;
}) {
  const base = baseSymbol.toLowerCase();
  const benchmark = benchmarkSymbol.toLowerCase();
  return [
    `${base}@markPrice`,
    `${benchmark}@markPrice`,
    `${base}@kline_5m`,
    `${benchmark}@kline_5m`,
  ];
}

export function binanceHynixPremiumWebSocketUrl({
  baseSymbol = DEFAULT_BASE_SYMBOL,
  benchmarkSymbol = DEFAULT_BENCHMARK_SYMBOL,
  baseUrl = DEFAULT_FUTURES_WS_BASE_URL,
}: {
  baseSymbol?: string;
  benchmarkSymbol?: string;
  baseUrl?: string;
} = {}) {
  const streams = binanceHynixPremiumWebSocketStreams({
    baseSymbol,
    benchmarkSymbol,
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
    interval: INTERVAL,
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
): BinanceKlinePoint | null {
  const interval = stringValue(row.interval ?? row.i);
  if (interval && interval !== INTERVAL) return null;
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
    interval: INTERVAL,
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
): BinanceKlinePoint[] {
  const normalizedSymbol = normalizeSymbol(symbol, symbol);
  return payloadRows(payload)
    .map((row) => {
      if (Array.isArray(row)) return parseArrayKline(row, normalizedSymbol);
      const record = asRecord(row);
      return Object.keys(record).length > 0
        ? parseObjectKline(record, normalizedSymbol)
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
    const point = parseObjectKline(kline, symbol);
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
  benchmarkPrice,
}: {
  openTime: number;
  closeTime: number;
  capturedAt: string;
  baseSymbol: string;
  benchmarkSymbol: string;
  basePrice: number;
  benchmarkPrice: number;
}): BinanceHynixPremiumPoint | null {
  if (!Number.isFinite(basePrice) || !Number.isFinite(benchmarkPrice)) {
    return null;
  }
  if (benchmarkPrice === 0) return null;
  return {
    openTime,
    closeTime,
    capturedAt,
    baseSymbol,
    benchmarkSymbol,
    basePrice,
    benchmarkPrice,
    premiumPct: roundNumber(
      ((basePrice * HYNIX_PREMIUM_BASE_MULTIPLIER) / benchmarkPrice - 1) *
        100,
    ),
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
}: {
  baseMark: BinanceFuturesMarkPrice;
  benchmarkMark: BinanceFuturesMarkPrice;
  baseSymbol: string;
  benchmarkSymbol: string;
}) {
  const capturedTime = Math.min(baseMark.time, benchmarkMark.time);
  const openTime = Math.floor(capturedTime / INTERVAL_MS) * INTERVAL_MS;
  return buildBinanceHynixPremiumPoint({
    openTime,
    closeTime: openTime + INTERVAL_MS - 1,
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
        benchmarkPrice: benchmarkPoint.closePrice,
      });
    })
    .filter((point): point is BinanceHynixPremiumPoint => Boolean(point));
  const streams = binanceHynixPremiumWebSocketStreams({
    baseSymbol,
    benchmarkSymbol,
  });

  return {
    generatedAt,
    source: points.length > 0 ? "live" : "empty",
    provider,
    interval: INTERVAL,
    symbols: {
      base: baseSymbol,
      benchmark: benchmarkSymbol,
    },
    websocket: {
      url: binanceHynixPremiumWebSocketUrl({
        baseSymbol,
        benchmarkSymbol,
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
      `${symbol} Binance futures kline HTTP ${response.status}${
        errorFromPayload(payload) ? `: ${errorFromPayload(payload)}` : ""
      }`,
    );
  }
  const error = errorFromPayload(payload);
  if (error && !Array.isArray(payload)) {
    throw new Error(`${symbol} Binance futures kline error ${error}`);
  }
  return parseBinanceKlinePayload(payload, symbol);
}

function parseMarkPricePayload(
  payload: unknown,
  symbol: string,
): BinanceFuturesMarkPrice | null {
  const record = asRecord(payload);
  const markPrice = numberValue(record.markPrice);
  const indexPrice = numberValue(record.indexPrice);
  const time = numberValue(record.time);
  if (markPrice === null || time === null) return null;
  return {
    symbol: normalizeSymbol(stringValue(record.symbol), symbol),
    markPrice,
    indexPrice,
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

export async function fetchBinanceHynixPremiumSnapshot({
  fetchImpl = fetch,
  env = process.env,
  limit,
}: {
  fetchImpl?: FetchLike;
  env?: EnvLike;
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
  const normalizedLimit = normalizeLimit(limit);
  const klineRequests = [
    {
      symbol: baseSymbol,
      url: klineUrl({
        baseUrl: restBaseUrl,
        symbol: baseSymbol,
        limit: normalizedLimit,
      }),
    },
    {
      symbol: benchmarkSymbol,
      url: klineUrl({
        baseUrl: restBaseUrl,
        symbol: benchmarkSymbol,
        limit: normalizedLimit,
      }),
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
  });
  return latestMarkPoint
    ? upsertBinanceHynixPremiumPoint(snapshot, latestMarkPoint, normalizedLimit)
    : snapshot;
}
