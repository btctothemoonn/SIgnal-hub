import { createHash } from "node:crypto";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";
import {
  chooseMarketOpportunityDecision,
  type MarketOpportunityDecision,
} from "./market-opportunity-core.ts";

export type MarketOpportunityCandidateState = {
  symbol: string;
  decision: MarketOpportunityDecision;
  entryStreak: number;
  exitStreak: number;
  enteredAt: string | null;
  lastQualifiedAt: string | null;
  lastConfirmedAt: string | null;
  selected: boolean;
  rank: number | null;
  updatedAt: string;
};

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function isActionable(decision: MarketOpportunityDecision) {
  return decision.decision === "关注做多" || decision.decision === "关注做空";
}

function dedupeIncoming(decisions: MarketOpportunityDecision[]) {
  const grouped = new Map<string, MarketOpportunityDecision[]>();
  for (const decision of decisions) {
    const symbol = decision.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const normalized = { ...decision, symbol };
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), normalized]);
  }
  return new Map(
    [...grouped].flatMap(([symbol, candidates]) => {
      const chosen =
        chooseMarketOpportunityDecision(candidates) ??
        [...candidates].sort((left, right) => right.score - left.score)[0] ??
        null;
      return chosen ? [[symbol, chosen] as const] : [];
    }),
  );
}

function downgradeExpiredConfirmation(
  decision: MarketOpportunityDecision,
  state: MarketOpportunityCandidateState,
  nowMs: number,
) {
  if (!state.lastConfirmedAt) return decision;
  const confirmedAt = timestamp(state.lastConfirmedAt);
  if (
    confirmedAt === null ||
    nowMs - confirmedAt <= MARKET_OPPORTUNITY_RULES.confirmationFreshMs ||
    isActionable(decision)
  ) {
    return decision;
  }
  return {
    ...decision,
    decision: "等待确认" as const,
    risks: [...new Set([...decision.risks, "最近一次行动确认已超过 2 小时"])],
  };
}

export function transitionMarketOpportunityCandidates(
  previous: MarketOpportunityCandidateState[],
  incoming: MarketOpportunityDecision[],
  nowMs = Date.now(),
): {
  states: MarketOpportunityCandidateState[];
  selected: MarketOpportunityDecision[];
} {
  const now = new Date(nowMs).toISOString();
  const previousBySymbol = new Map(
    previous.map((state) => [state.symbol.toUpperCase(), state]),
  );
  const incomingBySymbol = dedupeIncoming(incoming);
  const symbols = new Set([...previousBySymbol.keys(), ...incomingBySymbol.keys()]);
  const states: MarketOpportunityCandidateState[] = [];

  for (const symbol of symbols) {
    const prior = previousBySymbol.get(symbol);
    const nextDecision = incomingBySymbol.get(symbol) ?? prior?.decision;
    if (!nextDecision) continue;

    const enteredAt = timestamp(prior?.enteredAt);
    const lifetimeExpired =
      enteredAt !== null && nowMs - enteredAt > MARKET_OPPORTUNITY_RULES.maxLifetimeMs;
    const hardInvalidated = nextDecision.hardInvalidated;
    const qualifies =
      !hardInvalidated &&
      nextDecision.score >= MARKET_OPPORTUNITY_RULES.observeScore;
    const belowExit =
      !incomingBySymbol.has(symbol) ||
      nextDecision.score < MARKET_OPPORTUNITY_RULES.exitScore;

    if (lifetimeExpired) {
      states.push({
        symbol,
        decision: nextDecision,
        entryStreak: qualifies ? 1 : 0,
        exitStreak: 0,
        enteredAt: null,
        lastQualifiedAt: qualifies ? now : prior?.lastQualifiedAt ?? null,
        lastConfirmedAt: null,
        selected: false,
        rank: null,
        updatedAt: now,
      });
      continue;
    }

    const entryStreak = qualifies ? (prior?.entryStreak ?? 0) + 1 : 0;
    const exitStreak = belowExit ? (prior?.exitStreak ?? 0) + 1 : 0;
    const selected = Boolean(
      prior?.selected &&
      !hardInvalidated &&
      exitStreak < MARKET_OPPORTUNITY_RULES.exitScans,
    );
    const lastConfirmedAt =
      incomingBySymbol.has(symbol) && isActionable(nextDecision) && !nextDecision.metrics.stale
        ? now
        : prior?.lastConfirmedAt ?? null;
    const state: MarketOpportunityCandidateState = {
      symbol,
      decision: nextDecision,
      entryStreak,
      exitStreak,
      enteredAt: selected ? prior?.enteredAt ?? now : prior?.enteredAt ?? null,
      lastQualifiedAt: qualifies ? now : prior?.lastQualifiedAt ?? null,
      lastConfirmedAt,
      selected,
      rank: selected ? prior?.rank ?? null : null,
      updatedAt: now,
    };
    state.decision = downgradeExpiredConfirmation(nextDecision, state, nowMs);
    states.push(state);
  }

  const selectedStates = states
    .filter((state) => state.selected)
    .sort(
      (left, right) =>
        left.decision.score - right.decision.score ||
        right.symbol.localeCompare(left.symbol),
    );
  const entrants = states
    .filter(
      (state) =>
        !state.selected &&
        !state.decision.hardInvalidated &&
        state.entryStreak >= MARKET_OPPORTUNITY_RULES.entryScans &&
        state.decision.score >= MARKET_OPPORTUNITY_RULES.observeScore,
    )
    .sort(
      (left, right) =>
        right.decision.score - left.decision.score ||
        left.symbol.localeCompare(right.symbol),
    );

  for (const entrant of entrants) {
    if (selectedStates.length < MARKET_OPPORTUNITY_RULES.outputLimit) {
      entrant.selected = true;
      entrant.enteredAt = entrant.enteredAt ?? now;
      selectedStates.push(entrant);
      selectedStates.sort((left, right) => left.decision.score - right.decision.score);
      continue;
    }
    const fifth = selectedStates[0];
    if (
      fifth.decision.hardInvalidated ||
      entrant.decision.score >= fifth.decision.score + MARKET_OPPORTUNITY_RULES.replacementGap
    ) {
      fifth.selected = false;
      fifth.rank = null;
      entrant.selected = true;
      entrant.enteredAt = entrant.enteredAt ?? now;
      selectedStates[0] = entrant;
      selectedStates.sort((left, right) => left.decision.score - right.decision.score);
    }
  }

  const ranked = selectedStates
    .sort(
      (left, right) =>
        right.decision.score - left.decision.score ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, MARKET_OPPORTUNITY_RULES.outputLimit);
  const rankBySymbol = new Map(ranked.map((state, index) => [state.symbol, index + 1]));
  for (const state of states) {
    const rank = rankBySymbol.get(state.symbol) ?? null;
    state.selected = rank !== null;
    state.rank = rank;
    if (rank !== null) state.enteredAt = state.enteredAt ?? now;
  }

  return {
    states: states.sort((left, right) => left.symbol.localeCompare(right.symbol)),
    selected: ranked.map((state) => state.decision),
  };
}

function valueBand(
  value: number | null,
  bands: Array<[number, string]>,
  fallback: string,
) {
  if (value === null || !Number.isFinite(value)) return "missing";
  for (const [threshold, label] of bands) {
    if (value >= threshold) return label;
  }
  return fallback;
}

function fundingBand(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "missing";
  if (value <= -0.001) return "negative-extreme";
  if (value <= -0.0005) return "negative";
  if (value >= 0.0015) return "positive-high";
  return "neutral";
}

export function buildMarketOpportunityFingerprint(
  selected: MarketOpportunityDecision[],
) {
  const material = selected.map((decision, index) => ({
    rank: index + 1,
    symbol: decision.symbol,
    model: decision.model,
    direction: decision.direction,
    stage: decision.stage,
    decision: decision.decision,
    scoreBand: Math.floor(decision.score / 10) * 10,
    mandatoryComplete: decision.mandatoryComplete,
    stale: decision.metrics.stale,
    oi: valueBand(
      decision.metrics.oiGrowth15m,
      [[12, "surging"], [4, "growing"], [-1, "flat"]],
      "falling",
    ),
    funding: fundingBand(decision.metrics.funding),
    taker: valueBand(
      decision.metrics.takerBuySellRatio,
      [[1.15, "buy"], [0.85, "balanced"]],
      "sell",
    ),
    pct15m: valueBand(
      decision.metrics.pct15m,
      [[15, "extended"], [4, "strong"], [-3, "flat"]],
      "weak",
    ),
  }));
  return createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")
    .slice(0, 24);
}
