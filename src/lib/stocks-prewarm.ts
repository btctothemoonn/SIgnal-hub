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
    defaultMaxAgeMs: 4 * 60 * 60 * 1000,
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
  const maxAgeMs = cacheMaxAgeMs(kind, env);
  const generatedAt = snapshotTime(snapshot);
  const ageMs = generatedAt > 0 ? Math.max(0, now - generatedAt) : Number.POSITIVE_INFINITY;
  return {
    ageMs,
    maxAgeMs,
    stale: generatedAt <= 0 || ageMs > maxAgeMs,
  };
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
) {
  const patch: Parameters<typeof mergeEarningsMetricValues>[1] = {};
  if (metric.estimate !== null && metric.estimateSource) {
    const estimateSource = normalizeStocksEarningsValueProvenance(
      metric.estimateSource,
    );
    if (estimateSource) patch.estimateSource = estimateSource;
  }
  if (metric.actual !== null && metric.actualSource) {
    const actualSource = normalizeStocksEarningsValueProvenance(
      metric.actualSource,
    );
    if (actualSource) patch.actualSource = actualSource;
  }
  return Object.keys(patch).length > 0
    ? mergeEarningsMetricValues(metric, patch)
    : metric;
}

function normalizeEarningsComparison(
  comparison: StocksEarningsComparison | null | undefined,
) {
  if (!comparison) return null;
  return {
    ...comparison,
    revenue: normalizeEarningsMetric(comparison.revenue),
    netIncome: normalizeEarningsMetric(comparison.netIncome),
  };
}

function normalizeStocksFinancialStatement(
  statement: StocksFinancialStatement,
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
  };
}

function normalizeStocksFinancialSnapshot(
  snapshot: StocksFinancialSnapshot,
) {
  const normalized = {
    ...snapshot,
    financials: Object.fromEntries(
      Object.entries(snapshot.financials).map(([ticker, statement]) => [
        ticker,
        normalizeStocksFinancialStatement(statement),
      ]),
    ),
  };
  return {
    snapshot: normalized,
    changed: JSON.stringify(snapshot) !== JSON.stringify(normalized),
  };
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
      previousYearActual:
        current.previousYearActual ?? prior.previousYearActual,
    };
    if (actual.value !== current.actual) {
      patch.actual = actual.value;
      if (actual.source) patch.actualSource = actual.source;
    } else if (actual.source && actual.source !== current.actualSource) {
      patch.actualSource = actual.source;
    }
    if (estimate.value !== current.estimate) {
      patch.estimate = estimate.value;
      if (estimate.source) patch.estimateSource = estimate.source;
    } else if (estimate.source && estimate.source !== current.estimateSource) {
      patch.estimateSource = estimate.source;
    }
    return mergeEarningsMetricValues(current, patch);
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
): StocksFinancialStatement {
  if (!previous) return next;
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
): StocksFinancialSnapshot {
  if (!previous) return next;
  const financials = { ...previous.financials };
  for (const [ticker, statement] of Object.entries(next.financials)) {
    financials[ticker] = mergeFinancialStatement(
      previous.financials[ticker],
      statement,
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
  const maxAgeMs = cacheMaxAgeMs(kind, env);
  if (maxAgeMs <= 0 && !allowStale) return null;
  try {
    const raw = await readFile(getStocksSnapshotCachePath(kind, env), "utf8");
    const snapshot = JSON.parse(raw) as T;
    if (!snapshot || typeof snapshot !== "object") return null;
    if (!snapshot.generatedAt || !snapshot.source || !snapshot.provider) {
      return null;
    }
    const ageMs = Date.now() - snapshotTime(snapshot);
    if (!allowStale && ageMs > maxAgeMs) return null;
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
  return getCachedStocksSnapshot({
    kind: "financial",
    env,
    force,
    loader: async () => {
      const snapshot = await getStocksFinancialSnapshot({
        stocks,
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
