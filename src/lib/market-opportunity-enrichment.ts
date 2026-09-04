import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";
import type { MarketOpportunityMetrics } from "./market-opportunity-core.ts";
import type { BinanceMarketClient } from "./market-alerts-binance.ts";
import type {
  MarketOpportunitySeed,
  StoredOpportunityEnrichment,
} from "./market-alerts-store.ts";

type KlineRow = unknown[];
type JsonRecord = Record<string, unknown>;

export type OpportunityEnrichmentResult = {
  symbol: string;
  metrics: MarketOpportunityMetrics;
  fetchedAt: string;
  stale: boolean;
  error: string | null;
  source: "cache" | "network" | "stale-cache" | "partial";
};

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function close(row: KlineRow | undefined) {
  return numberValue(row?.[4]);
}

function high(row: KlineRow | undefined) {
  return numberValue(row?.[2]);
}

function low(row: KlineRow | undefined) {
  return numberValue(row?.[3]);
}

function volume(row: KlineRow | undefined) {
  return numberValue(row?.[5]);
}

function percent(current: number | null, previous: number | null) {
  return current !== null && previous !== null && previous !== 0
    ? ((current / previous) - 1) * 100
    : null;
}

function changeForIntervals(rows: KlineRow[], intervals: number) {
  if (rows.length <= intervals) return null;
  return percent(close(rows.at(-1)), close(rows.at(-1 - intervals)));
}

function average(values: Array<number | null>) {
  const finite = values.filter((item): item is number => item !== null);
  return finite.length
    ? finite.reduce((sum, item) => sum + item, 0) / finite.length
    : null;
}

function volumeRatio(rows: KlineRow[], recentCount: number, baselineCount: number) {
  if (rows.length < recentCount + 1) return null;
  const recent = average(rows.slice(-recentCount).map(volume));
  const baselineEnd = rows.length - recentCount;
  const baseline = average(
    rows.slice(Math.max(0, baselineEnd - baselineCount), baselineEnd).map(volume),
  );
  return recent !== null && baseline !== null && baseline > 0
    ? recent / baseline
    : null;
}

function extreme(rows: KlineRow[], reader: (row: KlineRow) => number | null, mode: "max" | "min") {
  const values = rows.map(reader).filter((item): item is number => item !== null);
  if (!values.length) return null;
  return mode === "max" ? Math.max(...values) : Math.min(...values);
}

function openInterestMetrics(rows: JsonRecord[], price: number | null) {
  const values = rows
    .map((row) => numberValue(row.sumOpenInterestValue) ?? numberValue(row.sumOpenInterest))
    .filter((item): item is number => item !== null);
  if (values.length < 2) return { growth: null, notional: null };
  const growth = percent(values.at(-1) ?? null, values[0]);
  const latest = rows.at(-1);
  const directNotional = numberValue(latest?.sumOpenInterestValue);
  const quantity = numberValue(latest?.sumOpenInterest);
  return {
    growth,
    notional:
      directNotional ??
      (quantity !== null && price !== null ? quantity * price : null),
  };
}

function optionalMetric(source: Record<string, unknown> | null, key: string) {
  return numberValue(source?.[key]);
}

export function deriveOpportunityMetrics(input: {
  seed: MarketOpportunitySeed;
  futures5m: KlineRow[];
  futures1m: KlineRow[];
  spot5m: KlineRow[] | null;
  premium: JsonRecord | null;
  openInterest: JsonRecord[];
  globalLongShortRatio: number | null;
  topTraderLongShortRatio: number | null;
  takerBuySellRatio: number | null;
  observedAt: string;
  stale?: boolean;
}): MarketOpportunityMetrics {
  const latestPrice = close(input.futures5m.at(-1)) ?? input.seed.price;
  const prior20 = input.futures5m.slice(-21, -1);
  const recentHigh = extreme(input.futures5m, high, "max");
  const recentLow = extreme(input.futures5m, low, "min");
  const shortSupport = extreme(input.futures5m.slice(-13, -1), low, "min");
  const previousStructureHigh = extreme(input.futures5m.slice(-7, -4), high, "max");
  const latestStructureHigh = extreme(input.futures5m.slice(-4), high, "max");
  const oi = openInterestMetrics(input.openInterest, latestPrice);
  const squeeze = input.seed.squeezeMetrics;
  const markPrice = numberValue(input.premium?.markPrice);
  const indexPrice = numberValue(input.premium?.indexPrice);
  const derivedBasis = percent(markPrice, indexPrice);
  const futures15m = changeForIntervals(input.futures5m, 3);
  const spot15m = input.spot5m ? changeForIntervals(input.spot5m, 3) : null;
  const perpSpotDivergence =
    futures15m !== null && spot15m !== null ? futures15m - spot15m : null;
  const priorRunUp = percent(recentHigh, recentLow);

  return {
    symbol: input.seed.symbol,
    observedAt: input.observedAt,
    stale: input.stale ?? false,
    pct1m: changeForIntervals(input.futures1m, 1),
    pct5m: changeForIntervals(input.futures5m, 1),
    pct15m: optionalMetric(squeeze, "priceChange15m") ?? futures15m,
    pct1h: changeForIntervals(input.futures5m, 12),
    pct24h: input.seed.pct24h,
    volumeRatio1m: volumeRatio(input.futures1m, 1, 20),
    volumeRatio5m:
      optionalMetric(squeeze, "volRatio") ?? volumeRatio(input.futures5m, 3, 24),
    oiGrowth15m: optionalMetric(squeeze, "oiGrowth15m") ?? oi.growth,
    oiNotional: optionalMetric(squeeze, "oiNotional") ?? oi.notional,
    funding:
      optionalMetric(squeeze, "funding") ??
      numberValue(input.premium?.lastFundingRate),
    basis: optionalMetric(squeeze, "basis") ?? derivedBasis,
    globalLongShortRatio:
      optionalMetric(squeeze, "globalLongShortRatio") ??
      input.globalLongShortRatio,
    topTraderLongShortRatio:
      optionalMetric(squeeze, "topTraderLongShortRatio") ??
      input.topTraderLongShortRatio,
    takerBuySellRatio:
      optionalMetric(squeeze, "takerBuySellRatio") ?? input.takerBuySellRatio,
    spotAvailable: Boolean(input.spot5m?.length),
    spotChange15m: spot15m,
    spotVolumeRatio5m: input.spot5m ? volumeRatio(input.spot5m, 3, 24) : null,
    perpSpotDivergencePct: perpSpotDivergence,
    distanceFromHighPct: percent(latestPrice, recentHigh),
    distanceFromLowPct: percent(latestPrice, recentLow),
    priorRunUpPct: priorRunUp,
    supportBreak:
      latestPrice !== null && shortSupport !== null && latestPrice < shortSupport,
    lowerStructure:
      latestStructureHigh !== null &&
      previousStructureHigh !== null &&
      latestStructureHigh < previousStructureHigh &&
      (changeForIntervals(input.futures5m, 3) ?? 0) < 0,
    breakout20:
      Boolean(optionalMetric(squeeze, "breakout20")) ||
      (latestPrice !== null &&
        extreme(prior20, high, "max") !== null &&
        latestPrice > Number(extreme(prior20, high, "max"))),
    quoteVolume: input.seed.quoteVolume,
    marketCapUsd: input.seed.marketCapUsd,
    fdvUsd: input.seed.fdvUsd,
    alertCounts: input.seed.alertCounts,
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function hasMetric(source: Record<string, unknown> | null, key: string) {
  return optionalMetric(source, key) !== null;
}

function emptyMetrics(seed: MarketOpportunitySeed, observedAt: string) {
  return deriveOpportunityMetrics({
    seed,
    futures5m: [],
    futures1m: [],
    spot5m: null,
    premium: null,
    openInterest: [],
    globalLongShortRatio: null,
    topTraderLongShortRatio: null,
    takerBuySellRatio: null,
    observedAt,
    stale: true,
  });
}

export async function enrichOpportunitySeeds(input: {
  seeds: MarketOpportunitySeed[];
  client: BinanceMarketClient;
  getCached: (symbol: string) => StoredOpportunityEnrichment | null;
  nowMs?: number;
  maxCandidates?: number;
  concurrency?: number;
}): Promise<OpportunityEnrichmentResult[]> {
  const nowMs = input.nowMs ?? Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const seeds = input.seeds.slice(
    0,
    Math.min(
      MARKET_OPPORTUNITY_RULES.enrichmentLimit,
      input.maxCandidates ?? MARKET_OPPORTUNITY_RULES.enrichmentLimit,
    ),
  );
  let premiumRowsPromise: Promise<JsonRecord[]> | null = null;

  async function premiumForSymbol(symbol: string) {
    if (!input.client.getPremiumIndex) return null;
    premiumRowsPromise ??= input.client.getPremiumIndex();
    const rows = await premiumRowsPromise;
    return rows.find(
      (row) => String(row.symbol ?? "").toUpperCase() === symbol.toUpperCase(),
    ) ?? null;
  }

  return mapLimit(
    seeds,
    input.concurrency ?? MARKET_OPPORTUNITY_RULES.maxConcurrency,
    async (seed): Promise<OpportunityEnrichmentResult> => {
      const cached = input.getCached(seed.symbol);
      const cachedAt = Date.parse(cached?.fetchedAt ?? "");
      if (
        cached &&
        Number.isFinite(cachedAt) &&
        nowMs - cachedAt <= MARKET_OPPORTUNITY_RULES.enrichmentFreshMs
      ) {
        return {
          symbol: seed.symbol,
          metrics: cached.metrics,
          fetchedAt: cached.fetchedAt,
          stale: cached.stale,
          error: cached.error,
          source: "cache",
        };
      }

      try {
        const errors: string[] = [];
        const fiveMinuteResult = await Promise.resolve(
          input.client.getKlines(seed.symbol, "5m", 288),
        );
        const oneMinuteResult = await input.client
          .getKlines(seed.symbol, "1m", 30)
          .catch((error) => {
            errors.push(safeError(error));
            return [];
          });
        const squeeze = seed.squeezeMetrics;
        const premium =
          hasMetric(squeeze, "funding") && hasMetric(squeeze, "basis")
            ? null
            : await premiumForSymbol(seed.symbol).catch((error) => {
                errors.push(safeError(error));
                return null;
              });
        const openInterest =
          hasMetric(squeeze, "oiGrowth15m") && hasMetric(squeeze, "oiNotional")
            ? []
            : await input.client.getOpenInterestHistory?.(seed.symbol).catch((error) => {
                errors.push(safeError(error));
                return [];
              }) ?? [];
        const globalLongShortRatio = hasMetric(squeeze, "globalLongShortRatio")
          ? null
          : await input.client.getGlobalLongShortRatio?.(seed.symbol).catch((error) => {
              errors.push(safeError(error));
              return null;
            }) ?? null;
        const topTraderLongShortRatio = hasMetric(squeeze, "topTraderLongShortRatio")
          ? null
          : await input.client.getTopTraderPositionRatio?.(seed.symbol).catch((error) => {
              errors.push(safeError(error));
              return null;
            }) ?? null;
        const takerBuySellRatio = hasMetric(squeeze, "takerBuySellRatio")
          ? null
          : await input.client.getTakerBuySellRatio?.(seed.symbol).catch((error) => {
              errors.push(safeError(error));
              return null;
            }) ?? null;
        const spot = await input.client.getSpotContext?.(seed.symbol).catch(() => null) ?? null;
        const metrics = deriveOpportunityMetrics({
          seed,
          futures5m: fiveMinuteResult,
          futures1m: oneMinuteResult,
          spot5m: spot?.klines5m ?? null,
          premium,
          openInterest,
          globalLongShortRatio,
          topTraderLongShortRatio,
          takerBuySellRatio,
          observedAt,
        });
        return {
          symbol: seed.symbol,
          metrics,
          fetchedAt: observedAt,
          stale: false,
          error: errors.length ? [...new Set(errors)].join("; ") : null,
          source: "network",
        };
      } catch (error) {
        const message = safeError(error);
        if (cached) {
          return {
            symbol: seed.symbol,
            metrics: { ...cached.metrics, stale: true },
            fetchedAt: cached.fetchedAt,
            stale: true,
            error: message,
            source: "stale-cache",
          };
        }
        return {
          symbol: seed.symbol,
          metrics: emptyMetrics(seed, observedAt),
          fetchedAt: observedAt,
          stale: true,
          error: message,
          source: "partial",
        };
      }
    },
  );
}
