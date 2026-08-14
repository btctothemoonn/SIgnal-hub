import { getProviderApiKeys } from "./provider-api-keys.ts";
import {
  mergeEarningsMetricValues,
  type StocksEarningsComparison,
  type StocksEarningsProvider,
  type StocksEarningsValueProvenance,
} from "./stocks-earnings-comparison.ts";

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StocksEarningsFallbackTarget = {
  ticker: string;
  fiscalYear: number;
  quarter: `Q${1 | 2 | 3 | 4}`;
  fiscalDateEnding: string;
  reportDate: string | null;
  reportTiming: "before-market" | "after-market" | "unknown";
  currency: string;
};

export type StocksEarningsFallbackCandidate = StocksEarningsFallbackTarget & {
  provider: StocksEarningsProvider;
  revenueActual: number | null;
  revenueEstimate: number | null;
  netIncomeActual: number | null;
  netIncomeEstimate: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  dilutedShares: number | null;
};

export type StocksEarningsFallbackBase = StocksEarningsFallbackCandidate & {
  comparison: StocksEarningsComparison;
};

type FallbackResult = {
  comparison: StocksEarningsComparison;
  errors: string[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordNumber(record: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = numberValue(record[name]);
    if (value !== null) return value;
  }
  return null;
}

function quarterValue(value: unknown) {
  const match = String(value ?? "").trim().toUpperCase().match(/^Q?([1-4])$/);
  return match ? (`Q${match[1]}` as StocksEarningsFallbackTarget["quarter"]) : null;
}

function dateValue(record: JsonRecord) {
  return (
    stringValue(record.fiscalDateEnding) ||
    stringValue(record.fiscalDate) ||
    stringValue(record.date)
  );
}

function hasMatchingFiscalIdentity(
  record: JsonRecord,
  target: StocksEarningsFallbackTarget,
  { useDate = true }: { useDate?: boolean } = {},
) {
  const fiscalYear = recordNumber(record, ["fiscalYear", "year"]);
  const quarter = quarterValue(record.quarter ?? record.period);
  const fiscalDateEnding = useDate ? dateValue(record) : "";
  if (fiscalYear !== null && fiscalYear !== target.fiscalYear) return false;
  if (quarter !== null && quarter !== target.quarter) return false;
  if (fiscalDateEnding && fiscalDateEnding !== target.fiscalDateEnding) return false;
  return (
    (fiscalYear === target.fiscalYear && quarter === target.quarter) ||
    fiscalDateEnding === target.fiscalDateEnding
  );
}

function reportTiming(value: unknown): StocksEarningsFallbackTarget["reportTiming"] {
  const normalized = stringValue(value).toLowerCase();
  if (["bmo", "before market open", "before-market"].includes(normalized)) {
    return "before-market";
  }
  if (["amc", "after market close", "after-market"].includes(normalized)) {
    return "after-market";
  }
  return "unknown";
}

function emptyCandidate(
  target: StocksEarningsFallbackTarget,
  provider: StocksEarningsProvider,
): StocksEarningsFallbackCandidate {
  return {
    ...target,
    provider,
    revenueActual: null,
    revenueEstimate: null,
    netIncomeActual: null,
    netIncomeEstimate: null,
    epsActual: null,
    epsEstimate: null,
    dilutedShares: null,
  };
}

function candidateFromRecord(
  target: StocksEarningsFallbackTarget,
  provider: StocksEarningsProvider,
  record: JsonRecord,
  values: Partial<StocksEarningsFallbackCandidate>,
) {
  return {
    ...emptyCandidate(target, provider),
    ...values,
    reportDate: stringValue(record.date) || target.reportDate,
    reportTiming: reportTiming(record.hour ?? record.time) || target.reportTiming,
  };
}

export function parseFinnhubEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const rows = asArray(asRecord(payload).earningsCalendar).map(asRecord);
  const ticker = target.ticker.trim().toUpperCase();
  const row = rows.find(
    (entry) =>
      (!stringValue(entry.symbol) || stringValue(entry.symbol).toUpperCase() === ticker) &&
      hasMatchingFiscalIdentity(entry, target, { useDate: false }),
  );
  if (!row) return null;
  return candidateFromRecord(target, "finnhub", row, {
    revenueActual: recordNumber(row, ["revenueActual"]),
    revenueEstimate: recordNumber(row, ["revenueEstimate"]),
    epsActual: recordNumber(row, ["epsActual"]),
    epsEstimate: recordNumber(row, ["epsEstimate"]),
  });
}

export function parseEodhdEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const parsed = asRecord(payload);
  const rows = asArray(parsed.trends ?? parsed.data ?? parsed.results).map(asRecord);
  const row = rows.find((entry) => hasMatchingFiscalIdentity(entry, target));
  if (!row) return null;
  return candidateFromRecord(target, "eodhd", row, {
    revenueEstimate: recordNumber(row, [
      "revenueEstimate",
      "revenueAvg",
      "estimatedRevenueAvg",
    ]),
    epsEstimate: recordNumber(row, ["epsEstimate", "epsAvg", "estimatedEpsAvg"]),
  });
}

function alphaQuarterlyReports(payload: unknown) {
  const record = asRecord(payload);
  return asArray(record.quarterlyReports ?? record.data).map(asRecord);
}

export function parseAlphaVantageEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const parsed = asRecord(payload);
  const incomeRows = alphaQuarterlyReports(parsed.incomeStatement);
  const estimateRows = alphaQuarterlyReports(parsed.earningsEstimates);
  const income = incomeRows.find((row) => hasMatchingFiscalIdentity(row, target));
  const estimate = estimateRows.find((row) => hasMatchingFiscalIdentity(row, target));
  if (!income && !estimate) return null;
  return candidateFromRecord(target, "alpha-vantage", income ?? estimate ?? {}, {
    revenueActual: income
      ? recordNumber(income, ["totalRevenue", "revenue"])
      : null,
    netIncomeActual: income ? recordNumber(income, ["netIncome"]) : null,
    epsActual: income ? recordNumber(income, ["reportedEPS", "eps"]) : null,
    revenueEstimate: estimate
      ? recordNumber(estimate, ["estimatedRevenue", "revenueEstimate"])
      : null,
    epsEstimate: estimate
      ? recordNumber(estimate, ["estimatedEPS", "epsEstimate"])
      : null,
  });
}

function parseYahooEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const result = asArray(asRecord(asRecord(payload).quoteSummary).result)[0];
  const history = asRecord(asRecord(result).incomeStatementHistoryQuarterly);
  const rows = asArray(history.incomeStatementHistory).map(asRecord);
  const row = rows.find((entry) => hasMatchingFiscalIdentity(entry, target));
  if (!row) return null;
  return candidateFromRecord(target, "yahoo", row, {
    revenueActual: recordNumber(asRecord(row.totalRevenue), ["raw"]),
    netIncomeActual: recordNumber(asRecord(row.netIncome), ["raw"]),
  });
}

export function deriveNetIncome(
  epsConsensus: number | null,
  dilutedShares: number | null,
) {
  if (epsConsensus === null || dilutedShares === null) return null;
  return epsConsensus * dilutedShares;
}

function provenance(
  provider: StocksEarningsProvider,
  method: StocksEarningsValueProvenance["method"],
): StocksEarningsValueProvenance {
  if (method === "eps-times-diluted-shares") {
    return {
      provider,
      method,
      accountingBasis: "Derived from EPS times diluted shares",
    };
  }
  const accountingBasis =
    provider === "finnhub"
      ? "Finnhub consensus"
      : provider === "eodhd"
        ? "EODHD consensus"
        : provider === "alpha-vantage"
          ? "Alpha Vantage reported/consensus"
          : provider === "yahoo"
            ? "Yahoo Finance reported"
            : "FMP standardized";
  return { provider, method, accountingBasis };
}

function canUseDirectValue(
  current: number | null,
  source: StocksEarningsValueProvenance | undefined,
  candidate: number | null,
) {
  return (
    candidate !== null &&
    (current === null || source?.method === "eps-times-diluted-shares")
  );
}

export function mergeStocksEarningsFallbackCandidate(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
): StocksEarningsFallbackBase {
  if (!hasMatchingFiscalIdentity(candidate, base)) return base;

  const revenuePatch: Parameters<typeof mergeEarningsMetricValues>[1] = {};
  const netIncomePatch: Parameters<typeof mergeEarningsMetricValues>[1] = {};
  const directSource = provenance(candidate.provider, "direct");

  if (
    canUseDirectValue(
      base.comparison.revenue.actual,
      base.comparison.revenue.actualSource,
      candidate.revenueActual,
    )
  ) {
    revenuePatch.actual = candidate.revenueActual;
    revenuePatch.actualSource = directSource;
  }
  if (
    canUseDirectValue(
      base.comparison.revenue.estimate,
      base.comparison.revenue.estimateSource,
      candidate.revenueEstimate,
    )
  ) {
    revenuePatch.estimate = candidate.revenueEstimate;
    revenuePatch.estimateSource = directSource;
  }
  if (
    canUseDirectValue(
      base.comparison.netIncome.actual,
      base.comparison.netIncome.actualSource,
      candidate.netIncomeActual,
    )
  ) {
    netIncomePatch.actual = candidate.netIncomeActual;
    netIncomePatch.actualSource = directSource;
  }

  const derivedNetIncome =
    candidate.netIncomeEstimate ??
    deriveNetIncome(candidate.epsEstimate, candidate.dilutedShares ?? base.dilutedShares);
  if (candidate.netIncomeEstimate !== null) {
    if (
      canUseDirectValue(
        base.comparison.netIncome.estimate,
        base.comparison.netIncome.estimateSource,
        candidate.netIncomeEstimate,
      )
    ) {
      netIncomePatch.estimate = candidate.netIncomeEstimate;
      netIncomePatch.estimateSource = directSource;
    }
  } else if (base.comparison.netIncome.estimate === null && derivedNetIncome !== null) {
    netIncomePatch.estimate = derivedNetIncome;
    netIncomePatch.estimateSource = provenance(
      candidate.provider,
      "eps-times-diluted-shares",
    );
  }

  const revenue =
    Object.keys(revenuePatch).length > 0
      ? mergeEarningsMetricValues(base.comparison.revenue, revenuePatch)
      : base.comparison.revenue;
  const netIncome =
    Object.keys(netIncomePatch).length > 0
      ? mergeEarningsMetricValues(base.comparison.netIncome, netIncomePatch)
      : base.comparison.netIncome;
  return { ...base, comparison: { ...base.comparison, revenue, netIncome } };
}

function comparisonHasGaps(comparison: StocksEarningsComparison) {
  return [
    comparison.revenue.actual,
    comparison.revenue.estimate,
    comparison.netIncome.actual,
    comparison.netIncome.estimate,
  ].some((value) => value === null);
}

function finnhubUrl(ticker: string, target: StocksEarningsFallbackTarget, apiKey: string) {
  const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
  url.searchParams.set("symbol", ticker.trim().toUpperCase());
  url.searchParams.set("from", target.fiscalDateEnding);
  url.searchParams.set("to", target.fiscalDateEnding);
  url.searchParams.set("token", apiKey);
  return url.toString();
}

function eodhdSymbol(ticker: string) {
  const normalized = ticker.trim().toUpperCase();
  if (normalized.endsWith(".KS")) return `${normalized.slice(0, -3)}.KO`;
  return normalized.endsWith(".US") ? normalized : `${normalized}.US`;
}

function eodhdUrl(ticker: string, apiKey: string) {
  const url = new URL("https://eodhd.com/api/calendar/trends");
  url.searchParams.set("symbols", eodhdSymbol(ticker));
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("fmt", "json");
  return url.toString();
}

function alphaVantageUrl(functionName: string, ticker: string, apiKey: string) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", functionName);
  url.searchParams.set("symbol", ticker.trim().toUpperCase());
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

function yahooUrl(ticker: string) {
  const url = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      ticker.trim().toUpperCase(),
    )}`,
  );
  url.searchParams.set("modules", "incomeStatementHistoryQuarterly");
  return url.toString();
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  errors: string[],
) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      errors.push(`${label} HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch {
    errors.push(`${label} request failed`);
    return null;
  }
}

export async function completeStocksEarningsComparison({
  ticker,
  base,
  fetchImpl = fetch,
  env = process.env,
}: {
  ticker: string;
  base: StocksEarningsFallbackBase;
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<FallbackResult> {
  let completed = base;
  const errors: string[] = [];
  const target: StocksEarningsFallbackTarget = {
    ticker: ticker.trim().toUpperCase(),
    fiscalYear: base.fiscalYear,
    quarter: base.quarter,
    fiscalDateEnding: base.fiscalDateEnding,
    reportDate: base.reportDate,
    reportTiming: base.reportTiming,
    currency: base.currency,
  };
  const finnhubKeys = getProviderApiKeys(env, [
    "STOCKS_FINNHUB_API_KEYS",
    "STOCKS_FINNHUB_API_KEY",
    "FINNHUB_API_KEYS",
    "FINNHUB_API_KEY",
  ]);
  const eodhdKeys = getProviderApiKeys(env, [
    "STOCKS_EODHD_API_KEYS",
    "STOCKS_EODHD_API_KEY",
    "EODHD_API_KEYS",
    "EODHD_API_KEY",
  ]);
  const alphaVantageKeys = getProviderApiKeys(env, [
    "STOCKS_ALPHA_VANTAGE_API_KEYS",
    "STOCKS_ALPHA_VANTAGE_API_KEY",
    "ALPHA_VANTAGE_API_KEYS",
    "ALPHA_VANTAGE_API_KEY",
  ]);

  if (comparisonHasGaps(completed.comparison) && finnhubKeys[0]) {
    const payload = await fetchJson(
      fetchImpl,
      finnhubUrl(ticker, target, finnhubKeys[0]),
      "finnhub calendar/earnings",
      errors,
    );
    const candidate = payload && parseFinnhubEarningsCandidate(payload, target);
    if (candidate) completed = mergeStocksEarningsFallbackCandidate(completed, candidate);
  }

  if (comparisonHasGaps(completed.comparison) && eodhdKeys[0]) {
    const payload = await fetchJson(
      fetchImpl,
      eodhdUrl(ticker, eodhdKeys[0]),
      "eodhd calendar/trends",
      errors,
    );
    const candidate = payload && parseEodhdEarningsCandidate(payload, target);
    if (candidate) completed = mergeStocksEarningsFallbackCandidate(completed, candidate);
  }

  if (comparisonHasGaps(completed.comparison) && alphaVantageKeys[0]) {
    const key = alphaVantageKeys[0];
    const incomePayload =
      completed.comparison.revenue.actual === null ||
      completed.comparison.netIncome.actual === null
        ? await fetchJson(
            fetchImpl,
            alphaVantageUrl("INCOME_STATEMENT", ticker, key),
            "alpha-vantage INCOME_STATEMENT",
            errors,
          )
        : null;
    const estimatesPayload =
      completed.comparison.revenue.estimate === null ||
      completed.comparison.netIncome.estimate === null
        ? await fetchJson(
            fetchImpl,
            alphaVantageUrl("EARNINGS_ESTIMATES", ticker, key),
            "alpha-vantage EARNINGS_ESTIMATES",
            errors,
          )
        : null;
    const candidate = parseAlphaVantageEarningsCandidate(
      { incomeStatement: incomePayload, earningsEstimates: estimatesPayload },
      target,
    );
    if (candidate) completed = mergeStocksEarningsFallbackCandidate(completed, candidate);
  }

  if (
    comparisonHasGaps(completed.comparison) &&
    (completed.comparison.revenue.actual === null ||
      completed.comparison.netIncome.actual === null)
  ) {
    const payload = await fetchJson(
      fetchImpl,
      yahooUrl(ticker),
      "yahoo incomeStatementHistoryQuarterly",
      errors,
    );
    const candidate = payload && parseYahooEarningsCandidate(payload, target);
    if (candidate) completed = mergeStocksEarningsFallbackCandidate(completed, candidate);
  }

  return { comparison: completed.comparison, errors };
}
