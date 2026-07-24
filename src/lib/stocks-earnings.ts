import type { AlphaResearchEarningsStatus } from "./alpha-research-pool.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayTimestamp(value: string | Date) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    );
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

export function resolveEarningsStatus(
  nextEarningsDate: string | undefined,
  now = new Date(),
  fallback: AlphaResearchEarningsStatus = "quiet",
): AlphaResearchEarningsStatus {
  const earningsDay = nextEarningsDate
    ? utcDayTimestamp(nextEarningsDate)
    : null;
  const currentDay = utcDayTimestamp(now);
  if (earningsDay === null || currentDay === null) return fallback;

  const daysUntil = Math.round((earningsDay - currentDay) / DAY_MS);
  if (daysUntil >= 0 && daysUntil <= 14) return "upcoming";
  if (daysUntil < 0 && daysUntil >= -7) return "recent";
  if (daysUntil > 14 && daysUntil <= 45) return "watch";
  return "quiet";
}
