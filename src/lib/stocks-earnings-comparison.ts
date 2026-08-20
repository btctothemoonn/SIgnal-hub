type JsonRecord = Record<string, unknown>;

export type StocksEarningsProvider =
  | "fmp"
  | "finnhub"
  | "eodhd"
  | "alpha-vantage"
  | "yahoo"
  | "official-ir"
  | "sec"
  | "earnings-labs"
  | "chartmill";

const STOCKS_EARNINGS_PROVIDERS: readonly StocksEarningsProvider[] = [
  "fmp",
  "finnhub",
  "eodhd",
  "alpha-vantage",
  "yahoo",
  "official-ir",
  "sec",
  "earnings-labs",
  "chartmill",
];

export type StocksEarningsValueProvenance = {
  provider: StocksEarningsProvider;
  method: "direct" | "eps-times-diluted-shares";
  accountingBasis: string;
  currency?: string;
  unit?: "monetary";
  scale?: "raw" | "thousands" | "millions" | "billions";
  metric?: "revenue" | "net-income";
  semantics?: "statement-actual" | "consensus-estimate";
};

export const LEGACY_UNKNOWN_ACCOUNTING_BASIS =
  "Legacy/unknown accounting basis";

function isStocksEarningsProvider(
  value: unknown,
): value is StocksEarningsProvider {
  return STOCKS_EARNINGS_PROVIDERS.includes(value as StocksEarningsProvider);
}

function isStocksEarningsValueMethod(
  value: unknown,
): value is StocksEarningsValueProvenance["method"] {
  return value === "direct" || value === "eps-times-diluted-shares";
}

export function normalizeStocksEarningsValueProvenance(
  source: Partial<StocksEarningsValueProvenance> | undefined,
  defaults: Partial<StocksEarningsValueProvenance> = {},
): StocksEarningsValueProvenance | undefined {
  if (!source) return undefined;
  if (!isStocksEarningsProvider(source.provider)) return undefined;
  if (!isStocksEarningsValueMethod(source.method)) return undefined;
  const accountingBasis =
    typeof source.accountingBasis === "string" &&
    source.accountingBasis.trim()
      ? source.accountingBasis.trim()
      : source.provider === "fmp"
        ? "FMP standardized"
        : LEGACY_UNKNOWN_ACCOUNTING_BASIS;
  const normalized: StocksEarningsValueProvenance = {
    provider: source.provider,
    method: source.method,
    accountingBasis,
  };
  const currency = stringValue(source.currency ?? defaults.currency).toUpperCase();
  if (currency) normalized.currency = currency;
  const unit = source.unit ?? defaults.unit;
  if (unit === "monetary") normalized.unit = unit;
  const scale = source.scale ?? defaults.scale;
  if (["raw", "thousands", "millions", "billions"].includes(String(scale))) {
    normalized.scale = scale as NonNullable<StocksEarningsValueProvenance["scale"]>;
  }
  const metric = source.metric ?? defaults.metric;
  if (metric === "revenue" || metric === "net-income") {
    normalized.metric = metric;
  }
  const semantics = source.semantics ?? defaults.semantics;
  if (semantics === "statement-actual" || semantics === "consensus-estimate") {
    normalized.semantics = semantics;
  }
  return normalized;
}

export function areStocksEarningsValuesComparable(
  actualSource: StocksEarningsValueProvenance | undefined,
  estimateSource: StocksEarningsValueProvenance | undefined,
) {
  if (!actualSource || !estimateSource) return false;
  return (
    Boolean(actualSource.currency) &&
    actualSource.currency === estimateSource.currency &&
    actualSource.unit === "monetary" &&
    estimateSource.unit === "monetary" &&
    actualSource.scale === estimateSource.scale &&
    actualSource.scale === "raw" &&
    actualSource.metric === estimateSource.metric &&
    actualSource.semantics === "statement-actual" &&
    estimateSource.semantics === "consensus-estimate"
  );
}

export type StocksEarningsMetricComparison = {
  estimate: number | null;
  estimateSource?: StocksEarningsValueProvenance;
  actual: number | null;
  actualSource?: StocksEarningsValueProvenance;
  previousYearActual: number | null;
  estimateYoYPct: number | null;
  actualYoYPct: number | null;
  surprise: number | null;
  surprisePct: number | null;
};

export type StocksEarningsComparison = {
  ticker: string;
  fiscalYear: number;
  quarter: `Q${1 | 2 | 3 | 4}`;
  fiscalDateEnding: string;
  reportDate: string | null;
  reportTiming: "before-market" | "after-market" | "unknown";
  currency: string;
  accountingBasis: string;
  provider: StocksEarningsProvider;
  generatedAt: string;
  revenue: StocksEarningsMetricComparison;
  netIncome: StocksEarningsMetricComparison;
};

export type FmpQuarterlyEarningsPayload = {
  income: unknown;
  estimates: unknown;
  earnings: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown) {
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

function fiscalYearValue(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : null;
}

function quarterValue(value: unknown): StocksEarningsComparison["quarter"] | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  const match = normalized.match(/^Q?([1-4])$/);
  return match
    ? (`Q${match[1]}` as StocksEarningsComparison["quarter"])
    : null;
}

function dateValue(record: JsonRecord) {
  return (
    stringValue(record.fiscalDateEnding) ||
    stringValue(record.date) ||
    stringValue(record.calendarYear)
  );
}

function dateDistanceDays(left: string, right: string) {
  const leftMs = Date.parse(left.length === 10 ? `${left}T00:00:00Z` : left);
  const rightMs = Date.parse(right.length === 10 ? `${right}T00:00:00Z` : right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Infinity;
  const leftUtcDay = Date.UTC(
    new Date(leftMs).getUTCFullYear(),
    new Date(leftMs).getUTCMonth(),
    new Date(leftMs).getUTCDate(),
  );
  const rightUtcDay = Date.UTC(
    new Date(rightMs).getUTCFullYear(),
    new Date(rightMs).getUTCMonth(),
    new Date(rightMs).getUTCDate(),
  );
  return Math.abs(leftUtcDay - rightUtcDay) / 86_400_000;
}

export function matchesStocksEarningsFiscalPeriod(
  recordValue: unknown,
  target: Pick<
    StocksEarningsComparison,
    "fiscalYear" | "quarter" | "fiscalDateEnding"
  >,
  { dateFields = "any" }: { dateFields?: "any" | "fiscal-only" } = {},
) {
  const record = asRecord(recordValue);
  const fiscalPeriod = stringValue(
    record.fiscalPeriod ?? record.fiscal_period,
  ).toUpperCase();
  const fiscalPeriodMatch = fiscalPeriod.match(/(\d{4})Q([1-4])/);
  const fiscalYear =
    fiscalYearValue(record.fiscalYear ?? record.year) ??
    (fiscalPeriodMatch ? Number(fiscalPeriodMatch[1]) : null);
  const quarter =
    quarterValue(record.quarter ?? record.period) ??
    (fiscalPeriodMatch
      ? (`Q${fiscalPeriodMatch[2]}` as StocksEarningsComparison["quarter"])
      : null);
  if (fiscalYear !== null && fiscalYear !== target.fiscalYear) return false;
  if (quarter !== null && quarter !== target.quarter) return false;

  const fiscalDateEnding =
    stringValue(record.fiscalDateEnding) ||
    stringValue(record.fiscalDate) ||
    (dateFields === "any" ? stringValue(record.date) : "");
  if (fiscalDateEnding) {
    return dateDistanceDays(fiscalDateEnding, target.fiscalDateEnding) <= 7;
  }
  return fiscalYear === target.fiscalYear && quarter === target.quarter;
}

function percentageChange(value: number | null, base: number | null) {
  if (value === null || base === null || base === 0) return null;
  return ((value - base) / Math.abs(base)) * 100;
}

export function calculateComparisonMetric(
  actual: number | null,
  estimate: number | null,
  previousYearActual: number | null,
  sources: {
    estimateSource?: StocksEarningsValueProvenance;
    actualSource?: StocksEarningsValueProvenance;
  } = {},
): StocksEarningsMetricComparison {
  const hasStructuredComparison = Boolean(
    sources.actualSource || sources.estimateSource,
  );
  const comparable =
    !hasStructuredComparison ||
    areStocksEarningsValuesComparable(
      sources.actualSource,
      sources.estimateSource,
    );
  const surprise =
    comparable && actual !== null && estimate !== null
      ? actual - estimate
      : null;
  const metric: StocksEarningsMetricComparison = {
    estimate,
    actual,
    previousYearActual,
    estimateYoYPct: percentageChange(estimate, previousYearActual),
    actualYoYPct: percentageChange(actual, previousYearActual),
    surprise,
    surprisePct:
      surprise !== null && estimate !== null && estimate !== 0
        ? (surprise / Math.abs(estimate)) * 100
        : null,
  };
  if (estimate !== null && sources.estimateSource) {
    metric.estimateSource = sources.estimateSource;
  }
  if (actual !== null && sources.actualSource) {
    metric.actualSource = sources.actualSource;
  }
  return metric;
}

type StocksEarningsMetricValuePatch = {
  estimate?: number | null;
  estimateSource?: StocksEarningsValueProvenance;
  actual?: number | null;
  actualSource?: StocksEarningsValueProvenance;
  previousYearActual?: number | null;
};

export function mergeEarningsMetricValues(
  metric: StocksEarningsMetricComparison,
  patch: StocksEarningsMetricValuePatch,
): StocksEarningsMetricComparison {
  const actual = patch.actual !== undefined ? patch.actual : metric.actual;
  const estimate =
    patch.estimate !== undefined ? patch.estimate : metric.estimate;
  const previousYearActual =
    patch.previousYearActual !== undefined
      ? patch.previousYearActual
      : metric.previousYearActual;
  const estimateSource =
    estimate === null
      ? undefined
      : patch.estimateSource !== undefined
        ? patch.estimateSource
        : patch.estimate !== undefined
          ? undefined
          : metric.estimateSource;
  const actualSource =
    actual === null
      ? undefined
      : patch.actualSource !== undefined
        ? patch.actualSource
        : patch.actual !== undefined
          ? undefined
          : metric.actualSource;
  const merged = calculateComparisonMetric(
    actual,
    estimate,
    previousYearActual,
    { estimateSource, actualSource },
  );
  return merged;
}

function fmpProvenance(
  currency: string,
  metric: NonNullable<StocksEarningsValueProvenance["metric"]>,
  semantics: NonNullable<StocksEarningsValueProvenance["semantics"]>,
): StocksEarningsValueProvenance {
  return {
    provider: "fmp",
    method: "direct",
    accountingBasis: "FMP standardized",
    currency,
    unit: "monetary",
    scale: "raw",
    metric,
    semantics,
  };
}

function matchingEstimate(
  income: JsonRecord,
  estimates: JsonRecord[],
) {
  const fiscalYear = fiscalYearValue(income.fiscalYear);
  const quarter = quarterValue(income.period);
  const fiscalDateEnding = dateValue(income);
  if (fiscalYear === null || quarter === null || !fiscalDateEnding) return null;
  return (
    estimates.find((estimate) =>
      matchesStocksEarningsFiscalPeriod(estimate, {
        fiscalYear,
        quarter,
        fiscalDateEnding,
      }),
    ) ?? null
  );
}

function matchingPreviousYear(
  income: JsonRecord,
  statements: JsonRecord[],
) {
  const fiscalYear = fiscalYearValue(income.fiscalYear);
  const quarter = quarterValue(income.period);
  if (fiscalYear === null || quarter === null) return null;
  return (
    statements.find(
      (statement) =>
        fiscalYearValue(statement.fiscalYear) === fiscalYear - 1 &&
        quarterValue(statement.period) === quarter,
    ) ?? null
  );
}

function matchingEarningsRow(income: JsonRecord, earnings: JsonRecord[]) {
  const fiscalYear = fiscalYearValue(income.fiscalYear);
  const quarter = quarterValue(income.period);
  const fiscalDateEnding = dateValue(income);
  if (fiscalYear === null || quarter === null || !fiscalDateEnding) return null;
  return (
    earnings.find((row) =>
      matchesStocksEarningsFiscalPeriod(
        row,
        { fiscalYear, quarter, fiscalDateEnding },
        { dateFields: "fiscal-only" },
      ),
    ) ?? null
  );
}

function reportTiming(value: unknown): StocksEarningsComparison["reportTiming"] {
  const normalized = stringValue(value).toLowerCase();
  if (["bmo", "before market open", "before-market"].includes(normalized)) {
    return "before-market";
  }
  if (["amc", "after market close", "after-market"].includes(normalized)) {
    return "after-market";
  }
  return "unknown";
}

function parseIncomeQuarter(
  ticker: string,
  income: JsonRecord,
  statements: JsonRecord[],
  estimates: JsonRecord[],
  earnings: JsonRecord[],
  generatedAt: string,
): StocksEarningsComparison | null {
  const fiscalYear = fiscalYearValue(income.fiscalYear);
  const quarter = quarterValue(income.period);
  const fiscalDateEnding = dateValue(income);
  if (fiscalYear === null || quarter === null || !fiscalDateEnding) return null;

  const estimate = matchingEstimate(income, estimates);
  const previous = matchingPreviousYear(income, statements);
  const earningsRow = matchingEarningsRow(income, earnings);
  const currency = stringValue(income.reportedCurrency) || "USD";
  return {
    ticker: ticker.trim().toUpperCase(),
    fiscalYear,
    quarter,
    fiscalDateEnding,
    reportDate: earningsRow ? stringValue(earningsRow.date) || null : null,
    reportTiming: reportTiming(earningsRow?.time),
    currency,
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt,
    revenue: calculateComparisonMetric(
      numberValue(income.revenue),
      numberValue(estimate?.estimatedRevenueAvg ?? estimate?.revenueAvg),
      numberValue(previous?.revenue),
      {
        actualSource: fmpProvenance(currency, "revenue", "statement-actual"),
        estimateSource: fmpProvenance(
          currency,
          "revenue",
          "consensus-estimate",
        ),
      },
    ),
    netIncome: calculateComparisonMetric(
      numberValue(income.netIncome),
      numberValue(
        estimate?.estimatedNetIncomeAvg ?? estimate?.netIncomeAvg,
      ),
      numberValue(previous?.netIncome),
      {
        actualSource: fmpProvenance(
          currency,
          "net-income",
          "statement-actual",
        ),
        estimateSource: fmpProvenance(
          currency,
          "net-income",
          "consensus-estimate",
        ),
      },
    ),
  };
}

export function parseFmpQuarterlyEarningsHistory(
  ticker: string,
  payload: FmpQuarterlyEarningsPayload,
  {
    generatedAt = new Date().toISOString(),
    limit = 8,
  }: { generatedAt?: string; limit?: number } = {},
) {
  const statements = asArray(payload.income).map(asRecord);
  const estimates = asArray(payload.estimates).map(asRecord);
  const earnings = asArray(payload.earnings).map(asRecord);
  return statements
    .map((income) =>
      parseIncomeQuarter(
        ticker,
        income,
        statements,
        estimates,
        earnings,
        generatedAt,
      ),
    )
    .filter(
      (comparison): comparison is StocksEarningsComparison =>
        comparison !== null,
    )
    .sort(
      (left, right) =>
        Date.parse(right.fiscalDateEnding) - Date.parse(left.fiscalDateEnding),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function parseFmpQuarterlyEarnings(
  ticker: string,
  payload: FmpQuarterlyEarningsPayload,
  options: { generatedAt?: string } = {},
) {
  return parseFmpQuarterlyEarningsHistory(ticker, payload, {
    ...options,
    limit: 1,
  })[0] ?? null;
}
