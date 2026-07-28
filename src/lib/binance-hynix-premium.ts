type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BinanceHynixPremiumProvider = "binance-alpha" | "binance-spot";

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
  points: BinanceHynixPremiumPoint[];
  latest: BinanceHynixPremiumPoint | null;
  errors: string[];
};

type SnapshotInput = {
  generatedAt?: string;
  provider?: BinanceHynixPremiumProvider;
  baseSymbol: string;
  benchmarkSymbol: string;
  baseKlines: BinanceKlinePoint[];
  benchmarkKlines: BinanceKlinePoint[];
  errors: string[];
};

const DEFAULT_BASE_SYMBOL = "SKHYUSDT";
const DEFAULT_BENCHMARK_SYMBOL = "SKHYNIXUSDT";
const HYNIX_PREMIUM_BASE_MULTIPLIER = 10;
const INTERVAL = "5m" as const;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeProvider(value: string | undefined): BinanceHynixPremiumProvider {
  return value?.trim().toLowerCase() === "spot"
    ? "binance-spot"
    : "binance-alpha";
}

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveBaseUrl(provider: BinanceHynixPremiumProvider, env: EnvLike) {
  if (provider === "binance-spot") {
    return trimBaseUrl(
      env.BINANCE_HYNIX_PREMIUM_BASE_URL?.trim() ||
        env.BINANCE_SPOT_BASE_URL?.trim() ||
        "https://api.binance.com",
    );
  }

  return trimBaseUrl(
    env.BINANCE_HYNIX_PREMIUM_BASE_URL?.trim() ||
      env.BINANCE_ALPHA_BASE_URL?.trim() ||
      "https://www.binance.com",
  );
}

function klineUrl({
  baseUrl,
  provider,
  symbol,
  limit,
}: {
  baseUrl: string;
  provider: BinanceHynixPremiumProvider;
  symbol: string;
  limit: number;
}) {
  const params = new URLSearchParams({
    symbol,
    interval: INTERVAL,
    limit: String(limit),
  });
  const path =
    provider === "binance-alpha"
      ? "/bapi/defi/v1/public/alpha-trade/klines"
      : "/api/v3/klines";
  return `${baseUrl}${path}?${params.toString()}`;
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

export function buildBinanceHynixPremiumSnapshot({
  generatedAt = new Date().toISOString(),
  provider = "binance-alpha",
  baseSymbol,
  benchmarkSymbol,
  baseKlines,
  benchmarkKlines,
  errors,
}: SnapshotInput): BinanceHynixPremiumSnapshot {
  const benchmarkByOpenTime = new Map(
    benchmarkKlines.map((point) => [point.openTime, point]),
  );
  const points = baseKlines
    .map((basePoint): BinanceHynixPremiumPoint | null => {
      const benchmarkPoint = benchmarkByOpenTime.get(basePoint.openTime);
      if (!benchmarkPoint || benchmarkPoint.closePrice === 0) return null;
      return {
        openTime: basePoint.openTime,
        closeTime: Math.min(basePoint.closeTime, benchmarkPoint.closeTime),
        capturedAt: new Date(
          Math.min(basePoint.closeTime, benchmarkPoint.closeTime),
        ).toISOString(),
        baseSymbol,
        benchmarkSymbol,
        basePrice: basePoint.closePrice,
        benchmarkPrice: benchmarkPoint.closePrice,
        premiumPct: roundNumber(
          ((basePoint.closePrice * HYNIX_PREMIUM_BASE_MULTIPLIER) /
            benchmarkPoint.closePrice -
            1) *
            100,
        ),
      };
    })
    .filter((point): point is BinanceHynixPremiumPoint => Boolean(point));

  return {
    generatedAt,
    source: points.length > 0 ? "live" : "empty",
    provider,
    interval: INTERVAL,
    symbols: {
      base: baseSymbol,
      benchmark: benchmarkSymbol,
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
  if (!response.ok) {
    throw new Error(`${symbol} Binance kline HTTP ${response.status}`);
  }
  const payload = await readPayload(response);
  const record = asRecord(payload);
  const code = stringValue(record.code);
  const message = stringValue(record.message) || stringValue(record.msg);
  if (code && code !== "000000" && code !== "0") {
    throw new Error(`${symbol} Binance kline error ${code}${message ? `: ${message}` : ""}`);
  }
  return parseBinanceKlinePayload(payload, symbol);
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
  const provider = normalizeProvider(env.BINANCE_HYNIX_PREMIUM_PROVIDER);
  const baseSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BASE_SYMBOL,
    DEFAULT_BASE_SYMBOL,
  );
  const benchmarkSymbol = normalizeSymbol(
    env.BINANCE_HYNIX_PREMIUM_BENCHMARK_SYMBOL,
    DEFAULT_BENCHMARK_SYMBOL,
  );
  const baseUrl = resolveBaseUrl(provider, env);
  const normalizedLimit = normalizeLimit(limit);
  const requests = [
    {
      symbol: baseSymbol,
      url: klineUrl({
        baseUrl,
        provider,
        symbol: baseSymbol,
        limit: normalizedLimit,
      }),
    },
    {
      symbol: benchmarkSymbol,
      url: klineUrl({
        baseUrl,
        provider,
        symbol: benchmarkSymbol,
        limit: normalizedLimit,
      }),
    },
  ];
  const [baseResult, benchmarkResult] = await Promise.allSettled(
    requests.map((request) => fetchKlines({ fetchImpl, ...request })),
  );
  const errors = [baseResult, benchmarkResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason),
    );

  return buildBinanceHynixPremiumSnapshot({
    provider,
    baseSymbol,
    benchmarkSymbol,
    baseKlines: baseResult.status === "fulfilled" ? baseResult.value : [],
    benchmarkKlines:
      benchmarkResult.status === "fulfilled" ? benchmarkResult.value : [],
    errors,
  });
}
