import type {
  AlphaResearchFinancialSnapshot,
  AlphaResearchStock,
} from "./alpha-research-pool.ts";
import {
  getProviderApiKeys,
  pickProviderApiKey,
} from "./provider-api-keys.ts";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type EnvLike = Record<string, string | undefined>;

export type StocksFinancialDataSource = "live" | "mock";

export type StocksFinancialStatement = AlphaResearchFinancialSnapshot & {
  ticker: string;
  periodLabel: string;
  source: StocksFinancialDataSource;
  updatedAt: string;
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
  return candidates.slice(
    0,
    positiveInt(env.STOCKS_FMP_FINANCIAL_MAX_TICKERS, 8, candidates.length),
  );
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
  const entries: Array<readonly [string, StocksFinancialStatement] | null> =
    await Promise.all(
      providerStocks.map(async (stock, index) => {
        const apiKey = pickProviderApiKey(apiKeys, index);
        try {
          const [incomeResponse, cashFlowResponse, growthResponse, estimatesResponse] =
            await Promise.all([
              fetchImpl(
                fmpUrl("income-statement", stock.ticker, apiKey, {
                  period: "annual",
                  limit: "1",
                }),
                { cache: "no-store" },
              ),
              fetchImpl(
                fmpUrl("cash-flow-statement", stock.ticker, apiKey, {
                  period: "annual",
                  limit: "1",
                }),
                { cache: "no-store" },
              ),
              fetchImpl(
                fmpUrl("financial-growth", stock.ticker, apiKey, {
                  period: "annual",
                  limit: "1",
                }),
                { cache: "no-store" },
              ),
              fetchImpl(
                fmpUrl("analyst-estimates", stock.ticker, apiKey, {
                  period: "quarter",
                  limit: "1",
                }),
                { cache: "no-store" },
              ),
            ]);
          const endpointPayloads = await Promise.all([
            readFmpEndpointPayload("income-statement", incomeResponse),
            readFmpEndpointPayload("cash-flow-statement", cashFlowResponse),
            readFmpEndpointPayload("financial-growth", growthResponse),
            readFmpEndpointPayload("analyst-estimates", estimatesResponse),
          ]);
          const incomePayload = endpointPayloads[0];
          if (!incomePayload?.ok) {
            throw new Error(
              incomePayload
                ? `FMP ${incomePayload.endpoint} HTTP ${incomePayload.status}: ${incomePayload.summary}`
                : "FMP income-statement returned no payload",
            );
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
): AlphaResearchStock[] {
  if (!snapshot) return stocks;
  return stocks.map((stock) => {
    const financial = snapshot.financials[stock.ticker];
    if (!financial) return stock;
    return {
      ...stock,
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
      },
    };
  });
}
