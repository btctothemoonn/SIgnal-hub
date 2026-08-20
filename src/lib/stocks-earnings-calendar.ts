import type {
  StocksEarningsComparison,
  StocksEarningsProvider,
} from "./stocks-earnings-comparison.ts";

const DAY_MS = 86_400_000;

export type StocksEarningsStatus = "upcoming" | "reported" | "incomplete";

export type StocksEarningsMissingField =
  | "revenue-estimate"
  | "revenue-actual"
  | "net-income-estimate"
  | "net-income-actual";

export type StocksEarningsSourceRef = {
  provider: StocksEarningsProvider;
  url: string | null;
  fetchedAt: string;
  confidence: "official" | "structured" | "public-page";
};

export type StocksCompanyGuidance = {
  revenueLow: number | null;
  revenueHigh: number | null;
  revenueMid: number | null;
  currency: string;
  source: StocksEarningsSourceRef;
};

export type StocksCalendarEarningsItem = StocksEarningsComparison & {
  status: StocksEarningsStatus;
  reportDateSource: StocksEarningsSourceRef | null;
  companyGuidance: StocksCompanyGuidance | null;
  completeness: {
    complete: boolean;
    missing: StocksEarningsMissingField[];
    attemptedProviders: StocksEarningsProvider[];
  };
};

function uniqueProviders(providers: StocksEarningsProvider[]) {
  return [...new Set(providers)];
}

export function assessCalendarEarningsCompleteness(
  item: StocksCalendarEarningsItem,
): StocksCalendarEarningsItem["completeness"] {
  const missing: StocksEarningsMissingField[] = [];
  if (item.revenue.estimate === null) missing.push("revenue-estimate");
  if (item.status !== "upcoming" && item.revenue.actual === null) {
    missing.push("revenue-actual");
  }
  if (item.netIncome.estimate === null) missing.push("net-income-estimate");
  if (item.status !== "upcoming" && item.netIncome.actual === null) {
    missing.push("net-income-actual");
  }
  return {
    complete: missing.length === 0,
    missing,
    attemptedProviders: uniqueProviders(
      item.completeness.attemptedProviders,
    ),
  };
}

function utcDay(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) return null;
  return Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
}

function reportTimestamp(item: StocksCalendarEarningsItem) {
  return item.reportDate ? utcDay(item.reportDate) : null;
}

function periodKey(item: StocksCalendarEarningsItem) {
  return `${item.ticker.trim().toUpperCase()}-${item.fiscalYear}-${item.quarter}`;
}

function qualityScore(item: StocksCalendarEarningsItem) {
  const values = [
    item.revenue.estimate,
    item.revenue.actual,
    item.netIncome.estimate,
    item.netIncome.actual,
  ].filter((value) => value !== null).length;
  const officialDate = item.reportDateSource?.confidence === "official" ? 4 : 0;
  return values * 10 + officialDate;
}

function preferItem(
  current: StocksCalendarEarningsItem,
  candidate: StocksCalendarEarningsItem,
) {
  const scoreDelta = qualityScore(candidate) - qualityScore(current);
  if (scoreDelta !== 0) return scoreDelta > 0 ? candidate : current;
  const currentGenerated = Date.parse(current.generatedAt);
  const candidateGenerated = Date.parse(candidate.generatedAt);
  return candidateGenerated > currentGenerated ? candidate : current;
}

export function buildCalendarYearEarnings({
  now,
  comparisons,
  calendarYear = now.getUTCFullYear(),
  maxItems = 4,
}: {
  now: Date;
  comparisons: StocksCalendarEarningsItem[];
  calendarYear?: number;
  maxItems?: number;
}) {
  const nowDay = utcDay(now);
  if (nowDay === null) return [];

  const selected = new Map<string, StocksCalendarEarningsItem>();
  for (const rawItem of comparisons) {
    const reportDay = reportTimestamp(rawItem);
    if (reportDay === null) continue;
    const reportDate = new Date(reportDay);
    if (reportDate.getUTCFullYear() !== calendarYear) continue;

    const daysUntilReport = (reportDay - nowDay) / DAY_MS;
    if (daysUntilReport > 15) continue;

    const provisionalStatus: StocksEarningsStatus =
      daysUntilReport > 0 ? "upcoming" : "reported";
    const provisional = { ...rawItem, status: provisionalStatus };
    const completeness = assessCalendarEarningsCompleteness(provisional);
    if (provisionalStatus === "upcoming" && !completeness.complete) continue;

    const item: StocksCalendarEarningsItem = {
      ...provisional,
      status:
        provisionalStatus === "upcoming"
          ? "upcoming"
          : completeness.complete
            ? "reported"
            : "incomplete",
      completeness,
    };
    const key = periodKey(item);
    const existing = selected.get(key);
    selected.set(key, existing ? preferItem(existing, item) : item);
  }

  return [...selected.values()]
    .sort((left, right) => {
      if (left.status === "upcoming" && right.status !== "upcoming") return -1;
      if (right.status === "upcoming" && left.status !== "upcoming") return 1;
      return (reportTimestamp(right) ?? 0) - (reportTimestamp(left) ?? 0);
    })
    .slice(0, Math.max(0, Math.floor(maxItems)));
}
