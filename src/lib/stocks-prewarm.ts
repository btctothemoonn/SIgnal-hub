import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ALPHA_RESEARCH_STOCKS,
  type AlphaResearchStock,
} from "./alpha-research-pool.ts";
import { getStocksCatalystSnapshot } from "./stocks-catalyst-source.ts";
import type { StocksCatalystSnapshot } from "./stocks-catalyst-data.ts";
import {
  getStocksFinancialSnapshot,
  mergeStocksFinancialSnapshot,
  type StocksFinancialStatement,
  type StocksFinancialSnapshot,
} from "./stocks-financial-data.ts";
import { enrichStocksFinancialSnapshotWithInsights } from "./stocks-earnings-insight.ts";
import {
  mergeEarningsMetricValues,
  normalizeStocksEarningsValueProvenance,
  type StocksEarningsValueProvenance,
  type StocksEarningsComparison,
} from "./stocks-earnings-comparison.ts";
import {
  assessCalendarEarningsCompleteness,
  buildCalendarYearEarnings,
  type StocksCalendarEarningsItem,
} from "./stocks-earnings-calendar.ts";
import {
  getStocksMarketSnapshot,
  type StocksMarketDataProvider,
  type StocksMarketSnapshot,
} from "./stocks-market-data.ts";
import { recordStocksPerformanceSnapshot } from "./stocks-performance-data.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StocksSnapshotKind = "market" | "financial" | "catalysts";

type CacheableStocksSnapshot = {
  generatedAt: string;
  source: "live" | "mock";
  provider: string;
  errors: string[];
};

type StocksSnapshotByKind = {
  market: StocksMarketSnapshot;
  financial: StocksFinancialSnapshot;
  catalysts: StocksCatalystSnapshot;
};

export type StocksPrewarmResult = {
  kind: StocksSnapshotKind;
  success: boolean;
  status: "live" | "mock" | "skipped" | "error";
  provider: string | null;
  generatedAt: string | null;
  error: string | null;
};

type StocksPrewarmLoaders = {
  market?: () => Promise<StocksMarketSnapshot>;
  financial?: () => Promise<StocksFinancialSnapshot>;
  catalysts?: () => Promise<StocksCatalystSnapshot>;
};

const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const KINDS: StocksSnapshotKind[] = ["market", "financial", "catalysts"];

const CACHE_CONFIG: Record<
  StocksSnapshotKind,
  {
    pathEnv: string;
    defaultFile: string;
    maxAgeEnv: string;
    defaultMaxAgeMs: number;
  }
> = {
  market: {
    pathEnv: "STOCKS_MARKET_CACHE_PATH",
    defaultFile: "stocks-market-snapshot.json",
    maxAgeEnv: "STOCKS_MARKET_CACHE_MS",
    defaultMaxAgeMs: 60 * 60 * 1000,
  },
  financial: {
    pathEnv: "STOCKS_FINANCIAL_CACHE_PATH",
    defaultFile: "stocks-financial-snapshot.json",
    maxAgeEnv: "STOCKS_FINANCIAL_CACHE_MS",
    defaultMaxAgeMs: 12 * 60 * 60 * 1000,
  },
  catalysts: {
    pathEnv: "STOCKS_CATALYST_CACHE_PATH",
    defaultFile: "stocks-catalysts-snapshot.json",
    maxAgeEnv: "STOCKS_CATALYST_CACHE_MS",
    defaultMaxAgeMs: 60 * 60 * 1000,
  },
};

const PREWARM_INTERVALS: Record<StocksSnapshotKind, number> = {
  market: 5 * 60 * 1000,
  catalysts: 15 * 60 * 1000,
  financial: 60 * 60 * 1000,
};

function nonNegativeInt(
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function isEnabled(raw: string | undefined, fallback = true) {
  if (raw === undefined) return fallback;
  return !FALSE_VALUES.has(raw.trim().toLowerCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cacheMaxAgeMs(kind: StocksSnapshotKind, env: EnvLike) {
  if (kind === "catalysts" && env.STOCKS_CATALYST_CACHE_MS === undefined) {
    return nonNegativeInt(
      env.STOCKS_NEWS_CACHE_MS,
      CACHE_CONFIG.catalysts.defaultMaxAgeMs,
      24 * 60 * 60 * 1000,
    );
  }
  const config = CACHE_CONFIG[kind];
  return nonNegativeInt(
    env[config.maxAgeEnv],
    config.defaultMaxAgeMs,
    24 * 60 * 60 * 1000,
  );
}

function snapshotTime(snapshot: CacheableStocksSnapshot) {
  const generatedAt = Date.parse(snapshot.generatedAt);
  return Number.isFinite(generatedAt) ? generatedAt : 0;
}

export type StocksSnapshotHealth = {
  ageMs: number;
  maxAgeMs: number;
  stale: boolean;
};

export function getStocksSnapshotHealth(
  kind: StocksSnapshotKind,
  snapshot: CacheableStocksSnapshot,
  env: EnvLike = process.env,
  now = Date.now(),
): StocksSnapshotHealth {
  const configuredMaxAgeMs = cacheMaxAgeMs(kind, env);
  const maxAgeMs =
    kind === "financial" && env.STOCKS_FINANCIAL_CACHE_MS === undefined
      ? financialRefreshMaxAgeMs(
          snapshot as unknown as StocksFinancialSnapshot,
          now,
          configuredMaxAgeMs,
        )
      : configuredMaxAgeMs;
  const generatedAt = snapshotTime(snapshot);
  const ageMs = generatedAt > 0 ? Math.max(0, now - generatedAt) : Number.POSITIVE_INFINITY;
  return {
    ageMs,
    maxAgeMs,
    stale: generatedAt <= 0 || ageMs > maxAgeMs,
  };
}

function financialRefreshMaxAgeMs(
  snapshot: StocksFinancialSnapshot,
  now: number,
  fallback: number,
) {
  const currentDay = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  let hasUpcomingWindow = false;
  for (const statement of Object.values(snapshot.financials ?? {})) {
    for (const item of statement.calendarYearEarnings ?? []) {
      if (!item.reportDate) continue;
      const reportTime = Date.parse(`${item.reportDate}T00:00:00Z`);
      if (!Number.isFinite(reportTime)) continue;
      const daysFromReport = (currentDay - reportTime) / 86_400_000;
      if (
        item.status === "incomplete" &&
        daysFromReport >= 0 &&
        daysFromReport <= 1
      ) {
        return 30 * 60 * 1000;
      }
      const daysUntilReport = -daysFromReport;
      if (
        item.status === "upcoming" &&
        daysUntilReport >= 0 &&
        daysUntilReport <= 15
      ) {
        hasUpcomingWindow = true;
      }
    }
  }
  return hasUpcomingWindow ? 2 * 60 * 60 * 1000 : fallback;
}

function withCacheRefreshError<T extends CacheableStocksSnapshot>(
  snapshot: T,
  kind: StocksSnapshotKind,
  error: unknown,
) {
  return {
    ...snapshot,
    errors: [
      ...(Array.isArray(snapshot.errors) ? snapshot.errors : []),
      `${kind}: refresh failed; using cached snapshot (${errorMessage(error)})`,
    ],
  };
}

function shouldCacheSnapshot(snapshot: CacheableStocksSnapshot) {
  return snapshot.source === "live" && Boolean(snapshot.generatedAt);
}

function sameEarningsPeriod(
  left: StocksEarningsComparison,
  right: StocksEarningsComparison,
) {
  return (
    left.ticker === right.ticker &&
    left.fiscalYear === right.fiscalYear &&
    left.quarter === right.quarter
  );
}

function earningsValuePriority(
  source: StocksEarningsValueProvenance | undefined,
) {
  if (source?.method === "direct") return 2;
  if (source) return 1;
  return 0;
}

function mergeMetricValue<T extends "actual" | "estimate">(
  previous: StocksEarningsComparison["revenue"],
  next: StocksEarningsComparison["revenue"],
  field: T,
) {
  const sourceField = `${field}Source` as const;
  const previousValue = previous[field];
  const nextValue = next[field];
  if (nextValue === null) {
    return { value: previousValue, source: previous[sourceField] };
  }
  if (
    previousValue !== null &&
    earningsValuePriority(previous[sourceField]) >
      earningsValuePriority(next[sourceField])
  ) {
    return { value: previousValue, source: previous[sourceField] };
  }
  return { value: nextValue, source: next[sourceField] };
}

function normalizeEarningsMetric(
  metric: StocksEarningsComparison["revenue"],
  currency: string,
  metricName: "revenue" | "net-income",
) {
  let estimateSource: StocksEarningsValueProvenance | undefined;
  let actualSource: StocksEarningsValueProvenance | undefined;
  if (metric.estimate !== null && metric.estimateSource) {
    estimateSource = normalizeStocksEarningsValueProvenance(
      metric.estimateSource,
      {
        currency,
        unit: "monetary",
        scale: "raw",
        metric: metricName,
        semantics: "consensus-estimate",
      },
    );
  }
  if (metric.actual !== null && metric.actualSource) {
    actualSource = normalizeStocksEarningsValueProvenance(
      metric.actualSource,
      {
        currency,
        unit: "monetary",
        scale: "raw",
        metric: metricName,
        semantics: "statement-actual",
      },
    );
  }
  return {
    ...metric,
    ...(estimateSource ? { estimateSource } : {}),
    ...(actualSource ? { actualSource } : {}),
  };
}

function normalizeEarningsComparison(
  comparison: StocksEarningsComparison | null | undefined,
) {
  if (!comparison) return null;
  return {
    ...comparison,
    revenue: normalizeEarningsMetric(
      comparison.revenue,
      comparison.currency,
      "revenue",
    ),
    netIncome: normalizeEarningsMetric(
      comparison.netIncome,
      comparison.currency,
      "net-income",
    ),
  };
}

function normalizeCalendarEarningsItem(
  item: StocksCalendarEarningsItem | null | undefined,
) {
  if (!item) return null;
  const comparison = normalizeEarningsComparison(item);
  if (!comparison) return null;
  const status =
    item.status === "upcoming" ||
    item.status === "reported" ||
    item.status === "incomplete"
      ? item.status
      : "incomplete";
  const normalized: StocksCalendarEarningsItem = {
    ...comparison,
    status,
    reportDateSource: item.reportDateSource ?? null,
    companyGuidance: item.companyGuidance ?? null,
    completeness: {
      complete: false,
      missing: [],
      attemptedProviders: [
        ...new Set(item.completeness?.attemptedProviders ?? [item.provider]),
      ],
    },
  };
  return {
    ...normalized,
    completeness: assessCalendarEarningsCompleteness(normalized),
  };
}

function normalizeStocksFinancialStatement(
  statement: StocksFinancialStatement,
  now = new Date(),
) {
  return {
    ...statement,
    ...(statement.latestEarnings === undefined
      ? {}
      : { latestEarnings: normalizeEarningsComparison(statement.latestEarnings) }),
    ...(statement.earningsHistory === undefined
      ? {}
      : {
          earningsHistory: statement.earningsHistory
            .map((item) => normalizeEarningsComparison(item))
            .filter(
              (item): item is StocksEarningsComparison => item !== null,
            ),
        }),
    ...(statement.calendarYearEarnings === undefined
      ? {}
      : {
          calendarYearEarnings: buildCalendarYearEarnings({
            now,
            comparisons: statement.calendarYearEarnings
              .map((item) => normalizeCalendarEarningsItem(item))
              .filter(
                (item): item is StocksCalendarEarningsItem => item !== null,
              ),
          }),
        }),
  };
}

function normalizeStocksFinancialSnapshot(
  snapshot: StocksFinancialSnapshot,
  now = new Date(),
) {
  const normalized = {
    ...snapshot,
    financials: Object.fromEntries(
      Object.entries(snapshot.financials).map(([ticker, statement]) => [
        ticker,
        normalizeStocksFinancialStatement(statement, now),
      ]),
    ),
  };
  return {
    snapshot: normalized,
    changed: JSON.stringify(snapshot) !== JSON.stringify(normalized),
  };
}

function mergeCalendarEarningsItems(
  previous: StocksCalendarEarningsItem[] | undefined,
  next: StocksCalendarEarningsItem[] | undefined,
  now: Date,
) {
  const priorItems = (previous ?? [])
    .map((item) => normalizeCalendarEarningsItem(item))
    .filter((item): item is StocksCalendarEarningsItem => item !== null);
  const nextItems = (next ?? [])
    .map((item) => normalizeCalendarEarningsItem(item))
    .filter((item): item is StocksCalendarEarningsItem => item !== null);
  const priorByPeriod = new Map(
    priorItems.map((item) => [`${item.ticker}-${item.fiscalYear}-${item.quarter}`, item]),
  );
  const merged: StocksCalendarEarningsItem[] = [];

  for (const item of nextItems) {
    const key = `${item.ticker}-${item.fiscalYear}-${item.quarter}`;
    const prior = priorByPeriod.get(key);
    if (!prior) {
      merged.push(item);
      continue;
    }
    const comparison = mergeEarningsComparison(prior, item) ?? item;
    const status = item.status === "upcoming" ? "upcoming" : "reported";
    const combined: StocksCalendarEarningsItem = {
      ...comparison,
      status,
      reportDateSource: item.reportDateSource ?? prior.reportDateSource,
      companyGuidance: item.companyGuidance ?? prior.companyGuidance,
      completeness: {
        complete: false,
        missing: [],
        attemptedProviders: [
          ...new Set([
            ...prior.completeness.attemptedProviders,
            ...item.completeness.attemptedProviders,
          ]),
        ],
      },
    };
    const completeness = assessCalendarEarningsCompleteness(combined);
    merged.push({
      ...combined,
      status:
        status === "upcoming"
          ? "upcoming"
          : completeness.complete
            ? "reported"
            : "incomplete",
      completeness,
    });
    priorByPeriod.delete(key);
  }
  merged.push(...priorByPeriod.values());
  return buildCalendarYearEarnings({ now, comparisons: merged });
}

function mergeEarningsComparison(
  previous: StocksEarningsComparison | null | undefined,
  next: StocksEarningsComparison | null | undefined,
) {
  const normalizedPrevious = normalizeEarningsComparison(previous);
  const normalizedNext = normalizeEarningsComparison(next);
  if (!normalizedNext) return normalizedPrevious;
  if (!normalizedPrevious || !sameEarningsPeriod(normalizedPrevious, normalizedNext)) {
    return normalizedNext;
  }
  const mergeMetric = (
    prior: StocksEarningsComparison["revenue"],
    current: StocksEarningsComparison["revenue"],
  ) => {
    const actual = mergeMetricValue(prior, current, "actual");
    const estimate = mergeMetricValue(prior, current, "estimate");
    const patch: Parameters<typeof mergeEarningsMetricValues>[1] = {
    };
    const sourcePatch: Pick<
      Parameters<typeof mergeEarningsMetricValues>[1],
      "actualSource" | "estimateSource"
    > = {};
    let rawValuesChanged = false;
    const previousYearActual =
      current.previousYearActual ?? prior.previousYearActual;
    if (previousYearActual !== current.previousYearActual) {
      patch.previousYearActual = previousYearActual;
      rawValuesChanged = true;
    }
    if (actual.value !== current.actual) {
      patch.actual = actual.value;
      rawValuesChanged = true;
      if (actual.source) sourcePatch.actualSource = actual.source;
    } else if (actual.source && actual.source !== current.actualSource) {
      sourcePatch.actualSource = actual.source;
    }
    if (estimate.value !== current.estimate) {
      patch.estimate = estimate.value;
      rawValuesChanged = true;
      if (estimate.source) sourcePatch.estimateSource = estimate.source;
    } else if (estimate.source && estimate.source !== current.estimateSource) {
      sourcePatch.estimateSource = estimate.source;
    }
    if (rawValuesChanged) {
      return mergeEarningsMetricValues(current, {
        ...patch,
        ...sourcePatch,
      });
    }
    return Object.keys(sourcePatch).length > 0
      ? { ...current, ...sourcePatch }
      : current;
  };
  const revenue = mergeMetric(normalizedPrevious.revenue, normalizedNext.revenue);
  const netIncome = mergeMetric(
    normalizedPrevious.netIncome,
    normalizedNext.netIncome,
  );
  return {
    ...normalizedNext,
    revenue,
    netIncome,
  };
}

function mergeFinancialStatement(
  previous: StocksFinancialStatement | undefined,
  next: StocksFinancialStatement,
  now: Date,
): StocksFinancialStatement {
  if (!previous) return normalizeStocksFinancialStatement(next, now);
  const latestEarnings = mergeEarningsComparison(
    previous.latestEarnings,
    next.latestEarnings,
  );
  const consensusRegressed = Boolean(
    next.latestEarnings &&
      previous.latestEarnings &&
      sameEarningsPeriod(next.latestEarnings, previous.latestEarnings) &&
      ((next.latestEarnings.revenue.estimate === null &&
        previous.latestEarnings.revenue.estimate !== null) ||
        (next.latestEarnings.revenue.estimate !== null &&
          previous.latestEarnings.revenue.estimate !== null &&
          earningsValuePriority(next.latestEarnings.revenue.estimateSource) <
            earningsValuePriority(previous.latestEarnings.revenue.estimateSource)) ||
        (next.latestEarnings.netIncome.estimate === null &&
          previous.latestEarnings.netIncome.estimate !== null) ||
        (next.latestEarnings.netIncome.estimate !== null &&
          previous.latestEarnings.netIncome.estimate !== null &&
          earningsValuePriority(next.latestEarnings.netIncome.estimateSource) <
            earningsValuePriority(previous.latestEarnings.netIncome.estimateSource))),
  );
  const priorHistory = new Map(
    (previous.earningsHistory ?? []).map((item) => [
      `${item.fiscalYear}-${item.quarter}`,
      item,
    ]),
  );
  const history = (next.earningsHistory ?? []).map((item) =>
    mergeEarningsComparison(
      priorHistory.get(`${item.fiscalYear}-${item.quarter}`),
      item,
    ),
  );
  for (const item of previous.earningsHistory ?? []) {
    const key = `${item.fiscalYear}-${item.quarter}`;
    if (!(next.earningsHistory ?? []).some(
      (candidate) => `${candidate.fiscalYear}-${candidate.quarter}` === key,
    )) {
      const normalizedItem = normalizeEarningsComparison(item);
      if (normalizedItem) history.push(normalizedItem);
    }
  }
  return {
    ...next,
    latestEarnings,
    earningsHistory: history
      .filter((item): item is StocksEarningsComparison => item !== null)
      .sort(
        (left, right) =>
          Date.parse(right.fiscalDateEnding) - Date.parse(left.fiscalDateEnding),
      )
      .slice(0, 8),
    calendarYearEarnings: mergeCalendarEarningsItems(
      previous.calendarYearEarnings,
      next.calendarYearEarnings,
      now,
    ),
    earningsInsight:
      (consensusRegressed ? previous.earningsInsight : next.earningsInsight) ??
      (latestEarnings &&
      previous.latestEarnings &&
      sameEarningsPeriod(latestEarnings, previous.latestEarnings)
        ? previous.earningsInsight
        : null),
  };
}

export function preserveSuccessfulFinancialEntries(
  previous: StocksFinancialSnapshot | null,
  next: StocksFinancialSnapshot,
  now = new Date(next.generatedAt),
): StocksFinancialSnapshot {
  const effectiveNow = Number.isFinite(now.getTime()) ? now : new Date();
  if (!previous) {
    return normalizeStocksFinancialSnapshot(next, effectiveNow).snapshot;
  }
  const financials = { ...previous.financials };
  for (const [ticker, statement] of Object.entries(next.financials)) {
    financials[ticker] = mergeFinancialStatement(
      previous.financials[ticker],
      statement,
      effectiveNow,
    );
  }
  return { ...next, financials };
}

export function isStocksCachePrewarmEnabled(env: EnvLike = process.env) {
  return isEnabled(env.STOCKS_CACHE_PREWARM_ENABLED, true);
}

export function getStocksPrewarmIntervalMs(
  kind: StocksSnapshotKind,
  env: EnvLike = process.env,
) {
  const envKey =
    kind === "market"
      ? "STOCKS_CACHE_WORKER_MARKET_INTERVAL_MS"
      : kind === "financial"
        ? "STOCKS_CACHE_WORKER_FINANCIAL_INTERVAL_MS"
        : "STOCKS_CACHE_WORKER_CATALYSTS_INTERVAL_MS";
  return positiveInt(env[envKey], PREWARM_INTERVALS[kind], 24 * 60 * 60 * 1000);
}

export function isStocksPrewarmKindEnabled(
  kind: StocksSnapshotKind,
  env: EnvLike = process.env,
) {
  const envKey =
    kind === "market"
      ? "STOCKS_CACHE_PREWARM_MARKET_ENABLED"
      : kind === "financial"
        ? "STOCKS_CACHE_PREWARM_FINANCIAL_ENABLED"
        : "STOCKS_CACHE_PREWARM_CATALYSTS_ENABLED";
  return isEnabled(env[envKey], true);
}

export function getStocksSnapshotCachePath(
  kind: StocksSnapshotKind,
  env: EnvLike = process.env,
) {
  const config = CACHE_CONFIG[kind];
  return (
    env[config.pathEnv]?.trim() ||
    getRuntimeDataPath(env, config.defaultFile)
  );
}

export async function readStocksSnapshotCache<
  T extends CacheableStocksSnapshot,
>({
  kind,
  env = process.env,
  allowStale = true,
}: {
  kind: StocksSnapshotKind;
  env?: EnvLike;
  allowStale?: boolean;
}): Promise<T | null> {
  try {
    const raw = await readFile(getStocksSnapshotCachePath(kind, env), "utf8");
    const snapshot = JSON.parse(raw) as T;
    if (!snapshot || typeof snapshot !== "object") return null;
    if (!snapshot.generatedAt || !snapshot.source || !snapshot.provider) {
      return null;
    }
    const health = getStocksSnapshotHealth(kind, snapshot, env, Date.now());
    if (!allowStale && health.stale) return null;
    if (kind !== "financial") return snapshot;
    const migration = normalizeStocksFinancialSnapshot(
      snapshot as unknown as StocksFinancialSnapshot,
    );
    if (migration.changed) {
      await writeStocksSnapshotCache({
        kind,
        env,
        snapshot: migration.snapshot,
      });
    }
    return migration.snapshot as unknown as T;
  } catch {
    return null;
  }
}

export async function writeStocksSnapshotCache<
  T extends CacheableStocksSnapshot,
>({
  kind,
  env = process.env,
  snapshot,
}: {
  kind: StocksSnapshotKind;
  env?: EnvLike;
  snapshot: T;
}) {
  if (!shouldCacheSnapshot(snapshot)) return;
  const cachePath = getStocksSnapshotCachePath(kind, env);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(snapshot), "utf8");
}

export async function getCachedStocksSnapshot<
  T extends CacheableStocksSnapshot,
>({
  kind,
  env = process.env,
  force = false,
  now = Date.now(),
  loader,
}: {
  kind: StocksSnapshotKind;
  env?: EnvLike;
  force?: boolean;
  now?: number;
  loader: () => Promise<T>;
}): Promise<T> {
  const cached = await readStocksSnapshotCache<T>({
    kind,
    env,
    allowStale: true,
  });
  if (
    cached &&
    !force &&
    !getStocksSnapshotHealth(kind, cached, env, now).stale
  ) {
    return cached;
  }

  try {
    const snapshot = await loader();
    const candidate =
      kind === "financial" && cached
        ? (preserveSuccessfulFinancialEntries(
            cached as unknown as StocksFinancialSnapshot,
            snapshot as unknown as StocksFinancialSnapshot,
          ) as unknown as T)
        : snapshot;
    if (shouldCacheSnapshot(candidate)) {
      await writeStocksSnapshotCache({ kind, env, snapshot: candidate });
      return candidate;
    }
    if (cached) {
      const reason =
        snapshot.errors.find(Boolean) ??
        `refresh returned ${snapshot.source} data`;
      return withCacheRefreshError(cached, kind, reason);
    }
    return snapshot;
  } catch (error) {
    if (cached) return withCacheRefreshError(cached, kind, error);
    throw error;
  }
}

export function resolveStocksMarketProvider(
  env: EnvLike = process.env,
): StocksMarketDataProvider | undefined {
  const configuredProvider =
    env.STOCKS_MARKET_DATA_PROVIDER?.trim().toLowerCase();
  return configuredProvider === "mock" ||
    configuredProvider === "finnhub" ||
    configuredProvider === "massive" ||
    configuredProvider === "eodhd" ||
    configuredProvider === "yahoo" ||
    configuredProvider === "alpha-vantage" ||
    configuredProvider === "naver" ||
    configuredProvider === "fmp"
    ? configuredProvider
    : undefined;
}

export function resolveStocksFinancialProvider(
  env: EnvLike = process.env,
): "fmp" | "yahoo" | "alpha-vantage" | "mock" | undefined {
  const configuredProvider =
    env.STOCKS_FINANCIAL_DATA_PROVIDER?.trim().toLowerCase();
  return configuredProvider === "mock" ||
    configuredProvider === "yahoo" ||
    configuredProvider === "alpha-vantage" ||
    configuredProvider === "fmp"
    ? configuredProvider
    : undefined;
}

export async function getCachedStocksMarketSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  provider = resolveStocksMarketProvider(env),
  force = false,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  provider?: StocksMarketDataProvider;
  force?: boolean;
}) {
  return getCachedStocksSnapshot({
    kind: "market",
    env,
    force,
    loader: () =>
      getStocksMarketSnapshot({
        stocks,
        fetchImpl,
        env,
        ...(provider ? { provider } : {}),
      }),
  });
}

export async function getCachedStocksFinancialSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  provider = resolveStocksFinancialProvider(env),
  force = false,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  provider?: "fmp" | "yahoo" | "alpha-vantage" | "mock";
  force?: boolean;
}) {
  if (provider === "fmp" && !force) {
    const cached = await readStocksSnapshotCache<StocksFinancialSnapshot>({
      kind: "financial",
      env,
      allowStale: true,
    });
    if (cached) return cached;
  }

  return getCachedStocksSnapshot({
    kind: "financial",
    env,
    force,
    loader: async () => {
      const previous = await readStocksSnapshotCache<StocksFinancialSnapshot>({
        kind: "financial",
        env,
        allowStale: true,
      });
      const refreshStocks = prepareStocksForFinancialRefresh(
        stocks,
        previous,
      );
      const snapshot = await getStocksFinancialSnapshot({
        stocks: refreshStocks,
        fetchImpl,
        env,
        ...(provider ? { provider } : {}),
      });
      return enrichStocksFinancialSnapshotWithInsights(snapshot, {
        fetchImpl,
        env,
      });
    },
  });
}

export function prepareStocksForFinancialRefresh(
  stocks: AlphaResearchStock[],
  previous: StocksFinancialSnapshot | null,
  now = new Date(),
) {
  return mergeStocksFinancialSnapshot(stocks, previous, now);
}

export async function getCachedStocksCatalystSnapshot({
  stocks,
  fetchImpl = fetch,
  env = process.env,
  force = false,
}: {
  stocks: AlphaResearchStock[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
  force?: boolean;
}) {
  return getCachedStocksSnapshot({
    kind: "catalysts",
    env,
    force,
    loader: () =>
      getStocksCatalystSnapshot({
        stocks,
        fetchImpl,
        env,
      }),
  });
}

async function defaultLoaderForKind({
  kind,
  stocks,
  env,
  loaders,
}: {
  kind: StocksSnapshotKind;
  stocks: AlphaResearchStock[];
  env: EnvLike;
  loaders: StocksPrewarmLoaders;
}): Promise<StocksSnapshotByKind[typeof kind]> {
  if (kind === "market") {
    return (loaders.market
      ? await loaders.market()
      : await getCachedStocksMarketSnapshot({ stocks, env, force: true })) as
      StocksSnapshotByKind[typeof kind];
  }
  if (kind === "financial") {
    return (loaders.financial
      ? await loaders.financial()
      : await getCachedStocksFinancialSnapshot({ stocks, env, force: true })) as
      StocksSnapshotByKind[typeof kind];
  }
  return (loaders.catalysts
    ? await loaders.catalysts()
    : await getCachedStocksCatalystSnapshot({ stocks, env, force: true })) as
    StocksSnapshotByKind[typeof kind];
}

function skippedResult(kind: StocksSnapshotKind): StocksPrewarmResult {
  return {
    kind,
    success: true,
    status: "skipped",
    provider: null,
    generatedAt: null,
    error: null,
  };
}

function resultFromSnapshot(
  kind: StocksSnapshotKind,
  snapshot: CacheableStocksSnapshot,
): StocksPrewarmResult {
  return {
    kind,
    success: snapshot.source === "live",
    status: snapshot.source,
    provider: snapshot.provider,
    generatedAt: snapshot.generatedAt,
    error: snapshot.errors.find(Boolean) ?? null,
  };
}

export async function prewarmStocksCaches({
  env = process.env,
  stocks = ALPHA_RESEARCH_STOCKS,
  kinds = KINDS,
  loaders = {},
}: {
  env?: EnvLike;
  stocks?: AlphaResearchStock[];
  kinds?: StocksSnapshotKind[];
  loaders?: StocksPrewarmLoaders;
} = {}): Promise<StocksPrewarmResult[]> {
  if (!isStocksCachePrewarmEnabled(env)) {
    return kinds.map(skippedResult);
  }

  const results: StocksPrewarmResult[] = [];
  for (const kind of kinds) {
    if (!isStocksPrewarmKindEnabled(kind, env)) {
      results.push(skippedResult(kind));
      continue;
    }
    try {
      const snapshot = await defaultLoaderForKind({ kind, stocks, env, loaders });
      if (shouldCacheSnapshot(snapshot)) {
        await writeStocksSnapshotCache({ kind, env, snapshot });
      }
      if (kind === "market" && snapshot.source === "live") {
        try {
          recordStocksPerformanceSnapshot({
            snapshot: snapshot as StocksMarketSnapshot,
            env,
          });
        } catch {}
      }
      results.push(resultFromSnapshot(kind, snapshot));
    } catch (error) {
      results.push({
        kind,
        success: false,
        status: "error",
        provider: null,
        generatedAt: null,
        error: errorMessage(error),
      });
    }
  }
  return results;
}
