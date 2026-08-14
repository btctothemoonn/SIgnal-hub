type JsonRecord = Record<string, unknown>;

export type StocksEarningsProvider =
  | "fmp"
  | "finnhub"
  | "eodhd"
  | "alpha-vantage"
  | "yahoo";

export type StocksEarningsValueProvenance = {
  provider: StocksEarningsProvider;
  method: "direct" | "eps-times-diluted-shares";
  accountingBasis: string;
};

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
  accountingBasis: "FMP standardized";
  provider: "fmp";
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
  const normalized = stringValue(value).toUpperCase();
  return /^(Q1|Q2|Q3|Q4)$/.test(normalized)
    ? (normalized as StocksEarningsComparison["quarter"])
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
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Infinity;
  return Math.abs(leftMs - rightMs) / 86_400_000;
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
  const surprise =
    actual !== null && estimate !== null ? actual - estimate : null;
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
  const merged = calculateComparisonMetric(
    actual,
    estimate,
    previousYearActual,
  );
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
  if (estimateSource) merged.estimateSource = estimateSource;
  if (actualSource) merged.actualSource = actualSource;
  return merged;
}

function matchingEstimate(
  income: JsonRecord,
  estimates: JsonRecord[],
) {
  const fiscalYear = fiscalYearValue(income.fiscalYear);
  const quarter = quarterValue(income.period);
  const exact = estimates.find(
    (estimate) =>
      fiscalYearValue(estimate.fiscalYear) === fiscalYear &&
      quarterValue(estimate.period) === quarter,
  );
  if (exact) return exact;

  const incomeDate = dateValue(income);
  if (!incomeDate) return null;
  return (
    estimates.find((estimate) => {
      if (
        fiscalYearValue(estimate.fiscalYear) !== null &&
        quarterValue(estimate.period) !== null
      ) {
        return false;
      }
      const estimateDate = dateValue(estimate);
      return estimateDate && dateDistanceDays(incomeDate, estimateDate) <= 7;
    }) ?? null
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
  const incomeDate = dateValue(income);
  if (!incomeDate) return null;
  return (
    earnings.find((row) => {
      const fiscalDate =
        stringValue(row.fiscalDateEnding) || stringValue(row.fiscalDate);
      return fiscalDate && dateDistanceDays(incomeDate, fiscalDate) <= 7;
    }) ?? null
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
  return {
    ticker: ticker.trim().toUpperCase(),
    fiscalYear,
    quarter,
    fiscalDateEnding,
    reportDate: earningsRow ? stringValue(earningsRow.date) || null : null,
    reportTiming: reportTiming(earningsRow?.time),
    currency: stringValue(income.reportedCurrency) || "USD",
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt,
    revenue: calculateComparisonMetric(
      numberValue(income.revenue),
      numberValue(estimate?.estimatedRevenueAvg ?? estimate?.revenueAvg),
      numberValue(previous?.revenue),
      {
        actualSource: {
          provider: "fmp",
          method: "direct",
          accountingBasis: "FMP standardized",
        },
        estimateSource: {
          provider: "fmp",
          method: "direct",
          accountingBasis: "FMP standardized",
        },
      },
    ),
    netIncome: calculateComparisonMetric(
      numberValue(income.netIncome),
      numberValue(
        estimate?.estimatedNetIncomeAvg ?? estimate?.netIncomeAvg,
      ),
      numberValue(previous?.netIncome),
      {
        actualSource: {
          provider: "fmp",
          method: "direct",
          accountingBasis: "FMP standardized",
        },
        estimateSource: {
          provider: "fmp",
          method: "direct",
          accountingBasis: "FMP standardized",
        },
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
