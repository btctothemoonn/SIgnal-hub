const DEFAULT_RECOVERY_LOOKBACK_MS = 24 * 60 * 60_000;
const DEFAULT_RECOVERY_GAP_MS = 10 * 60_000;

type EnvLike = Partial<Record<string, string | undefined>>;

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getXHybridRecoveryLookbackMs(env: EnvLike = process.env) {
  return positiveInt(
    env.X_HYBRID_RECOVERY_LOOKBACK_MS,
    DEFAULT_RECOVERY_LOOKBACK_MS,
  );
}

export function getXHybridRecoveryGapMs(env: EnvLike = process.env) {
  return positiveInt(env.X_HYBRID_RECOVERY_GAP_MS, DEFAULT_RECOVERY_GAP_MS);
}

export function shouldUseXHybridRecoveryWindow({
  lastTickFinishedAtMs,
  nowMs,
  recoveryGapMs,
}: {
  lastTickFinishedAtMs: number | null;
  nowMs: number;
  recoveryGapMs: number;
}) {
  if (!Number.isFinite(lastTickFinishedAtMs)) return true;
  return nowMs - Number(lastTickFinishedAtMs) >= recoveryGapMs;
}

export function getXHybridEffectiveLookbackMs({
  normalLookbackMs,
  recoveryLookbackMs,
  recoveryGapMs,
  lastTickFinishedAtMs,
  nowMs,
}: {
  normalLookbackMs: number;
  recoveryLookbackMs: number;
  recoveryGapMs: number;
  lastTickFinishedAtMs: number | null;
  nowMs: number;
}) {
  const recovery = shouldUseXHybridRecoveryWindow({
    lastTickFinishedAtMs,
    nowMs,
    recoveryGapMs,
  });
  return {
    lookbackMs: recovery
      ? Math.max(normalLookbackMs, recoveryLookbackMs)
      : normalLookbackMs,
    recovery,
  };
}

export function shouldKeepXHybridRecoveryWindow({
  recovery,
  checkedRows,
  batchLimit,
  hasPendingBacklog = false,
}: {
  recovery: boolean;
  checkedRows: number;
  batchLimit: number;
  hasPendingBacklog?: boolean;
}) {
  return recovery && (hasPendingBacklog || checkedRows >= batchLimit);
}
