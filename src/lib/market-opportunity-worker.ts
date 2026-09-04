import { createBinanceFuturesClient } from "./market-alerts-binance.ts";
import type { BinanceMarketClient } from "./market-alerts-binance.ts";
import type { AiProviderConfig } from "./ai-provider-fallback.ts";
import { explainMarketOpportunities } from "./market-opportunity-ai.ts";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";
import {
  chooseMarketOpportunityDecision,
  scoreCapitalDrivenLong,
  scoreDistributionShort,
  scoreSqueezeLong,
} from "./market-opportunity-core.ts";
import { enrichOpportunitySeeds } from "./market-opportunity-enrichment.ts";
import {
  buildMarketOpportunityFingerprint,
  transitionMarketOpportunityCandidates,
} from "./market-opportunity-selection.ts";
import {
  openMarketAlertsStore,
  type MarketOpportunitySeed,
} from "./market-alerts-store.ts";

type Store = ReturnType<typeof openMarketAlertsStore>;

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function seedFromCandidate(
  state: ReturnType<Store["getOpportunityCandidateStates"]>[number],
): MarketOpportunitySeed {
  const metrics = state.decision.metrics;
  return {
    symbol: state.symbol,
    price: 0,
    pct24h: metrics.pct24h,
    quoteVolume: metrics.quoteVolume,
    marketCapUsd: metrics.marketCapUsd,
    fdvUsd: metrics.fdvUsd,
    latestEventAt: state.lastQualifiedAt ?? state.updatedAt,
    maxLevel: Math.max(1, Math.ceil(state.decision.score / 34)),
    maxAbsChangePct: Math.max(
      Math.abs(metrics.pct5m ?? 0),
      Math.abs(metrics.pct15m ?? 0),
    ),
    maxVolumeRatio: Math.max(
      metrics.volumeRatio1m ?? 0,
      metrics.volumeRatio5m ?? 0,
    ),
    active: true,
    alertCounts: metrics.alertCounts,
    squeezeMetrics:
      state.decision.model === "short_squeeze"
        ? {
            funding: metrics.funding,
            basis: metrics.basis,
            oiGrowth15m: metrics.oiGrowth15m,
            oiNotional: metrics.oiNotional,
            priceChange15m: metrics.pct15m,
            volRatio: metrics.volumeRatio5m,
            breakout20: metrics.breakout20,
            globalLongShortRatio: metrics.globalLongShortRatio,
            topTraderLongShortRatio: metrics.topTraderLongShortRatio,
            takerBuySellRatio: metrics.takerBuySellRatio,
          }
        : null,
    preliminaryScore: state.decision.score,
  };
}

function includeSelectedSeeds(
  freshSeeds: MarketOpportunitySeed[],
  states: ReturnType<Store["getOpportunityCandidateStates"]>,
) {
  const selectedSymbols = new Set(
    states.filter((state) => state.selected).map((state) => state.symbol),
  );
  const bySymbol = new Map<string, MarketOpportunitySeed>();
  for (const state of states.filter((item) => item.selected)) {
    bySymbol.set(state.symbol, seedFromCandidate(state));
  }
  for (const seed of freshSeeds) bySymbol.set(seed.symbol, seed);
  return [...bySymbol.values()]
    .sort(
      (left, right) =>
        Number(selectedSymbols.has(right.symbol)) -
          Number(selectedSymbols.has(left.symbol)) ||
        right.preliminaryScore - left.preliminaryScore ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, MARKET_OPPORTUNITY_RULES.enrichmentLimit);
}

export async function runMarketOpportunityScan(input: {
  store?: Store;
  client?: BinanceMarketClient;
  nowMs?: number;
  aiProviders?: AiProviderConfig[];
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  env?: Record<string, string | undefined>;
} = {}) {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const ownsStore = !input.store;
  const store = input.store ?? openMarketAlertsStore();
  const client = input.client ?? createBinanceFuturesClient({}, {
    rateLimitStore: store,
  });

  try {
    store.setMarketAlertsHeartbeat({
      worker: "opportunity",
      status: "starting",
      detail: "scanning candidates",
      now,
    });
    const previousStates = store.getOpportunityCandidateStates();
    const freshSeeds = store.getOpportunitySeedData({
      since: new Date(nowMs - 2 * 60 * 60_000).toISOString(),
      limit: MARKET_OPPORTUNITY_RULES.enrichmentLimit,
    });
    const seeds = includeSelectedSeeds(freshSeeds, previousStates);
    const enrichment = await enrichOpportunitySeeds({
      seeds,
      client,
      getCached: (symbol) => store.getOpportunityEnrichment(symbol),
      nowMs,
      maxCandidates: MARKET_OPPORTUNITY_RULES.enrichmentLimit,
      concurrency: MARKET_OPPORTUNITY_RULES.maxConcurrency,
    });

    for (const item of enrichment) {
      store.upsertOpportunityEnrichment({
        symbol: item.symbol,
        metrics: item.metrics,
        fetchedAt: item.fetchedAt,
        stale: item.stale,
        error: item.error,
      });
    }

    const decisions = enrichment.flatMap((item) => {
      const chosen = chooseMarketOpportunityDecision([
        scoreCapitalDrivenLong(item.metrics),
        scoreDistributionShort(item.metrics),
        scoreSqueezeLong(item.metrics),
      ]);
      return chosen ? [chosen] : [];
    });
    const transitioned = transitionMarketOpportunityCandidates(
      previousStates,
      decisions,
      nowMs,
    );
    const fingerprint = buildMarketOpportunityFingerprint(transitioned.selected);
    store.replaceOpportunityCandidateStates(transitioned.states);
    store.saveOpportunitySelection({
      selected: transitioned.selected,
      fingerprint,
      scannedAt: now,
      successful: true,
    });
    let aiStatus: "generated" | "failed" | "skipped" = "skipped";
    if (transitioned.selected.length > 0) {
      const policy = store.getOpportunityAiPolicy({ fingerprint, nowMs });
      if (policy.allowed) {
        store.recordOpportunityAiAttempt({ fingerprint, createdAt: now });
      }
      const aiResult = await explainMarketOpportunities({
        decisions: transitioned.selected,
        fingerprint,
        policy,
        providers: input.aiProviders,
        fetchImpl: input.fetchImpl,
        env: input.env,
        now: new Date(nowMs),
      });
      aiStatus = aiResult.status;
      if (aiResult.status === "generated") {
        store.saveOpportunityAiResult({
          fingerprint,
          items: aiResult.items,
          provider: aiResult.provider,
          generatedAt: aiResult.generatedAt ?? now,
          error: null,
        });
      } else if (aiResult.status === "failed") {
        store.saveOpportunityAiResult({
          fingerprint,
          items: null,
          provider: aiResult.provider,
          generatedAt: aiResult.generatedAt ?? now,
          error: aiResult.error ?? "AI 解释暂不可用",
        });
      }
    }
    for (const decision of decisions) {
      store.recordOpportunityDiagnostic({
        symbol: decision.symbol,
        detail: {
          score: decision.score,
          stage: decision.stage,
          decision: decision.decision,
          stale: decision.metrics.stale,
        },
        createdAt: now,
      });
    }
    store.pruneOpportunityDiagnostics(
      new Date(nowMs - MARKET_OPPORTUNITY_RULES.diagnosticRetentionMs).toISOString(),
    );
    store.setMarketAlertsHeartbeat({
      worker: "opportunity",
      status: "live",
      detail: `seeds=${seeds.length} enriched=${enrichment.length} selected=${transitioned.selected.length}`,
      meta: {
        seedCount: seeds.length,
        enrichedCount: enrichment.length,
        selectedCount: transitioned.selected.length,
        staleCount: enrichment.filter((item) => item.stale).length,
        aiStatus,
      },
      now,
    });
    return {
      seedCount: seeds.length,
      enrichedCount: enrichment.length,
      selectedCount: transitioned.selected.length,
      fingerprint,
      aiStatus,
    };
  } catch (error) {
    const message = safeError(error);
    store.setMarketAlertsHeartbeat({
      worker: "opportunity",
      status: "error",
      detail: message,
      lastError: message,
      now,
    });
    throw error;
  } finally {
    if (ownsStore) store.close();
  }
}
