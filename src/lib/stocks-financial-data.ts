import type {
  AlphaResearchFinancialSnapshot,
  AlphaResearchStock,
} from "./alpha-research-pool.ts";
import {
  getProviderApiKeys,
  pickProviderApiKey,
} from "./provider-api-keys.ts";
import { resolveEarningsStatus } from "./stocks-earnings.ts";
import {
  calculateComparisonMetric,
  matchesStocksEarningsFiscalPeriod,
  parseFmpQuarterlyEarningsHistory,
  type StocksEarningsComparison,
} from "./stocks-earnings-comparison.ts";
import {
  completeStocksEarningsComparison,
  mergeStocksEarningsFallbackCandidate,
  parseAlphaVantageEarningsCandidate,
  primeStocksEarningsFallbackPayload,
  type StocksEarningsFallbackBase,
  type StocksEarningsFallbackPayloadCache,
} from "./stocks-earnings-fallback.ts";
import type { StocksEarningsInsight } from "./stocks-earnings-insight.ts";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type EnvLike = Record<string, string | undefined>;

export type StocksFinancialDataSource = "live" | "mock";

export type StocksFinancialStatement = AlphaResearchFinancialSnapshot & {
  ticker: string;
  periodLabel: string;
  source: StocksFinancialDataSource;
  updatedAt: string;
  latestEarnings?: StocksEarningsComparison | null;
  earningsHistory?: StocksEarningsComparison[];
  earningsInsight?: StocksEarningsInsight | null;
};

export type StocksFinancialSnapshot = {
  generatedAt: string;
  source: StocksFinancialDataSource;
  provider: "fmp" | "yahoo" | "alpha-vantage" | "mock";
  financials: Record<string, StocksFinancialStatement>;
  errors: string[];
};

export type FmpFinancialPayload = {
  income: unknown;
  cashFlow: unknown;
  growth: unknown;
  estimates: unknown;
};

type FmpEndpointPayload = {
  endpoint: string;
  status: number;
  ok: boolean;
  payload: unknown;
  summary: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInt(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function formattedValue(value: unknown, fallback = "n/a") {
  const record = asRecord(value);
  if (typeof record.fmt === "string" && record.fmt.trim()) {
    return record.fmt.trim();
  }
  if (typeof record.raw === "string" && record.raw.trim()) {
    return record.raw.trim();
  }
  const raw = numberValue(record.raw);
  return raw === null ? fallback : String(raw);
}

function formattedPercent(value: unknown, fallback = "n/a") {
  const record = asRecord(value);
  if (typeof record.fmt === "string" && record.fmt.trim()) {
    return record.fmt.trim();
  }
  const raw = numberValue(record.raw);
  return raw === null ? fallback : `${(raw * 100).toFixed(1)}%`;
}

function formatLargeUsd(value: unknown, fallback = "n/a") {
  const raw = numberValue(value);
  if (raw === null) return fallback;
  const abs = Math.abs(raw);
  if (abs >= 1_000_000_000) return `$${(raw / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(raw / 1_000_000).toFixed(2)}M`;
  return `$${raw.toFixed(2)}`;
}

function formatPlainNumber(value: unknown, fallback = "n/a") {
  const raw = numberValue(value);
  return raw === null ? fallback : raw.toFixed(2);
}

function formatRawPercent(value: unknown, fallback = "n/a") {
  const raw = numberValue(value);
  return raw === null ? fallback : `${(raw * 100).toFixed(1)}%`;
}

function formatRatioPercent(numerator: unknown, denominator: unknown) {
  const top = numberValue(numerator);
  const bottom = numberValue(denominator);
  if (top === null || bottom === null || bottom === 0) return "n/a";
  return `${((top / bottom) * 100).toFixed(1)}%`;
}

function earningsDate(value: unknown) {
  const earnings = asRecord(value);
  const firstDate = asRecord(asArray(earnings.earningsDate)[0]);
  if (typeof firstDate.fmt === "string" && firstDate.fmt.trim()) {
    return firstDate.fmt.trim();
  }
  const raw = numberValue(firstDate.raw);
  if (raw === null) return "n/a";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date(raw * 1000));
}

function nextQuarterGuidance(earningsTrend: unknown) {
  const trends = asArray(asRecord(earningsTrend).trend);
  const nextQuarter =
    trends
      .map(asRecord)
      .find((trend) => trend.period === "0q" || trend.period === "+1q") ??
    asRecord(trends[0]);
  const earningsEstimate = asRecord(nextQuarter.earningsEstimate);
  const revenueEstimate = asRecord(nextQuarter.revenueEstimate);
  const eps = formattedValue(earningsEstimate.avg);
  const revenue = formattedValue(revenueEstimate.avg);

  if (eps === "n/a" && revenue === "n/a") return "No forward estimate";
  if (eps === "n/a") return `Next revenue ${revenue}`;
  if (revenue === "n/a") return `Next EPS ${eps}`;
  return `Next EPS ${eps} / Revenue ${revenue}`;
}

function yahooFinancialUrl(ticker: string) {
  const modules = [
    "financialData",
    "defaultKeyStatistics",
    "calendarEvents",
    "earningsTrend",
  ].join(",");
  return `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    ticker,
  )}?modules=${modules}`;
}

function fmpApiKeys(env: EnvLike) {
  return getProviderApiKeys(env, [
    "STOCKS_FMP_API_KEYS",
    "STOCKS_FMP_API_KEY",
    "FMP_API_KEYS",
    "FMP_API_KEY",
  ]);
}

function alphaVantageApiKey(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_API_KEY?.trim() ||
    env.ALPHA_VANTAGE_API_KEY?.trim() ||
    ""
  );
}

function shouldUseAlphaVantageFinancialFallback(env: EnvLike) {
  return (
    env.STOCKS_ALPHA_VANTAGE_FINANCIAL_FALLBACK_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

function configuredTickerSet(value: string | undefined) {
  const tickers = (value ?? "")
    .split(/[,;\s]+/)
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  return tickers.length > 0 ? new Set(tickers) : null;
}

function selectFmpFinancialStocks(stocks: AlphaResearchStock[], env: EnvLike) {
  const allowedTickers = configuredTickerSet(env.STOCKS_FMP_FINANCIAL_TICKERS);
  const excludedTickers = configuredTickerSet(
    env.STOCKS_FMP_FINANCIAL_EXCLUDE_TICKERS,
  );
  const candidates = stocks.filter((stock) => {
    const ticker = stock.ticker.trim().toUpperCase();
    if (allowedTickers && !allowedTickers.has(ticker)) return false;
    if (excludedTickers?.has(ticker)) return false;
    return true;
  });
  const configuredLimit = env.STOCKS_FMP_FINANCIAL_MAX_TICKERS?.trim();
  if (!configuredLimit) return candidates;
  return candidates.slice(0, positiveInt(configuredLimit, candidates.length, candidates.length));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function fmpUrl(
  endpoint: string,
  ticker: string,
  apiKey: string,
  params: Record<string, string> = {},
) {
  const search = new URLSearchParams({
    symbol: ticker,
    apikey: apiKey,
    ...params,
  });
  return `https://financialmodelingprep.com/stable/${endpoint}?${search.toString()}`;
}

function alphaVantageOverviewUrl(ticker: string, apiKey: string) {
  const search = new URLSearchParams({
    function: "OVERVIEW",
    symbol: ticker,
    apikey: apiKey,
  });
  return `https://www.alphavantage.co/query?${search.toString()}`;
}

function alphaVantageIncomeStatementUrl(ticker: string, apiKey: string) {
  const search = new URLSearchParams({
    function: "INCOME_STATEMENT",
    symbol: ticker,
    apikey: apiKey,
  });
  return `https://www.alphavantage.co/query?${search.toString()}`;
}

function truncateDiagnostic(value: string, maxLength = 140) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function fmpPayloadMessage(payload: unknown) {
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  const messageKeys = [
    "Error Message",
    "message",
    "error",
    "detail",
    "Information",
  ];
  for (const key of messageKeys) {
    const message = stringValue(record[key]);
    if (message) return message;
  }
  return "";
}

function summarizeFmpPayload(endpoint: string, payload: unknown) {
  if (Array.isArray(payload)) {
    const firstKeys = Object.keys(asRecord(payload[0])).slice(0, 8);
    return [
      `${endpoint} array length=${payload.length}`,
      firstKeys.length > 0 ? `keys=${firstKeys.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (typeof payload === "string") {
    return [
      `${endpoint} text length=${payload.length}`,
      payload.trim() ? `sample="${truncateDiagnostic(payload)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const record = asRecord(payload);
  const keys = Object.keys(record).slice(0, 8);
  if (keys.length > 0) {
    const message = fmpPayloadMessage(payload);
    return [
      `${endpoint} object keys=${keys.join(", ")}`,
      message ? `message="${truncateDiagnostic(message)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return payload === null ? `${endpoint} null` : `${endpoint} ${typeof payload}`;
}

async function readFmpEndpointPayload(
  endpoint: string,
  response: Response,
): Promise<FmpEndpointPayload> {
  const text = await response.text();
  let payload: unknown = text.length > 0 ? text : null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    payload,
    summary: summarizeFmpPayload(endpoint, payload),
  };
}

function fmpEndpointError(payload: FmpEndpointPayload) {
  return `FMP ${payload.endpoint} HTTP ${payload.status}: ${payload.summary}`;
}

function retryDelayMs(env: EnvLike, attempt: number) {
  const configured = Number(env.STOCKS_FMP_RETRY_BASE_MS);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : 300;
  return base * 3 ** attempt;
}

async function fetchFmpEndpointPayload({
  endpoint,
  ticker,
  apiKeys,
  tickerIndex,
  params,
  fetchImpl,
  env,
}: {
  endpoint: string;
  ticker: string;
  apiKeys: string[];
  tickerIndex: number;
  params: Record<string, string>;
  fetchImpl: FetchLike;
  env: EnvLike;
}): Promise<FmpEndpointPayload> {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const apiKey = pickProviderApiKey(apiKeys, tickerIndex + attempt);
    try {
      const response = await fetchImpl(fmpUrl(endpoint, ticker, apiKey, params), {
        cache: "no-store",
      });
      const payload = await readFmpEndpointPayload(endpoint, response);
      if (payload.ok) return payload;
      const retryable = payload.status === 429 || payload.status >= 500;
      const terminalPlanError = [401, 402, 403].includes(payload.status);
      if (terminalPlanError || !retryable || attempt === 2) return payload;
    } catch (error) {
      if (attempt === 2) {
        return {
          endpoint,
          status: 0,
          ok: false,
          payload: null,
          summary: `${endpoint} network error: ${truncateDiagnostic(
            error instanceof Error ? error.message : String(error),
          )}`,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(env, attempt)));
  }
  throw new Error(`Unreachable FMP retry state for ${endpoint}`);
}

export function parseYahooFinancialStatement(
  ticker: string,
  payload: unknown,
  { generatedAt = new Date().toISOString() } = {},
): StocksFinancialStatement | null {
  const quoteSummary = asRecord(asRecord(payload).quoteSummary);
  const result = asRecord(asArray(quoteSummary.result)[0]);
  if (Object.keys(result).length === 0) return null;

  const financialData = asRecord(result.financialData);
  const keyStats = asRecord(result.defaultKeyStatistics);
  const calendarEvents = asRecord(result.calendarEvents);

  const revenue = formattedValue(financialData.totalRevenue);
  const eps = formattedValue(keyStats.trailingEps);
  if (revenue === "n/a" && eps === "n/a") return null;

  return {
    ticker: ticker.trim().toUpperCase(),
    revenue,
    revenueYoY: formattedPercent(financialData.revenueGrowth),
    eps,
    grossMargin: formattedPercent(financialData.grossMargins),
    freeCashFlow: formattedValue(financialData.freeCashflow),
    nextEarningsDate: earningsDate(calendarEvents.earnings),
    guidance: nextQuarterGuidance(result.earningsTrend),
    periodLabel: "TTM / next quarter",
    source: "live",
    updatedAt: generatedAt,
  };
}

export function parseFmpFinancialStatement(
  ticker: string,
  payload: FmpFinancialPayload,
  { generatedAt = new Date().toISOString() } = {},
): StocksFinancialStatement | null {
  const income = asRecord(asArray(payload.income)[0]);
  if (Object.keys(income).length === 0) return null;
  const cashFlow = asRecord(asArray(payload.cashFlow)[0]);
  const growth = asRecord(asArray(payload.growth)[0]);
  const estimate = asRecord(asArray(payload.estimates)[0]);
  const revenue = formatLargeUsd(income.revenue);
  const eps = formatPlainNumber(income.eps ?? income.epsdiluted);
  if (revenue === "n/a" && eps === "n/a") return null;
  const estimateRevenue = formatLargeUsd(
    estimate.estimatedRevenueAvg ?? estimate.revenueAvg,
  );
  const estimateEps = formatPlainNumber(
    estimate.estimatedEpsAvg ?? estimate.epsAvg,
  );
  const guidance =
    estimateRevenue === "n/a" && estimateEps === "n/a"
      ? "No forward estimate"
      : estimateRevenue === "n/a"
        ? `Next EPS ${estimateEps}`
        : estimateEps === "n/a"
          ? `Next revenue ${estimateRevenue}`
          : `Next EPS ${estimateEps} / Revenue ${estimateRevenue}`;
  const fiscalYear = stringValue(income.fiscalYear);
  const period = stringValue(income.period);

  return {
    ticker: ticker.trim().toUpperCase(),
    revenue,
    revenueYoY: formatRawPercent(growth.revenueGrowth),
    eps,
    grossMargin: formatRawPercent(
      income.grossProfitRatio ?? income.grossMargin,
    ),
    freeCashFlow: formatLargeUsd(cashFlow.freeCashFlow),
    nextEarningsDate: stringValue(estimate.date) || "n/a",
    guidance,
    periodLabel: [period, fiscalYear].filter(Boolean).join(" ") || "FMP latest",
    source: "live",
    updatedAt: generatedAt,
  };
}

export function parseAlphaVantageFinancialStatement(
  ticker: string,
  payload: unknown,
  { generatedAt = new Date().toISOString() } = {},
): StocksFinancialStatement | null {
  const overview = asRecord(payload);
  const revenue = formatLargeUsd(overview.RevenueTTM);
  const eps = stringValue(overview.EPS) || "n/a";
  if (revenue === "n/a" && eps === "n/a") return null;
  const analystTarget = stringValue(overview.AnalystTargetPrice);

  return {
    ticker: ticker.trim().toUpperCase(),
    revenue,
    revenueYoY: formatRawPercent(overview.QuarterlyRevenueGrowthYOY),
    eps,
    grossMargin: formatRatioPercent(overview.GrossProfitTTM, overview.RevenueTTM),
    freeCashFlow: "n/a",
    nextEarningsDate: stringValue(overview.LatestQuarter) || "n/a",
    guidance:
      analystTarget && analystTarget !== "None"
        ? `Analyst target $${analystTarget}`
        : "No forward estimate",
    periodLabel: "TTM / Alpha Vantage overview",
    source: "live",
    updatedAt: generatedAt,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fiscalYearValue(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : null;
}

function quarterValue(value: unknown): StocksEarningsComparison["quarter"] | null {
  const normalized = stringValue(value).toUpperCase();
  return /^(Q1|Q2|Q3|Q4)$/.test(normalized)
    ? (normalized as StocksEarningsComparison["quarter"])
    : null;
}

function comparisonHasEarningsGaps(comparison: StocksEarningsComparison) {
  return [
    comparison.revenue.estimate,
    comparison.revenue.actual,
    comparison.netIncome.estimate,
    comparison.netIncome.actual,
  ].some((value) => value === null);
}

function sameEarningsPeriod(
  left: StocksEarningsComparison,
  right: StocksEarningsComparison,
) {
  return (
    left.ticker === right.ticker &&
    left.fiscalYear === right.fiscalYear &&
    left.quarter === right.quarter &&
    left.fiscalDateEnding === right.fiscalDateEnding
  );
}

function fallbackListingContext(stock: AlphaResearchStock) {
  const listing = stock.listing;
  return {
    market: listing?.market,
    exchange: listing?.exchange,
  };
}

function fmpComparisonFallbackBase(
  stock: AlphaResearchStock,
  comparison: StocksEarningsComparison,
  income: JsonRecord,
  announcementWindow?: { from: string; to: string },
): StocksEarningsFallbackBase | null {
  const currency =
    stringValue(income.reportedCurrency) ||
    stringValue(income.currency) ||
    stringValue(income.financialCurrency);
  if (!currency) return null;
  const dilutedShares = numberValue(
    income.weightedAverageShsOutDil ??
      income.weightedAverageShsOutDiluted ??
      income.dilutedAverageShares ??
      income.dilutedShares,
  );
  const { market, exchange } = fallbackListingContext(stock);
  return {
    ticker: comparison.ticker,
    fiscalYear: comparison.fiscalYear,
    quarter: comparison.quarter,
    fiscalDateEnding: comparison.fiscalDateEnding,
    reportDate: comparison.reportDate,
    reportTiming: comparison.reportTiming,
    currency: currency.toUpperCase(),
    market,
    exchange,
    announcementWindow,
    provider: "fmp",
    revenueActual: comparison.revenue.actual,
    revenueEstimate: comparison.revenue.estimate,
    revenueUnit: "raw",
    netIncomeActual: comparison.netIncome.actual,
    netIncomeEstimate: comparison.netIncome.estimate,
    netIncomeUnit: "raw",
    epsActual: numberValue(income.eps ?? income.epsdiluted),
    epsEstimate: null,
    epsCurrency: currency.toUpperCase(),
    epsUnit: "per-share",
    dilutedShares,
    dilutedSharesUnit: dilutedShares === null ? null : "shares",
    comparison,
  };
}

async function completeFmpEarningsComparison({
  stock,
  comparison,
  income,
  alphaIncomePayload,
  announcementWindow,
  payloadCache,
  fetchImpl,
  env,
}: {
  stock: AlphaResearchStock;
  comparison: StocksEarningsComparison;
  income: JsonRecord;
  alphaIncomePayload?: unknown;
  announcementWindow?: { from: string; to: string };
  payloadCache?: StocksEarningsFallbackPayloadCache;
  fetchImpl: FetchLike;
  env: EnvLike;
}) {
  if (!comparisonHasEarningsGaps(comparison)) {
    return { comparison, errors: [] as string[] };
  }
  const base = fmpComparisonFallbackBase(
    stock,
    comparison,
    income,
    announcementWindow,
  );
  if (!base) {
    return {
      comparison,
      errors: ["earnings fallback skipped: FMP currency is unavailable"],
    };
  }
  const alphaCandidate = alphaIncomePayload
    ? parseAlphaVantageEarningsCandidate(
        { incomeStatement: alphaIncomePayload, earningsEstimates: null },
        base,
      )
    : null;
  const baseWithDerivedEps = mergeStocksEarningsFallbackCandidate(base, base);
  const completedBase = alphaCandidate
    ? mergeStocksEarningsFallbackCandidate(baseWithDerivedEps, alphaCandidate)
    : baseWithDerivedEps;
  try {
    return await completeStocksEarningsComparison({
      ticker: stock.ticker,
      base: completedBase,
      fetchImpl,
      env,
      payloadCache,
    });
  } catch {
    return {
      comparison,
      errors: ["earnings fallback request failed"],
    };
  }
}

function matchingFmpIncome(
  comparison: StocksEarningsComparison,
  incomePayload: unknown,
) {
  return (
    asArray(incomePayload)
      .map(asRecord)
      .find((income) =>
        matchesStocksEarningsFiscalPeriod(income, comparison),
      ) ?? null
  );
}

function addUtcDays(dateValue: string, days: number) {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function finnhubAnnouncementWindowForHistory(
  history: StocksEarningsComparison[],
) {
  const windows = history
    .map((comparison) =>
      comparison.reportDate
        ? { from: comparison.reportDate, to: comparison.reportDate }
        : {
            from: addUtcDays(comparison.fiscalDateEnding, 14),
            to: addUtcDays(comparison.fiscalDateEnding, 120),
          },
    )
    .filter((window) => window.from && window.to);
  if (windows.length === 0) return undefined;
  return {
    from: windows.map((window) => window.from).sort()[0],
    to: windows.map((window) => window.to).sort().at(-1) as string,
  };
}

function alphaVantageRecoverySeed(
  ticker: string,
  payload: unknown,
  earningsPayload: unknown,
  generatedAt: string,
) {
  const earningsRows = asArray(earningsPayload).map(asRecord);
  const income = asArray(asRecord(payload).quarterlyReports)
    .map(asRecord)
    .map((row) => {
      const fiscalDateEnding = stringValue(row.fiscalDateEnding);
      const parsedDate = Date.parse(`${fiscalDateEnding}T00:00:00Z`);
      if (!fiscalDateEnding || !Number.isFinite(parsedDate)) return null;
      const derivedDate = new Date(parsedDate);
      const derivedFiscalYear = derivedDate.getUTCFullYear();
      const derivedQuarter = `Q${Math.floor(derivedDate.getUTCMonth() / 3) + 1}` as
        StocksEarningsComparison["quarter"];
      const nearestEarnings = earningsRows
        .map((earnings) => {
          const earningsDate =
            stringValue(earnings.fiscalDateEnding) ||
            stringValue(earnings.fiscalDate);
          const earningsTime = Date.parse(`${earningsDate}T00:00:00Z`);
          return {
            earnings,
            distance:
              Number.isFinite(earningsTime)
                ? Math.abs(parsedDate - earningsTime) / 86_400_000
                : Infinity,
          };
        })
        .filter((candidate) => candidate.distance <= 7)
        .sort((left, right) => left.distance - right.distance)[0]?.earnings;
      const rowFiscalYear = fiscalYearValue(row.fiscalYear);
      const earningsFiscalYear = fiscalYearValue(nearestEarnings?.fiscalYear);
      const rowQuarter = quarterValue(row.quarter ?? row.period);
      const earningsQuarter = quarterValue(
        nearestEarnings?.quarter ?? nearestEarnings?.period,
      );
      if (
        (rowFiscalYear !== null &&
          earningsFiscalYear !== null &&
          rowFiscalYear !== earningsFiscalYear) ||
        (rowQuarter !== null &&
          earningsQuarter !== null &&
          rowQuarter !== earningsQuarter)
      ) {
        return null;
      }
      const fiscalYear =
        rowFiscalYear ?? earningsFiscalYear ?? derivedFiscalYear;
      const quarter = rowQuarter ?? earningsQuarter ?? derivedQuarter;
      const currency =
        stringValue(row.reportedCurrency) ||
        stringValue(row.currency) ||
        stringValue(row.financialCurrency);
      const target = { fiscalYear, quarter, fiscalDateEnding };
      if (
        !currency ||
        !matchesStocksEarningsFiscalPeriod(row, target) ||
        (nearestEarnings &&
          !matchesStocksEarningsFiscalPeriod(nearestEarnings, target, {
            dateFields: "fiscal-only",
          }))
      ) {
        return null;
      }
      return {
        row,
        earnings: nearestEarnings,
        fiscalYear,
        quarter,
        fiscalDateEnding,
        currency,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort(
      (left, right) =>
        Date.parse(right.fiscalDateEnding) - Date.parse(left.fiscalDateEnding),
    )[0];
  if (!income) return null;

  const earnings = income.earnings;
  const comparison: StocksEarningsComparison = {
    ticker: ticker.trim().toUpperCase(),
    fiscalYear: income.fiscalYear,
    quarter: income.quarter,
    fiscalDateEnding: income.fiscalDateEnding,
    reportDate: earnings ? stringValue(earnings.date) || null : null,
    reportTiming:
      stringValue(earnings?.time).toLowerCase() === "bmo"
        ? "before-market"
        : stringValue(earnings?.time).toLowerCase() === "amc"
          ? "after-market"
          : "unknown",
    currency: income.currency.toUpperCase(),
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt,
    revenue: calculateComparisonMetric(null, null, null),
    netIncome: calculateComparisonMetric(null, null, null),
  };
  return { comparison, income: income.row };
}

async function recoverFmpEarningsFromAlphaVantage({
  stock,
  earningsPayload,
  fetchImpl,
  env,
  generatedAt,
  payloadCache,
}: {
  stock: AlphaResearchStock;
  earningsPayload: unknown;
  fetchImpl: FetchLike;
  env: EnvLike;
  generatedAt: string;
  payloadCache?: StocksEarningsFallbackPayloadCache;
}) {
  const apiKey = alphaVantageApiKey(env);
  if (!apiKey) return { statement: null, errors: [] as string[] };
  try {
    const response = await fetchImpl(
      alphaVantageIncomeStatementUrl(stock.ticker, apiKey),
      { cache: "no-store" },
    );
    if (!response.ok) {
      return {
        statement: null,
        errors: [`alpha-vantage INCOME_STATEMENT HTTP ${response.status}`],
      };
    }
    const payload = await response.json();
    primeStocksEarningsFallbackPayload(
      payloadCache,
      stock.ticker,
      "alpha-vantage-income",
      payload,
    );
    const seed = alphaVantageRecoverySeed(
      stock.ticker,
      payload,
      earningsPayload,
      generatedAt,
    );
    if (!seed) {
      return {
        statement: null,
        errors: ["alpha-vantage INCOME_STATEMENT returned no period-safe quarter"],
      };
    }
    const completed = await completeFmpEarningsComparison({
      stock,
      comparison: seed.comparison,
      income: seed.income,
      alphaIncomePayload: payload,
      payloadCache,
      fetchImpl,
      env,
    });
    const comparison = completed.comparison;
    if (comparison.revenue.actual === null && comparison.netIncome.actual === null) {
      return { statement: null, errors: completed.errors };
    }
    return {
      statement: {
        ticker: stock.ticker.trim().toUpperCase(),
        revenue: formatLargeUsd(comparison.revenue.actual),
        revenueYoY: "n/a",
        eps: "n/a",
        grossMargin: "n/a",
        freeCashFlow: "n/a",
        nextEarningsDate: comparison.reportDate ?? "n/a",
        guidance: "No forward estimate",
        periodLabel: `${comparison.quarter} ${comparison.fiscalYear}`,
        source: "live" as const,
        updatedAt: generatedAt,
        latestEarnings: comparison,
        earningsHistory: [comparison],
      },
      errors: completed.errors,
    };
  } catch {
    return {
      statement: null,
      errors: ["alpha-vantage INCOME_STATEMENT request failed"],
    };
  }
}

export function buildMockStocksFinancialSnapshot(
  stocks: AlphaResearchStock[],
): StocksFinancialSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    source: "mock",
    provider: "mock",
    errors: [],
    financials: Object.fromEntries(
      stocks.map((stock) => [
        stock.ticker,
        {
          ticker: stock.ticker,
          ...stock.financialSnapshot,
          periodLabel: stock.financialSnapshot.periodLabel ?? "Mock baseline",
          source: "mock" as const,
          updatedAt: generatedAt,
        },
      ]),
    ),
  };
}

export async function fetchYahooStocksFinancialSnapshot({
  tickers,
  fetchImpl = fetch,
}: {
  tickers: string[];
  fetchImpl?: FetchLike;
}): Promise<StocksFinancialSnapshot> {
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];
  const entries: Array<readonly [string, StocksFinancialStatement] | null> =
    await Promise.all(
      normalizedTickers.map(async (ticker) => {
        try {
          const response = await fetchImpl(yahooFinancialUrl(ticker), {
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(`Yahoo financials HTTP ${response.status}`);
          }
          const statement = parseYahooFinancialStatement(
            ticker,
            await response.json(),
            { generatedAt },
          );
          if (!statement) {
            throw new Error("Yahoo financials returned no usable statement");
          }
          return [ticker, statement] as const;
        } catch (error) {
          errors.push(
            `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );

  const financialEntries = entries.filter(
    (entry): entry is readonly [string, StocksFinancialStatement] =>
      entry !== null,
  );
  const financials = Object.fromEntries(financialEntries);
  if (Object.keys(financials).length === 0) {
    throw new Error("Yahoo financials returned no usable statements");
  }

  return {
    generatedAt,
    source: "live",
    provider: "yahoo",
    errors,
    financials,
  };
}

export async function fetchFmpStocksFinancialSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksFinancialSnapshot> {
  const apiKeys = fmpApiKeys(env);
  if (apiKeys.length === 0) throw new Error("FMP API key is not configured");
  const generatedAt = new Date().toISOString();
  const providerStocks = selectFmpFinancialStocks(stocks, env);
  const errors: string[] = [];
  const earningsFallbackPayloadCache: StocksEarningsFallbackPayloadCache = new Map();
  const concurrency = positiveInt(
    env.STOCKS_FMP_FINANCIAL_CONCURRENCY,
    3,
    8,
  );
  const entries: Array<readonly [string, StocksFinancialStatement] | null> =
    await mapWithConcurrency(
      providerStocks,
      concurrency,
      async (stock, index) => {
        try {
          const endpointPayloads =
            await Promise.all([
              fetchFmpEndpointPayload({
                endpoint: "income-statement",
                ticker: stock.ticker,
                apiKeys,
                tickerIndex: index,
                // Five quarters are enough for the latest YoY comparison and
                // stay within FMP's standard-plan parameter limit.
                params: { period: "quarter", limit: "5" },
                fetchImpl,
                env,
              }),
              fetchFmpEndpointPayload({
                endpoint: "cash-flow-statement",
                ticker: stock.ticker,
                apiKeys,
                tickerIndex: index,
                params: {
                  period: "annual",
                  limit: "1",
                },
                fetchImpl,
                env,
              }),
              fetchFmpEndpointPayload({
                endpoint: "financial-growth",
                ticker: stock.ticker,
                apiKeys,
                tickerIndex: index,
                params: {
                  period: "annual",
                  limit: "1",
                },
                fetchImpl,
                env,
              }),
              fetchFmpEndpointPayload({
                endpoint: "analyst-estimates",
                ticker: stock.ticker,
                apiKeys,
                tickerIndex: index,
                params: { period: "quarter", limit: "5" },
                fetchImpl,
                env,
              }),
              fetchFmpEndpointPayload({
                endpoint: "earnings",
                ticker: stock.ticker,
                apiKeys,
                tickerIndex: index,
                params: { limit: "5" },
                fetchImpl,
                env,
              }),
            ]);
          const incomePayload = endpointPayloads[0];
          if (!incomePayload?.ok) {
            errors.push(
              `${stock.ticker}: ${
                incomePayload
                  ? fmpEndpointError(incomePayload)
                  : "FMP income-statement returned no payload"
              }`,
            );
          }
          endpointPayloads.slice(1).forEach((payload) => {
            if (!payload.ok) {
              errors.push(`${stock.ticker}: ${fmpEndpointError(payload)}`);
            }
          });
          if (!incomePayload?.ok) {
            const recovered = await recoverFmpEarningsFromAlphaVantage({
              stock,
              earningsPayload: endpointPayloads[4]?.ok
                ? endpointPayloads[4].payload
                : [],
              fetchImpl,
              env,
              generatedAt,
              payloadCache: earningsFallbackPayloadCache,
            });
            if (recovered.statement) {
              errors.push(
                ...recovered.errors.map((error) => `${stock.ticker}: ${error}`),
              );
              return [stock.ticker, recovered.statement] as const;
            }
            errors.push(
              ...recovered.errors.map((error) => `${stock.ticker}: ${error}`),
            );
            throw new Error("FMP income-statement recovery failed");
          }
          const statement = parseFmpFinancialStatement(
            stock.ticker,
            {
              income: incomePayload.payload,
              cashFlow: endpointPayloads[1]?.ok ? endpointPayloads[1].payload : [],
              growth: endpointPayloads[2]?.ok ? endpointPayloads[2].payload : [],
              estimates: endpointPayloads[3]?.ok ? endpointPayloads[3].payload : [],
            },
            { generatedAt },
          );
          if (!statement) {
            throw new Error(
              `FMP financials returned no usable statement: ${endpointPayloads
                .map((payload) => payload.summary)
                .join("; ")}`,
            );
          }
          const earningsHistory = parseFmpQuarterlyEarningsHistory(
            stock.ticker,
            {
              income: incomePayload.payload,
              estimates: endpointPayloads[3]?.ok
                ? endpointPayloads[3].payload
                : [],
              earnings: endpointPayloads[4]?.ok
                ? endpointPayloads[4].payload
                : [],
            },
            { generatedAt, limit: 8 },
          );
          const latestEarnings = earningsHistory[0] ?? null;
          if (latestEarnings) {
            const completedHistory: StocksEarningsComparison[] = [];
            const announcementWindow =
              finnhubAnnouncementWindowForHistory(earningsHistory);
            for (const comparison of earningsHistory) {
              const completed = await completeFmpEarningsComparison({
                stock,
                comparison,
                income: matchingFmpIncome(comparison, incomePayload.payload) ?? {},
                announcementWindow,
                fetchImpl,
                env,
                payloadCache: earningsFallbackPayloadCache,
              });
              errors.push(
                ...completed.errors.map((error) => `${stock.ticker}: ${error}`),
              );
              completedHistory.push(completed.comparison);
            }
            const completedLatest =
              completedHistory.find((comparison) =>
                sameEarningsPeriod(comparison, latestEarnings),
              ) ?? latestEarnings;
            return [
              stock.ticker,
              {
                ...statement,
                latestEarnings: completedLatest,
                earningsHistory: completedHistory,
              },
            ] as const;
          }
          return [
            stock.ticker,
            {
              ...statement,
              latestEarnings,
              earningsHistory,
            },
          ] as const;
        } catch (error) {
          errors.push(
            `${stock.ticker}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      },
    );

  const financialEntries = entries.filter(
    (entry): entry is readonly [string, StocksFinancialStatement] =>
      entry !== null,
  );
  const financials = Object.fromEntries(financialEntries);
  if (Object.keys(financials).length === 0) {
    const details = errors.join(" | ");
    throw new Error(
      details
        ? `FMP financials returned no usable statements: ${details}`
        : "FMP financials returned no usable statements",
    );
  }

  return {
    generatedAt,
    source: "live",
    provider: "fmp",
    errors,
    financials,
  };
}

export async function fetchAlphaVantageStocksFinancialSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<StocksFinancialSnapshot> {
  const apiKey = alphaVantageApiKey(env);
  if (!apiKey) throw new Error("Alpha Vantage API key is not configured");
  const generatedAt = new Date().toISOString();
  const providerStocks = stocks.slice(
    0,
    positiveInt(env.STOCKS_ALPHA_VANTAGE_FINANCIAL_MAX_TICKERS, 3, stocks.length),
  );
  const errors: string[] = [];
  const entries: Array<readonly [string, StocksFinancialStatement] | null> =
    await Promise.all(
      providerStocks.map(async (stock) => {
        try {
          const response = await fetchImpl(
            alphaVantageOverviewUrl(stock.ticker, apiKey),
            { cache: "no-store" },
          );
          if (!response.ok) {
            throw new Error(`Alpha Vantage overview HTTP ${response.status}`);
          }
          const payload = await response.json();
          const message = fmpPayloadMessage(payload);
          if (message) throw new Error(message);
          const statement = parseAlphaVantageFinancialStatement(
            stock.ticker,
            payload,
            { generatedAt },
          );
          if (!statement) {
            throw new Error("Alpha Vantage overview returned no usable statement");
          }
          return [stock.ticker, statement] as const;
        } catch (error) {
          errors.push(
            `${stock.ticker}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );

  const financialEntries = entries.filter(
    (entry): entry is readonly [string, StocksFinancialStatement] =>
      entry !== null,
  );
  const financials = Object.fromEntries(financialEntries);
  if (Object.keys(financials).length === 0) {
    const details = errors.slice(0, 3).join(" | ");
    throw new Error(
      details
        ? `Alpha Vantage financials returned no usable statements: ${details}`
        : "Alpha Vantage financials returned no usable statements",
    );
  }

  return {
    generatedAt,
    source: "live",
    provider: "alpha-vantage",
    errors,
    financials,
  };
}

export async function getStocksFinancialSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  provider = "yahoo",
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  provider?: "fmp" | "yahoo" | "alpha-vantage" | "mock";
}): Promise<StocksFinancialSnapshot> {
  if (provider === "mock") return buildMockStocksFinancialSnapshot(stocks);
  const errors: string[] = [];
  try {
    if (provider === "fmp") {
      return await fetchFmpStocksFinancialSnapshot({ stocks, fetchImpl, env });
    }
    if (provider === "alpha-vantage") {
      return await fetchAlphaVantageStocksFinancialSnapshot({
        stocks,
        fetchImpl,
        env,
      });
    }
    return await fetchYahooStocksFinancialSnapshot({
      tickers: stocks.map((stock) => stock.ticker),
      fetchImpl,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    if (provider === "fmp") {
      try {
        const yahooSnapshot = await fetchYahooStocksFinancialSnapshot({
          tickers: stocks.map((stock) => stock.ticker),
          fetchImpl,
        });
        return {
          ...yahooSnapshot,
          errors: [...errors, ...yahooSnapshot.errors],
        };
      } catch (yahooError) {
        errors.push(
          yahooError instanceof Error ? yahooError.message : String(yahooError),
        );
      }
    }
    if (
      provider !== "alpha-vantage" &&
      alphaVantageApiKey(env) &&
      shouldUseAlphaVantageFinancialFallback(env)
    ) {
      try {
        const alphaVantageSnapshot = await fetchAlphaVantageStocksFinancialSnapshot({
          stocks,
          fetchImpl,
          env,
        });
        return {
          ...alphaVantageSnapshot,
          errors: [...errors, ...alphaVantageSnapshot.errors],
        };
      } catch (alphaVantageError) {
        errors.push(
          alphaVantageError instanceof Error
            ? alphaVantageError.message
            : String(alphaVantageError),
        );
      }
    }
    const fallback = buildMockStocksFinancialSnapshot(stocks);
    return {
      ...fallback,
      errors,
    };
  }
}

export function mergeStocksFinancialSnapshot(
  stocks: AlphaResearchStock[],
  snapshot: StocksFinancialSnapshot | null,
  now = new Date(),
): AlphaResearchStock[] {
  if (!snapshot) return stocks;
  return stocks.map((stock) => {
    const financial = snapshot.financials[stock.ticker];
    if (!financial) return stock;
    return {
      ...stock,
      market: {
        ...stock.market,
        earningsStatus: resolveEarningsStatus(
          financial.nextEarningsDate,
          now,
          stock.market.earningsStatus,
        ),
      },
      financialSnapshot: {
        revenue: financial.revenue,
        revenueYoY: financial.revenueYoY,
        eps: financial.eps,
        grossMargin: financial.grossMargin,
        freeCashFlow: financial.freeCashFlow,
        nextEarningsDate: financial.nextEarningsDate,
        guidance: financial.guidance,
        periodLabel: financial.periodLabel,
        source: financial.source,
        updatedAt: financial.updatedAt,
        latestEarnings: financial.latestEarnings ?? null,
        earningsHistory: financial.earningsHistory ?? [],
        earningsInsight: financial.earningsInsight ?? null,
      },
    };
  });
}
