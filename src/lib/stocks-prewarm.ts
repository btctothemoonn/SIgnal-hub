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
  type StocksFinancialSnapshot,
} from "./stocks-financial-data.ts";
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
    return snapshot;
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
  loader,
}: {
  kind: StocksSnapshotKind;
  env?: EnvLike;
  force?: boolean;
  loader: () => Promise<T>;
}): Promise<T> {
  const cached = await readStocksSnapshotCache<T>({
    kind,
    env,
    allowStale: true,
  });
  if (cached && !force) return cached;

  try {
    const snapshot = await loader();
    if (shouldCacheSnapshot(snapshot)) {
      await writeStocksSnapshotCache({ kind, env, snapshot });
      return snapshot;
    }
    if (cached) return cached;
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
    loader: () =>
      getStocksFinancialSnapshot({
        stocks,
        fetchImpl,
        env,
        ...(provider ? { provider } : {}),
      }),
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
