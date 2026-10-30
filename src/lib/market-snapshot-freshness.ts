export function isMarketSnapshotStale(
  value: string | null | undefined,
  nowMs: number,
  maxAgeMs = 90_000,
) {
  const time = Date.parse(value ?? "");
  return !Number.isFinite(time) || time > nowMs + 1_000 || nowMs - time > maxAgeMs;
}
