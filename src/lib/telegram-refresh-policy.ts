export const TELEGRAM_SNAPSHOT_REFRESH_THROTTLE_MS = 60_000;

export function shouldRefreshTelegramSnapshot(
  lastRefreshAtMs: number,
  nowMs: number,
) {
  return (
    nowMs - lastRefreshAtMs >= TELEGRAM_SNAPSHOT_REFRESH_THROTTLE_MS
  );
}
