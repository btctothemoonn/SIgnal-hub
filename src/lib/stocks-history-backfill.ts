import {
  ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
} from "./alpha-research-pool.ts";
import {
  getStocksHistoryBackfillStatus,
  getStocksHistoryCoverage,
  marketDateInNewYork,
  recordStocksHistoricalDailyPoints,
  updateStocksHistoryBackfillStatus,
  type StocksHistoricalDailyPoint,
} from "./stocks-performance-data.ts";

type EnvLike = Record<string, string | undefined>;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchLike = (
  input: string,
  init?: { cache?: string },
) => Promise<FetchResponse>;

type StocksHistoryStorage = {
  getCoverage: typeof getStocksHistoryCoverage;
  getBackfillStatus: typeof getStocksHistoryBackfillStatus;
  recordDailyPoints: typeof recordStocksHistoricalDailyPoints;
  updateBackfillStatus: typeof updateStocksHistoryBackfillStatus;
};

const defaultStorage: StocksHistoryStorage = {
  getCoverage: getStocksHistoryCoverage,
  getBackfillStatus: getStocksHistoryBackfillStatus,
  recordDailyPoints: recordStocksHistoricalDailyPoints,
  updateBackfillStatus: updateStocksHistoryBackfillStatus,
};

export type StocksHistoryBackfillResult = {
  ticker: string;
  status: "success" | "failed";
  provider: "yahoo" | "eodhd" | null;
  requestedFrom: string;
  requestedTo: string;
  recorded: number;
  error: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateAtNewYorkClose(marketDate: string) {
  const provisional = new Date(`${marketDate}T16:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(provisional);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const offset = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  ) - provisional.getTime();
  return new Date(
    Date.parse(`${marketDate}T16:00:00.000Z`) - offset,
  ).toISOString();
}

function dateFromUnixSeconds(value: unknown) {
  const seconds = numberValue(value);
  if (seconds === null) return null;
  return marketDateInNewYork(new Date(seconds * 1000).toISOString());
}

function eodhdApiKey(env: EnvLike) {
  for (const name of [
    "STOCKS_EODHD_API_KEYS",
    "STOCKS_EODHD_API_KEY",
    "EODHD_API_KEYS",
    "EODHD_API_KEY",
  ]) {
    const key = env[name]?.split(",").map((value) => value.trim()).find(Boolean);
    if (key) return key;
  }
  return "";
}

function yahooHistoryUrl(ticker: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    period1: String(Date.parse(`${startDate}T00:00:00.000Z`) / 1000),
    period2: String(Date.parse(`${endDate}T00:00:00.000Z`) / 1000),
    interval: "1d",
    events: "history",
    includeAdjustedClose: "true",
  });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`;
}

function eodhdHistoryUrl(
  ticker: string,
  apiKey: string,
  startDate: string,
  endDate: string,
) {
  const params = new URLSearchParams({
    api_token: apiKey,
    fmt: "json",
    period: "d",
    from: startDate,
    to: endDate,
  });
  return `https://eodhd.com/api/eod/${encodeURIComponent(ticker)}?${params.toString()}`;
}

function dateDaysBefore(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function maxDate(left: string, right: string) {
  return left >= right ? left : right;
}

function requestDelayMs(env: EnvLike) {
  const value = Math.floor(Number(env.STOCKS_HISTORY_REQUEST_DELAY_MS ?? 150));
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 30_000)) : 150;
}

async function delay(milliseconds: number) {
  if (milliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function parseYahooHistoricalDailyPoints(
  ticker: string,
  payload: unknown,
): StocksHistoricalDailyPoint[] {
  const normalizedTicker = normalizeTicker(ticker);
  const result = asRecord(asArray(asRecord(asRecord(payload).chart).result)[0]);
  const timestamps = asArray(result.timestamp);
  const indicators = asRecord(result.indicators);
  const quotes = asRecord(asArray(indicators.quote)[0]);
  const adjusted = asRecord(asArray(indicators.adjclose)[0]);
  const closes = asArray(quotes.close);
  const adjustedCloses = asArray(adjusted.adjclose);
  const points: StocksHistoricalDailyPoint[] = [];

  for (const [index, timestamp] of timestamps.entries()) {
    const marketDate = dateFromUnixSeconds(timestamp);
    const price = numberValue(adjustedCloses[index] ?? closes[index]);
    if (!normalizedTicker || !marketDate || price === null || price <= 0) continue;
    points.push({
      ticker: normalizedTicker,
      marketDate,
      capturedAt: dateAtNewYorkClose(marketDate),
      price,
      provider: "yahoo",
    });
  }

  return points.sort((left, right) => left.marketDate.localeCompare(right.marketDate));
}

export function parseEodhdHistoricalDailyPoints(
  ticker: string,
  payload: unknown,
): StocksHistoricalDailyPoint[] {
  const normalizedTicker = normalizeTicker(ticker);
  const points: StocksHistoricalDailyPoint[] = [];
  for (const value of asArray(payload)) {
    const row = asRecord(value);
    const marketDate = typeof row.date === "string" ? row.date : "";
    const price = numberValue(row.adjusted_close ?? row.close);
    if (!normalizedTicker || !isIsoDate(marketDate) || price === null || price <= 0) {
      continue;
    }
    points.push({
      ticker: normalizedTicker,
      marketDate,
      capturedAt: dateAtNewYorkClose(marketDate),
      price,
      provider: "eodhd",
    });
  }

  return points.sort((left, right) => left.marketDate.localeCompare(right.marketDate));
}

export async function backfillStocksHistory({
  tickers,
  startDate = ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  endDate = marketDateInNewYork(),
  env = process.env,
  dbPath,
  fetchImpl = fetch as FetchLike,
  storage = defaultStorage,
}: {
  tickers: string[];
  startDate?: string;
  endDate?: string;
  env?: EnvLike;
  dbPath?: string;
  fetchImpl?: FetchLike;
  storage?: StocksHistoryStorage;
}): Promise<StocksHistoryBackfillResult[]> {
  if (!isIsoDate(startDate)) throw new Error("startDate must be an ISO date");
  if (!isIsoDate(endDate)) throw new Error("endDate must be an ISO date");

  const normalizedTickers = Array.from(
    new Set(tickers.map(normalizeTicker).filter(Boolean)),
  );
  const results: StocksHistoryBackfillResult[] = [];

  for (const [index, ticker] of normalizedTickers.entries()) {
    if (index > 0) await delay(requestDelayMs(env));

    let requestedFrom = startDate;
    const attemptedAt = new Date().toISOString();
    let provider: "yahoo" | "eodhd" | null = null;
    let points: StocksHistoricalDailyPoint[] = [];
    const errors: string[] = [];

    try {
      const tickerCoverage = storage.getCoverage({
        tickers: [ticker],
        env,
        dbPath,
      })[ticker];
      const status = storage.getBackfillStatus({ ticker, env, dbPath });
      const hasFullCoverage =
        Boolean(status?.lastSuccessAt && status.coveredThroughDate) &&
        Boolean(tickerCoverage?.earliestMarketDate) &&
        tickerCoverage.earliestMarketDate! <= startDate;
      requestedFrom = hasFullCoverage && tickerCoverage.latestMarketDate
        ? maxDate(startDate, dateDaysBefore(tickerCoverage.latestMarketDate, 14))
        : startDate;

      try {
        const response = await fetchImpl(
          yahooHistoryUrl(ticker, requestedFrom, endDate),
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Yahoo history HTTP ${response.status}`);
        points = parseYahooHistoricalDailyPoints(ticker, await response.json());
        if (points.length === 0) throw new Error("Yahoo history returned no usable points");
        provider = "yahoo";
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      if (!provider) {
        try {
          const apiKey = eodhdApiKey(env);
          if (!apiKey) throw new Error("EODHD API key is not configured");
          const response = await fetchImpl(
            eodhdHistoryUrl(ticker, apiKey, requestedFrom, endDate),
            { cache: "no-store" },
          );
          if (!response.ok) throw new Error(`EODHD history HTTP ${response.status}`);
          points = parseEodhdHistoricalDailyPoints(ticker, await response.json());
          if (points.length === 0) throw new Error("EODHD history returned no usable points");
          provider = "eodhd";
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (!provider) throw new Error(errors.join("; ") || "No provider returned usable history");

      const { recorded } = storage.recordDailyPoints({ points, env, dbPath });
      const updatedCoverage = storage.getCoverage({ tickers: [ticker], env, dbPath })[ticker];
      storage.updateBackfillStatus({
        ticker,
        requestedStartDate: startDate,
        coveredThroughDate: updatedCoverage.latestMarketDate ?? undefined,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: attemptedAt,
        provider,
        status: "success",
        env,
        dbPath,
      });
      results.push({
        ticker,
        status: "success",
        provider,
        requestedFrom,
        requestedTo: endDate,
        recorded,
        error: null,
      });
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      try {
        storage.updateBackfillStatus({
          ticker,
          requestedStartDate: startDate,
          lastAttemptAt: attemptedAt,
          status: "failed",
          error: message,
          env,
          dbPath,
        });
      } catch (statusError) {
        message = `${message}; status update failed: ${
          statusError instanceof Error ? statusError.message : String(statusError)
        }`;
      }
      results.push({
        ticker,
        status: "failed",
        provider: null,
        requestedFrom,
        requestedTo: endDate,
        recorded: 0,
        error: message,
      });
    }
  }

  return results;
}
