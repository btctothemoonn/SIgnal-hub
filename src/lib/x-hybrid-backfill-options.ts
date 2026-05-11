export const DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS = 24;

type XHybridBackfillLookbackInput = {
  lookbackHours?: unknown;
};

function positiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveXHybridBackfillLookbackHours(
  input: XHybridBackfillLookbackInput = {},
) {
  return positiveInt(
    input.lookbackHours,
    DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS,
  );
}

export function resolveXHybridBackfillLookbackMs(
  input: XHybridBackfillLookbackInput = {},
) {
  return resolveXHybridBackfillLookbackHours(input) * 60 * 60_000;
}
