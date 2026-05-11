const DEFAULT_ACCOUNT_SYNC_INTERVAL_MS = 60 * 60 * 1000;

type EnvLike = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMonitor985AccountSyncIntervalMs(
  env: EnvLike = process.env,
): number {
  return positiveInt(
    env.MONITOR985_ACCOUNT_SYNC_INTERVAL_MS,
    DEFAULT_ACCOUNT_SYNC_INTERVAL_MS,
  );
}

export function shouldRefreshMonitor985Accounts(input: {
  force?: boolean;
  intervalMs: number;
  lastSyncedAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.force) return true;
  if (input.lastSyncedAtMs === null) return true;
  return input.nowMs - input.lastSyncedAtMs >= input.intervalMs;
}
