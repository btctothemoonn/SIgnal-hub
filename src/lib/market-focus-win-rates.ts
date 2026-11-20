import {
  ALERT_OUTCOME_HORIZONS, alertCategory, directionalPct,
  type AlertCategory, type AlertOutcomeHorizon, type AlertOutcomeRow,
} from "./market-alert-outcomes.ts";
import type { MarketBoardMarket } from "./market-signals.ts";

type FocusAlertFields = {
  type: string;
  side: string | null;
  level: number;
  trigger: string;
  volumeRatio: number | null;
  metrics?: { strengthPct?: unknown } | null;
};

// Used by both the live cards and their historical scorecard.
export function specialAlertCategory(event: FocusAlertFields): AlertCategory | null {
  const category = alertCategory(event);
  if (!category || event.level >= 2) return category;
  const strength = event.metrics?.strengthPct;
  if (category !== "squeeze" && event.level === 1 && event.trigger.includes("B加速") &&
      typeof strength === "number" && Number.isFinite(strength) && strength >= 5 &&
      event.volumeRatio !== null && event.volumeRatio >= 20) return category;
  return null;
}

export type FocusAlertCandidate = { id: string; symbol: string; occurredAt: string; kind: AlertCategory };
export type FocusWinRateRow = {
  kind: AlertCategory | "startup" | "weakening";
  total: number;
  horizons: Record<AlertOutcomeHorizon, { wins: number; settled: number }>;
};

export function emptyFocusWinRateRow(kind: FocusWinRateRow["kind"]): FocusWinRateRow {
  return {
    kind, total: 0,
    horizons: { "1h": { wins: 0, settled: 0 }, "4h": { wins: 0, settled: 0 }, "24h": { wins: 0, settled: 0 } },
  };
}

const returnKeys = { "1h": "ret1hPct", "4h": "ret4hPct", "24h": "ret24hPct" } as const;

export function summarizeFocusAlerts(
  candidates: readonly FocusAlertCandidate[],
  outcomes: readonly AlertOutcomeRow[],
  eligible: ReadonlySet<string>,
  market: MarketBoardMarket,
  nowMs: number,
) {
  const rows = { pump: emptyFocusWinRateRow("pump"), crash: emptyFocusWinRateRow("crash"), squeeze: emptyFocusWinRateRow("squeeze") };
  const byId = new Map(outcomes.map(row => [row.eventId, row]));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!eligible.has(candidate.symbol) || seen.has(candidate.id) || (market === "equities" && candidate.kind === "squeeze")) continue;
    seen.add(candidate.id);
    const group = rows[candidate.kind];
    group.total++;
    const outcome = byId.get(candidate.id);
    if (!outcome) continue;
    const at = Date.parse(candidate.occurredAt);
    for (const { key, ms } of ALERT_OUTCOME_HORIZONS) {
      const value = outcome[returnKeys[key]];
      if (at + ms > nowMs || value === null || !Number.isFinite(value)) continue;
      const horizon = group.horizons[key];
      horizon.settled++;
      if (directionalPct(candidate.kind, value) > 0) horizon.wins++;
    }
  }
  return market === "equities" ? [rows.pump, rows.crash] : [rows.pump, rows.crash, rows.squeeze];
}
