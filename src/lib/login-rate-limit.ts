export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

const MAX_TRACKED_CLIENTS = 2048;

type FailureRecord = {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
};

export type LoginRateLimitState = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const failures = new Map<string, FailureRecord>();

function liveRecord(key: string, nowMs: number): FailureRecord | null {
  const record = failures.get(key);
  if (!record) return null;

  if (
    (record.lockedUntil > 0 && record.lockedUntil <= nowMs) ||
    (record.lockedUntil === 0 &&
      nowMs - record.firstFailureAt >= LOGIN_FAILURE_WINDOW_MS)
  ) {
    failures.delete(key);
    return null;
  }
  return record;
}

function ensureCapacity(key: string) {
  if (failures.has(key) || failures.size < MAX_TRACKED_CLIENTS) return;
  const oldestKey = failures.keys().next().value as string | undefined;
  if (oldestKey) failures.delete(oldestKey);
}

function cleanClientAddress(value: string | null): string {
  const clean = value?.trim().replace(/[\u0000-\u001f\u007f]/g, "") ?? "";
  return clean ? clean.slice(0, 128) : "unknown";
}

export function getLoginClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedClient = forwarded?.split(",", 1)[0] ?? null;
  const address = forwardedClient || request.headers.get("x-real-ip");
  return `ip:${cleanClientAddress(address)}`;
}

export function checkLoginRateLimit(
  key: string,
  nowMs = Date.now(),
): LoginRateLimitState {
  const record = liveRecord(key, nowMs);
  if (!record || record.lockedUntil <= nowMs) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((record.lockedUntil - nowMs) / 1000),
    ),
  };
}

export function recordLoginFailure(key: string, nowMs = Date.now()): void {
  const current = liveRecord(key, nowMs);
  ensureCapacity(key);
  const nextCount = (current?.count ?? 0) + 1;
  failures.set(key, {
    count: nextCount,
    firstFailureAt: current?.firstFailureAt ?? nowMs,
    lockedUntil:
      nextCount >= LOGIN_FAILURE_LIMIT
        ? nowMs + LOGIN_FAILURE_WINDOW_MS
        : 0,
  });
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}

export function resetLoginRateLimitsForTests(): void {
  failures.clear();
}
