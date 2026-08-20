import { getProviderApiKeys } from "./provider-api-keys.ts";
import {
  matchesStocksEarningsFiscalPeriod,
  mergeEarningsMetricValues,
  type StocksEarningsComparison,
  type StocksEarningsProvider,
  type StocksEarningsValueProvenance,
} from "./stocks-earnings-comparison.ts";

export { matchesStocksEarningsFiscalPeriod } from "./stocks-earnings-comparison.ts";

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
  market?: string;
  exchange?: string;
  announcementWindow?: { from: string; to: string };
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

type StocksEarningsFallbackProviderCache = {
  payloads: unknown[];
  requestWindows: Set<string>;
  requestCount: number;
  unavailable: boolean;
};

const MAX_PROVIDER_REQUESTS_PER_TICKER = 1;

export type StocksEarningsFallbackPayloadCache = Map<
  string,
  StocksEarningsFallbackProviderCache
>;

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
  return {
    ...emptyCandidate(target, provider),
    ...values,
    currency: values.currency ?? currency,
    revenueUnit: values.revenueUnit ?? sourceAmountUnit(record, "revenue"),
    netIncomeUnit: values.netIncomeUnit ?? sourceAmountUnit(record, "netIncome"),
    epsCurrency: values.epsCurrency ?? currency,
    epsUnit: values.epsUnit ?? null,
    dilutedSharesUnit: values.dilutedSharesUnit ?? null,
    reportDate: stringValue(record.date) || target.reportDate,
    reportTiming: reportTiming(record.hour ?? record.time) || target.reportTiming,
  };
}

function matchesFinnhubFiscalPeriod(
  record: JsonRecord,
  target: StocksEarningsFallbackTarget,
) {
  return matchesStocksEarningsFiscalPeriod(record, target, {
    dateFields: "fiscal-only",
  });
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
  const symbol = eodhdSymbol(target.ticker, target);
  if (!symbol) return null;
  const rows = flattenNestedRecords(parsed.trends ?? parsed.data ?? parsed.results);
  const row = rows.find(
    (entry) =>
      (!stringValue(entry.code) || stringValue(entry.code).toUpperCase() === symbol) &&
      matchesStocksEarningsFiscalPeriod(entry, target),
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

function alphaQuarterlyEstimates(payload: unknown) {
  const record = asRecord(payload);
  return asArray(record.quarterlyEstimates ?? record.data).map(asRecord);
}

export function parseAlphaVantageEarningsCandidate(
  payload: unknown,
  target: StocksEarningsFallbackTarget,
): StocksEarningsFallbackCandidate | null {
  const parsed = asRecord(payload);
  const incomeRows = alphaQuarterlyReports(parsed.incomeStatement);
  const estimateRows = alphaQuarterlyEstimates(parsed.earningsEstimates);
  const income = incomeRows.find((row) =>
    matchesStocksEarningsFiscalPeriod(row, target),
  );
  const estimate = estimateRows.find((row) =>
    matchesStocksEarningsFiscalPeriod(row, target),
  );
  if (!income && !estimate) return null;
  return candidateFromRecord(target, "alpha-vantage", income ?? estimate ?? {}, {
    revenueActual: income
      ? recordNumber(income, ["totalRevenue", "revenue"])
      : null,
    netIncomeActual: income ? recordNumber(income, ["netIncome"]) : null,
    epsActual: income ? recordNumber(income, ["reportedEPS", "eps"]) : null,
    revenueEstimate: estimate
      ? recordNumber(estimate, [
          "revenue_estimate_average",
          "estimatedRevenue",
          "revenueEstimate",
        ])
      : null,
    epsEstimate: estimate
      ? recordNumber(estimate, [
          "eps_estimate_average",
          "estimatedEPS",
          "epsEstimate",
        ])
      : null,
    dilutedShares: income
      ? recordNumber(income, [
          "dilutedAverageShares",
          "weightedAverageShsOutDiluted",
          "weightedAverageShsOutDil",
          "dilutedShares",
        ])
      : null,
    revenueUnit: income || estimate ? "raw" : null,
    netIncomeUnit: income ? "raw" : null,
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
  const row = rows.find((entry) => {
    const fiscalDateEnding = yahooFiscalDate(entry);
    return (
      Boolean(fiscalDateEnding) &&
      matchesStocksEarningsFiscalPeriod(
        { ...entry, fiscalDateEnding },
        target,
      )
    );
  });
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
  metric: NonNullable<StocksEarningsValueProvenance["metric"]>,
  semantics: NonNullable<StocksEarningsValueProvenance["semantics"]>,
  currency: string,
): StocksEarningsValueProvenance {
  const accountingBasis =
    semantics === "consensus-estimate"
      ? provider === "fmp"
        ? "FMP standardized"
        : "Unspecified accounting basis"
      : provider === "fmp"
        ? "FMP standardized"
        : "Company-reported";
  return {
    provider,
    method,
    accountingBasis,
    currency: currency.toUpperCase(),
    unit: "monetary",
    scale: "raw",
    metric,
    semantics,
  };
}

function addDiagnostic(errors: string[] | undefined, message: string) {
  if (errors && !errors.includes(message)) errors.push(message);
}

function isConfirmedUsUsdListing(target: Pick<StocksEarningsFallbackTarget, "currency" | "market" | "exchange">) {
  if (target.currency.trim().toUpperCase() !== "USD") return false;
  const context = [target.market, target.exchange]
    .map((value) => stringValue(value).toUpperCase())
    .filter(Boolean);
  return context.some((value) =>
    ["US", "USA", "NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "CBOE", "BZX"].some(
      (marker) => value === marker || value.startsWith(marker),
    ),
  );
}

const providerDefaultPolicy: Record<
  StocksEarningsProvider,
  "us-usd-contract" | "explicit-only"
> = {
  fmp: "explicit-only",
  finnhub: "us-usd-contract",
  eodhd: "us-usd-contract",
  "alpha-vantage": "us-usd-contract",
  yahoo: "us-usd-contract",
  "official-ir": "explicit-only",
  sec: "explicit-only",
  "earnings-labs": "explicit-only",
  chartmill: "explicit-only",
};

function candidateNeedsUsUsdDefaults(candidate: StocksEarningsFallbackCandidate) {
  return (
    (candidate.revenueActual !== null || candidate.revenueEstimate !== null) &&
      (!candidate.currency || !candidate.revenueUnit) ||
    (candidate.netIncomeActual !== null || candidate.netIncomeEstimate !== null) &&
      (!candidate.currency || !candidate.netIncomeUnit) ||
    (candidate.epsActual !== null || candidate.epsEstimate !== null) &&
      (!candidate.epsCurrency || candidate.epsUnit !== "per-share") ||
    candidate.dilutedShares !== null && candidate.dilutedSharesUnit !== "shares"
  );
}

function applyProviderDefaults(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
  errors?: string[],
) {
  if (
    providerDefaultPolicy[candidate.provider] !== "us-usd-contract" ||
    !candidateNeedsUsUsdDefaults(candidate)
  ) {
    return candidate;
  }
  if (!isConfirmedUsUsdListing(base)) {
    addDiagnostic(
      errors,
      `${candidate.provider} skipped: US listing context required for USD defaults`,
    );
    return candidate;
  }
  const currency = candidate.currency ?? "USD";
  return {
    ...candidate,
    currency,
    revenueUnit: candidate.revenueUnit ?? "raw",
    netIncomeUnit: candidate.netIncomeUnit ?? "raw",
    epsCurrency: candidate.epsCurrency ?? "USD",
    epsUnit:
      candidate.epsUnit ??
      (candidate.epsActual !== null || candidate.epsEstimate !== null
        ? "per-share"
        : null),
    dilutedSharesUnit:
      candidate.dilutedSharesUnit ??
      (candidate.dilutedShares !== null ? "shares" : null),
  };
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
  kind: "actual" | "estimate",
  errors?: string[],
) {
  const eps = kind === "actual" ? candidate.epsActual : candidate.epsEstimate;
  if (eps === null) return false;
  const shares = candidate.dilutedShares ?? base.dilutedShares;
  const sharesUnit =
    candidate.dilutedShares === null
      ? base.dilutedSharesUnit
      : candidate.dilutedSharesUnit;
  const baseEpsCurrency = base.epsCurrency?.toUpperCase();
  const baseCurrency = base.currency.toUpperCase();
  if (
    shares === null ||
    sharesUnit !== "shares" ||
    candidate.epsUnit !== "per-share" ||
    baseCurrency !== "USD" ||
    !candidate.epsCurrency ||
    candidate.epsCurrency !== "USD" ||
    baseEpsCurrency !== "USD"
  ) {
    addDiagnostic(
      errors,
      `net income ${kind} skipped: incompatible EPS or diluted shares basis`,
    );
    return false;
  }
  return true;
}

function sanitizeCandidateForBase(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
  errors?: string[],
) {
  const defaulted = applyProviderDefaults(base, candidate, errors);
  const [revenueActual, revenueEstimate] = normalizeMetricValues(
    [defaulted.revenueActual, defaulted.revenueEstimate],
    defaulted.revenueUnit,
    defaulted.currency,
    base,
    base.revenueUnit,
    "revenue",
    errors,
  );
  const [netIncomeActual, netIncomeEstimate] = normalizeMetricValues(
    [defaulted.netIncomeActual, defaulted.netIncomeEstimate],
    defaulted.netIncomeUnit,
    defaulted.currency,
    base,
    base.netIncomeUnit,
    "net income",
    errors,
  );
  const epsActual =
    defaulted.netIncomeActual === null &&
    canDeriveNetIncome(defaulted, base, "actual", errors)
      ? defaulted.epsActual
      : null;
  const epsEstimate =
    defaulted.netIncomeEstimate === null &&
    canDeriveNetIncome(defaulted, base, "estimate", errors)
    ? defaulted.epsEstimate
    : null;
  return {
    ...defaulted,
    revenueActual,
    revenueEstimate,
    revenueUnit: revenueActual === null && revenueEstimate === null ? defaulted.revenueUnit : "raw",
    netIncomeActual,
    netIncomeEstimate,
    netIncomeUnit:
      netIncomeActual === null && netIncomeEstimate === null
        ? defaulted.netIncomeUnit
        : "raw",
    epsActual,
    epsEstimate,
  };
}

function canUseDirectValue(
  current: number | null,
  source: StocksEarningsValueProvenance | undefined,
  candidate: number | null,
) {
  return candidate !== null && needsDirectValue(current, source);
}

function isDerivedValueSource(source: StocksEarningsValueProvenance | undefined) {
  return Boolean(source && String(source.method) !== "direct");
}

function needsDirectValue(
  current: number | null,
  source: StocksEarningsValueProvenance | undefined,
) {
  return current === null || isDerivedValueSource(source);
}

export function needsDirectStocksEarningsActual(
  comparison: StocksEarningsComparison,
) {
  return (
    comparison.revenue.actual === null ||
    needsDirectValue(
      comparison.netIncome.actual,
      comparison.netIncome.actualSource,
    )
  );
}

export function mergeStocksEarningsFallbackCandidate(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
  options: { deriveActual?: boolean } = {},
): StocksEarningsFallbackBase {
  return mergeCompatibleCandidate(
    base,
    sanitizeCandidateForBase(base, candidate),
    options,
  );
}

function mergeCompatibleCandidate(
  base: StocksEarningsFallbackBase,
  candidate: StocksEarningsFallbackCandidate,
  { deriveActual = true }: { deriveActual?: boolean } = {},
): StocksEarningsFallbackBase {
  if (!matchesStocksEarningsFiscalPeriod(candidate, base)) return base;

  const revenuePatch: Parameters<typeof mergeEarningsMetricValues>[1] = {};
  const netIncomePatch: Parameters<typeof mergeEarningsMetricValues>[1] = {};
  const currency = base.currency.toUpperCase();

  if (
    canUseDirectValue(
      base.comparison.revenue.actual,
      base.comparison.revenue.actualSource,
      candidate.revenueActual,
    )
  ) {
    revenuePatch.actual = candidate.revenueActual;
    revenuePatch.actualSource = provenance(
      candidate.provider,
      "direct",
      "revenue",
      "statement-actual",
      currency,
    );
  }
  if (
    canUseDirectValue(
      base.comparison.revenue.estimate,
      base.comparison.revenue.estimateSource,
      candidate.revenueEstimate,
    )
  ) {
    revenuePatch.estimate = candidate.revenueEstimate;
    revenuePatch.estimateSource = provenance(
      candidate.provider,
      "direct",
      "revenue",
      "consensus-estimate",
      currency,
    );
  }
  if (
    canUseDirectValue(
      base.comparison.netIncome.actual,
      base.comparison.netIncome.actualSource,
      candidate.netIncomeActual,
    )
  ) {
    netIncomePatch.actual = candidate.netIncomeActual;
    netIncomePatch.actualSource = provenance(
      candidate.provider,
      "direct",
      "net-income",
      "statement-actual",
      currency,
    );
  }

  const derivedNetIncomeActual = deriveNetIncome(
    candidate.epsActual,
    candidate.dilutedShares ?? base.dilutedShares,
  );
  if (
    deriveActual &&
    candidate.netIncomeActual === null &&
    base.comparison.netIncome.actual === null &&
    derivedNetIncomeActual !== null
  ) {
    netIncomePatch.actual = derivedNetIncomeActual;
    netIncomePatch.actualSource = provenance(
      candidate.provider,
      "eps-times-diluted-shares",
      "net-income",
      "statement-actual",
      currency,
    );
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
      netIncomePatch.estimateSource = provenance(
        candidate.provider,
        "direct",
        "net-income",
        "consensus-estimate",
        currency,
      );
    }
  } else if (base.comparison.netIncome.estimate === null && derivedNetIncome !== null) {
    netIncomePatch.estimate = derivedNetIncome;
    netIncomePatch.estimateSource = provenance(
      candidate.provider,
      "eps-times-diluted-shares",
      "net-income",
      "consensus-estimate",
      currency,
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
  return (
    needsDirectStocksEarningsActual(comparison) ||
    comparison.revenue.estimate === null ||
    comparison.netIncome.estimate === null
  );
}

function addUtcDays(dateValue: string, days: number) {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function finnhubAnnouncementWindow(target: StocksEarningsFallbackTarget) {
  if (target.announcementWindow) return target.announcementWindow;
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

function eodhdSymbol(
  ticker: string,
  target: Pick<StocksEarningsFallbackTarget, "currency" | "market" | "exchange">,
) {
  const normalized = ticker.trim().toUpperCase();
  if (isConfirmedUsUsdListing(target)) {
    return normalized.endsWith(".US") ? normalized : `${normalized}.US`;
  }
  const market = stringValue(target.market).toUpperCase();
  if (market === "KR" && normalized.endsWith(".KS")) {
    return `${normalized.slice(0, -3)}.KO`;
  }
  return null;
}

function eodhdUrl(symbol: string, apiKey: string) {
  const url = new URL("https://eodhd.com/api/calendar/trends");
  url.searchParams.set("symbols", symbol);
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

function providerCacheKey(ticker: string, provider: string) {
  return `${ticker.trim().toUpperCase()}:${provider}`;
}

function providerCacheEntry(
  cache: StocksEarningsFallbackPayloadCache | undefined,
  ticker: string,
  provider: string,
) {
  if (!cache) return null;
  const key = providerCacheKey(ticker, provider);
  const existing = cache.get(key);
  if (existing) return existing;
  const created: StocksEarningsFallbackProviderCache = {
    payloads: [],
    requestWindows: new Set(),
    requestCount: 0,
    unavailable: false,
  };
  cache.set(key, created);
  return created;
}

function cachedProviderPayloads(
  cache: StocksEarningsFallbackPayloadCache | undefined,
  ticker: string,
  provider: string,
) {
  return cache?.get(providerCacheKey(ticker, provider))?.payloads ?? [];
}

function cacheProviderPayload(
  cache: StocksEarningsFallbackPayloadCache | undefined,
  ticker: string,
  provider: string,
  payload: unknown,
) {
  const entry = providerCacheEntry(cache, ticker, provider);
  if (entry) entry.payloads.push(payload);
}

export function primeStocksEarningsFallbackPayload(
  cache: StocksEarningsFallbackPayloadCache | undefined,
  ticker: string,
  provider: string,
  payload: unknown,
) {
  cacheProviderPayload(cache, ticker, provider, payload);
}

function isProviderPayloadUnavailable(payload: unknown) {
  if (Array.isArray(payload)) return payload.length === 0;
  const record = asRecord(payload);
  if (Object.keys(record).length === 0) return true;
  const message = [
    record["Error Message"],
    record.message,
    record.error,
    record.detail,
    record.Information,
  ]
    .map(stringValue)
    .find(Boolean)
    ?.toLowerCase();
  if (
    message &&
    /(quota|limit|permission|forbidden|unauthori[sz]|subscription|plan|api[ -]?key)/.test(
      message,
    )
  ) {
    return "explicit-error";
  }
  const resultArrays = [
    record.earningsCalendar,
    record.trends,
    record.data,
    record.results,
    record.quarterlyReports,
    record.quarterlyEstimates,
  ].filter(Array.isArray);
  return resultArrays.length > 0 && resultArrays.every((value) => value.length === 0);
}

async function fetchCachedProviderPayload({
  cache,
  ticker,
  provider,
  requestWindow,
  fetchImpl,
  url,
  label,
  errors,
}: {
  cache: StocksEarningsFallbackPayloadCache | undefined;
  ticker: string;
  provider: string;
  requestWindow: string;
  fetchImpl: FetchLike;
  url: string;
  label: string;
  errors: string[];
}) {
  const entry = providerCacheEntry(cache, ticker, provider);
  if (
    entry?.unavailable ||
    entry?.requestWindows.has(requestWindow) ||
    (entry && entry.requestCount >= MAX_PROVIDER_REQUESTS_PER_TICKER)
  ) {
    return null;
  }
  entry?.requestWindows.add(requestWindow);
  if (entry) entry.requestCount += 1;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      errors.push(`${label} HTTP ${response.status}`);
      if (entry) entry.unavailable = true;
      return null;
    }
    const payload = await response.json();
    const unavailablePayload = isProviderPayloadUnavailable(payload);
    if (unavailablePayload) {
      if (unavailablePayload === "explicit-error") {
        errors.push(`${label} returned unavailable payload`);
      }
      if (entry) entry.unavailable = true;
      return null;
    }
    cacheProviderPayload(cache, ticker, provider, payload);
    return payload;
  } catch {
    errors.push(`${label} request failed`);
    if (entry) entry.unavailable = true;
    return null;
  }
}

export async function completeStocksEarningsComparison({
  ticker,
  base,
  fetchImpl = fetch,
  env = process.env,
  payloadCache,
}: {
  ticker: string;
  base: StocksEarningsFallbackBase;
  fetchImpl?: FetchLike;
  env?: EnvLike;
  payloadCache?: StocksEarningsFallbackPayloadCache;
}): Promise<FallbackResult> {
  let completed = base;
  const errors: string[] = [];
  const deferredActualCandidates: StocksEarningsFallbackCandidate[] = [];
  const mergeProviderCandidate = (candidate: StocksEarningsFallbackCandidate) => {
    const sanitized = sanitizeCandidateForBase(completed, candidate, errors);
    if (sanitized.epsActual !== null) deferredActualCandidates.push(sanitized);
    completed = mergeCompatibleCandidate(completed, sanitized, { deriveActual: false });
  };
  const sanitizedBase = sanitizeCandidateForBase(base, base, errors);
  if (sanitizedBase.epsActual !== null) deferredActualCandidates.push(sanitizedBase);
  const target: StocksEarningsFallbackTarget = {
    ticker: ticker.trim().toUpperCase(),
    fiscalYear: base.fiscalYear,
    quarter: base.quarter,
    fiscalDateEnding: base.fiscalDateEnding,
    reportDate: base.reportDate,
    reportTiming: base.reportTiming,
    currency: base.currency,
    market: base.market,
    exchange: base.exchange,
    announcementWindow: base.announcementWindow,
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
    let candidate = cachedProviderPayloads(payloadCache, ticker, "finnhub")
      .map((payload) => parseFinnhubEarningsCandidate(payload, target))
      .find((value): value is StocksEarningsFallbackCandidate => value !== null);
    if (!candidate) {
      const url = finnhubUrl(ticker, target, finnhubKeys[0]);
      const payload = await fetchCachedProviderPayload({
        cache: payloadCache,
        ticker,
        provider: "finnhub",
        requestWindow: url,
        fetchImpl,
        url,
        label: "finnhub calendar/earnings",
        errors,
      });
      if (payload) {
        candidate = parseFinnhubEarningsCandidate(payload, target) ?? undefined;
      }
    }
    if (candidate) {
      mergeProviderCandidate(candidate);
    }
  }

  const eodhdTicker = eodhdSymbol(ticker, target);
  if (comparisonHasGaps(completed.comparison) && eodhdKeys[0] && eodhdTicker) {
    let candidate = cachedProviderPayloads(payloadCache, ticker, "eodhd")
      .map((payload) => parseEodhdEarningsCandidate(payload, target))
      .find((value): value is StocksEarningsFallbackCandidate => value !== null);
    if (!candidate) {
      const url = eodhdUrl(eodhdTicker, eodhdKeys[0]);
      const payload = await fetchCachedProviderPayload({
        cache: payloadCache,
        ticker,
        provider: "eodhd",
        requestWindow: url,
        fetchImpl,
        url,
        label: "eodhd calendar/trends",
        errors,
      });
      if (payload) {
        candidate = parseEodhdEarningsCandidate(payload, target) ?? undefined;
      }
    }
    if (candidate) {
      mergeProviderCandidate(candidate);
    }
  } else if (comparisonHasGaps(completed.comparison) && eodhdKeys[0] && !eodhdTicker) {
    addDiagnostic(errors, "eodhd calendar/trends skipped: unsupported or unproven listing market");
  }

  if (comparisonHasGaps(completed.comparison) && alphaVantageKeys[0]) {
    const key = alphaVantageKeys[0];
    let incomePayload =
      needsDirectStocksEarningsActual(completed.comparison)
        ? cachedProviderPayloads(payloadCache, ticker, "alpha-vantage-income")[0] ?? null
        : null;
    if (
      incomePayload === null &&
      needsDirectStocksEarningsActual(completed.comparison)
    ) {
      const url = alphaVantageUrl("INCOME_STATEMENT", ticker, key);
      incomePayload = await fetchCachedProviderPayload({
        cache: payloadCache,
        ticker,
        provider: "alpha-vantage-income",
        requestWindow: url,
        fetchImpl,
        url,
        label: "alpha-vantage INCOME_STATEMENT",
        errors,
      });
    }
    let estimatesPayload =
      completed.comparison.revenue.estimate === null ||
      completed.comparison.netIncome.estimate === null
        ? cachedProviderPayloads(payloadCache, ticker, "alpha-vantage-estimates")[0] ?? null
        : null;
    if (estimatesPayload === null && (
      completed.comparison.revenue.estimate === null ||
      completed.comparison.netIncome.estimate === null
    )) {
      const url = alphaVantageUrl("EARNINGS_ESTIMATES", ticker, key);
      estimatesPayload = await fetchCachedProviderPayload({
        cache: payloadCache,
        ticker,
        provider: "alpha-vantage-estimates",
        requestWindow: url,
        fetchImpl,
        url,
        label: "alpha-vantage EARNINGS_ESTIMATES",
        errors,
      });
    }
    const candidate = parseAlphaVantageEarningsCandidate(
      { incomeStatement: incomePayload, earningsEstimates: estimatesPayload },
      target,
    );
    if (candidate) {
      mergeProviderCandidate(candidate);
    }
  }

  if (
    comparisonHasGaps(completed.comparison) &&
    needsDirectStocksEarningsActual(completed.comparison)
  ) {
    let candidate = cachedProviderPayloads(payloadCache, ticker, "yahoo")
      .map((payload) => parseYahooEarningsCandidate(payload, target))
      .find((value): value is StocksEarningsFallbackCandidate => value !== null);
    if (!candidate) {
      const url = yahooUrl(ticker);
      const payload = await fetchCachedProviderPayload({
        cache: payloadCache,
        ticker,
        provider: "yahoo",
        requestWindow: url,
        fetchImpl,
        url,
        label: "yahoo incomeStatementHistoryQuarterly",
        errors,
      });
      if (payload) {
        candidate = parseYahooEarningsCandidate(payload, target) ?? undefined;
      }
    }
    if (candidate) {
      mergeProviderCandidate(candidate);
    }
  }

  if (completed.comparison.netIncome.actual === null) {
    for (const candidate of deferredActualCandidates) {
      completed = mergeCompatibleCandidate(completed, candidate);
      if (completed.comparison.netIncome.actual !== null) break;
    }
  }

  return { comparison: completed.comparison, errors };
}
