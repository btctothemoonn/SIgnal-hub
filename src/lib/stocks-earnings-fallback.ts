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

type StocksEarningsAmountUnit = "raw" | "thousands" | "millions" | "billions" | null;

export type StocksEarningsFallbackCandidate = Omit<
  StocksEarningsFallbackTarget,
  "currency"
> & {
  currency: string | null;
  provider: StocksEarningsProvider;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueUnit: StocksEarningsAmountUnit;
  netIncomeActual: number | null;
  netIncomeEstimate: number | null;
  netIncomeUnit: StocksEarningsAmountUnit;
  epsActual: number | null;
  epsEstimate: number | null;
  epsCurrency: string | null;
  epsUnit: "per-share" | null;
  dilutedShares: number | null;
  dilutedSharesUnit: "shares" | null;
};

export type StocksEarningsFallbackBase = Omit<
  StocksEarningsFallbackCandidate,
  "currency"
> & {
  currency: string;
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

function fiscalDateValue(record: JsonRecord) {
  return stringValue(record.fiscalDateEnding) || stringValue(record.fiscalDate);
}

function currencyValue(record: JsonRecord) {
  const value =
    stringValue(record.currency) ||
    stringValue(record.reportedCurrency) ||
    stringValue(record.financialCurrency);
  return value ? value.toUpperCase() : null;
}

function amountUnitValue(value: unknown): StocksEarningsAmountUnit {
  const normalized = stringValue(value).toLowerCase();
  if (["raw", "unit", "units"].includes(normalized)) return "raw";
  if (["thousand", "thousands", "k"].includes(normalized)) return "thousands";
  if (["million", "millions", "m"].includes(normalized)) return "millions";
  if (["billion", "billions", "b"].includes(normalized)) return "billions";
  return null;
}

function sourceAmountUnit(record: JsonRecord, metric: "revenue" | "netIncome") {
  return amountUnitValue(
    record[`${metric}Unit`] ?? record.amountUnit ?? record.unit ?? record.scale,
  );
}

function hasMatchingFiscalIdentity(
  record: JsonRecord,
  target: StocksEarningsFallbackTarget,
  { useDate = true }: { useDate?: boolean } = {},
) {
  const fiscalYear = recordNumber(record, ["fiscalYear", "year"]);
  const quarter = quarterValue(record.quarter ?? record.period);
  const fiscalDateEnding = useDate ? dateValue(record) : fiscalDateValue(record);
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
    currency: null,
    provider,
    revenueActual: null,
    revenueEstimate: null,
    revenueUnit: null,
    netIncomeActual: null,
    netIncomeEstimate: null,
    netIncomeUnit: null,
    epsActual: null,
    epsEstimate: null,
    epsCurrency: null,
    epsUnit: null,
    dilutedShares: null,
    dilutedSharesUnit: null,
  };
}

function candidateFromRecord(
  target: StocksEarningsFallbackTarget,
  provider: StocksEarningsProvider,
  record: JsonRecord,
  values: Partial<StocksEarningsFallbackCandidate>,
) {
  const currency = currencyValue(record);
  const epsActual = values.epsActual ?? null;
  const epsEstimate = values.epsEstimate ?? null;
  const dilutedShares = values.dilutedShares ?? null;
  return {
    ...emptyCandidate(target, provider),
    ...values,
    currency: values.currency ?? currency,
    revenueUnit: values.revenueUnit ?? sourceAmountUnit(record, "revenue"),
    netIncomeUnit: values.netIncomeUnit ?? sourceAmountUnit(record, "netIncome"),
    epsCurrency: values.epsCurrency ?? currency,
    epsUnit: values.epsUnit ?? (epsActual !== null || epsEstimate !== null ? "per-share" : null),
    dilutedSharesUnit:
      values.dilutedSharesUnit ?? (dilutedShares !== null ? "shares" : null),
    reportDate: stringValue(record.date) || target.reportDate,
    reportTiming: reportTiming(record.hour ?? record.time) || target.reportTiming,
  };
}

function matchesFinnhubFiscalPeriod(
  record: JsonRecord,
  target: StocksEarningsFallbackTarget,
) {
  if (!hasMatchingFiscalIdentity(record, target, { useDate: false })) {
    return false;
  }
  const period = stringValue(record.fiscalPeriod ?? record.fiscal_period).toUpperCase();
  return !period || period.includes(`${target.fiscalYear}Q${target.quarter.slice(1)}`);
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
      matchesFinnhubFiscalPeriod(entry, target),
  );
  if (!row) return null;
  return candidateFromRecord(target, "finnhub", row, {
    revenueActual: recordNumber(row, ["revenueActual"]),
    revenueEstimate: recordNumber(row, ["revenueEstimate"]),
    epsActual: recordNumber(row, ["epsActual"]),
    epsEstimate: recordNumber(row, ["epsEstimate"]),
  });
}

function flattenNestedRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenNestedRecords);
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return [];
  const nested = Object.values(record).filter(Array.isArray);
  return nested.length > 0 ? nested.flatMap(flattenNestedRecords) : [record];
}

export function parseEodhdEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const parsed = asRecord(payload);
  const symbol = eodhdSymbol(target.ticker);
  const rows = flattenNestedRecords(parsed.trends ?? parsed.data ?? parsed.results);
  const row = rows.find(
    (entry) =>
      (!stringValue(entry.code) || stringValue(entry.code).toUpperCase() === symbol) &&
      hasMatchingFiscalIdentity(entry, target),
  );
  if (!row) return null;
  return candidateFromRecord(target, "eodhd", row, {
    revenueEstimate: recordNumber(row, [
      "revenueEstimate",
      "revenueAvg",
      "estimatedRevenueAvg",
      "revenueEstimateAvg",
    ]),
    epsEstimate: recordNumber(row, [
      "epsEstimate",
      "epsAvg",
      "estimatedEpsAvg",
      "earningsEstimateAvg",
    ]),
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
    dilutedShares: income
      ? recordNumber(income, ["dilutedShares", "weightedAverageShsOutDil"])
      : null,
  });
}

function yahooFiscalDate(row: JsonRecord) {
  const endDate = asRecord(row.endDate);
  const formatted = stringValue(endDate.fmt);
  if (formatted) return formatted;
  const raw = numberValue(endDate.raw);
  if (raw === null || !Number.isSafeInteger(raw) || raw < 0) return "";
  const date = new Date(raw * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

export function parseYahooEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const result = asArray(asRecord(asRecord(payload).quoteSummary).result)[0];
  const history = asRecord(asRecord(result).incomeStatementHistoryQuarterly);
  const rows = asArray(history.incomeStatementHistory).map(asRecord);
  const row = rows.find((entry) => yahooFiscalDate(entry) === target.fiscalDateEnding);
  if (!row) return null;
  const candidate = candidateFromRecord(target, "yahoo", {
    ...asRecord(result),
    ...row,
  }, {
    revenueActual: recordNumber(asRecord(row.totalRevenue), ["raw"]),
    netIncomeActual: recordNumber(asRecord(row.netIncome), ["raw"]),
    revenueUnit: "raw",
    netIncomeUnit: "raw",
  });
  return candidate;
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

function addDiagnostic(errors: string[] | undefined, message: string) {
  if (errors && !errors.includes(message)) errors.push(message);
}

function normalizeAmount(value: number, unit: StocksEarningsAmountUnit) {
  const factor =
    unit === "thousands"
      ? 1_000
      : unit === "millions"
        ? 1_000_000
        : unit === "billions"
          ? 1_000_000_000
          : 1;
  return value * factor;
}

function normalizeMetricValues(
  values: [number | null, number | null],
  unit: StocksEarningsAmountUnit,
  currency: string | null,
  base: StocksEarningsFallbackBase,
  baseUnit: StocksEarningsAmountUnit,
  label: string,
  errors?: string[],
): [number | null, number | null] {
  if (values[0] === null && values[1] === null) return values;
  if (!currency || currency !== base.currency.toUpperCase()) {
    addDiagnostic(errors, `${label} skipped: incompatible source currency`);
    return [null, null];
  }
  if (!unit || baseUnit !== "raw") {
    addDiagnostic(errors, `${label} skipped: incompatible or unknown source unit`);
    return [null, null];
  }
  return [
    values[0] === null ? null : normalizeAmount(values[0], unit),
    values[1] === null ? null : normalizeAmount(values[1], unit),
  ];
}

function canDeriveNetIncome(
  candidate: StocksEarningsFallbackCandidate,
  base: StocksEarningsFallbackBase,
  errors?: string[],
) {
  if (candidate.epsEstimate === null) return false;
  const shares = candidate.dilutedShares ?? base.dilutedShares;
  const sharesUnit =
    candidate.dilutedShares === null
      ? base.dilutedSharesUnit
      : candidate.dilutedSharesUnit;
  const baseEpsCurrency = base.epsCurrency?.toUpperCase();
  if (
    shares === null ||
    sharesUnit !== "shares" ||
    candidate.epsUnit !== "per-share" ||
    !candidate.epsCurrency ||
    candidate.epsCurrency !== base.currency.toUpperCase() ||
    baseEpsCurrency !== base.currency.toUpperCase()
  ) {
    addDiagnostic(errors, "net income estimate skipped: incompatible EPS or diluted shares basis");
    return false;
  }
  return true;
}

function sanitizeCandidateForBase(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
  errors?: string[],
) {
  const [revenueActual, revenueEstimate] = normalizeMetricValues(
    [candidate.revenueActual, candidate.revenueEstimate],
    candidate.revenueUnit,
    candidate.currency,
    base,
    base.revenueUnit,
    "revenue",
    errors,
  );
  const [netIncomeActual, netIncomeEstimate] = normalizeMetricValues(
    [candidate.netIncomeActual, candidate.netIncomeEstimate],
    candidate.netIncomeUnit,
    candidate.currency,
    base,
    base.netIncomeUnit,
    "net income",
    errors,
  );
  const epsEstimate = canDeriveNetIncome(candidate, base, errors)
    ? candidate.epsEstimate
    : null;
  return {
    ...candidate,
    revenueActual,
    revenueEstimate,
    revenueUnit: revenueActual === null && revenueEstimate === null ? candidate.revenueUnit : "raw",
    netIncomeActual,
    netIncomeEstimate,
    netIncomeUnit:
      netIncomeActual === null && netIncomeEstimate === null
        ? candidate.netIncomeUnit
        : "raw",
    epsEstimate,
  };
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
  return mergeCompatibleCandidate(base, sanitizeCandidateForBase(base, candidate));
}

function mergeCompatibleCandidate(
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

function addUtcDays(dateValue: string, days: number) {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function finnhubAnnouncementWindow(target: StocksEarningsFallbackTarget) {
  if (target.reportDate) return { from: target.reportDate, to: target.reportDate };
  return {
    from: addUtcDays(target.fiscalDateEnding, 14),
    to: addUtcDays(target.fiscalDateEnding, 120),
  };
}

function finnhubUrl(ticker: string, target: StocksEarningsFallbackTarget, apiKey: string) {
  const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
  const window = finnhubAnnouncementWindow(target);
  url.searchParams.set("symbol", ticker.trim().toUpperCase());
  url.searchParams.set("from", window.from);
  url.searchParams.set("to", window.to);
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
    if (candidate) {
      completed = mergeCompatibleCandidate(
        completed,
        sanitizeCandidateForBase(completed, candidate, errors),
      );
    }
  }

  if (comparisonHasGaps(completed.comparison) && eodhdKeys[0]) {
    const payload = await fetchJson(
      fetchImpl,
      eodhdUrl(ticker, eodhdKeys[0]),
      "eodhd calendar/trends",
      errors,
    );
    const candidate = payload && parseEodhdEarningsCandidate(payload, target);
    if (candidate) {
      completed = mergeCompatibleCandidate(
        completed,
        sanitizeCandidateForBase(completed, candidate, errors),
      );
    }
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
    if (candidate) {
      completed = mergeCompatibleCandidate(
        completed,
        sanitizeCandidateForBase(completed, candidate, errors),
      );
    }
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
    if (candidate) {
      completed = mergeCompatibleCandidate(
        completed,
        sanitizeCandidateForBase(completed, candidate, errors),
      );
    }
  }

  return { comparison: completed.comparison, errors };
}
