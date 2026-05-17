export const SIGNAL_FEED_RANGES = ["latest", "12h", "24h", "3d", "7d"] as const;

export type SignalFeedRange = (typeof SIGNAL_FEED_RANGES)[number];
export type SignalFeedLimitSource = "all" | "telegram" | "x";

export const DEFAULT_SIGNAL_FEED_RANGE: SignalFeedRange = "latest";

export const SIGNAL_FEED_RANGE_OPTIONS: Array<{
  id: SignalFeedRange;
  label: string;
}> = [
  { id: "latest", label: "最新" },
  { id: "12h", label: "12h" },
  { id: "24h", label: "24h" },
  { id: "3d", label: "3天" },
  { id: "7d", label: "7天" },
];

const RANGE_MS: Partial<Record<SignalFeedRange, number>> = {
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const LATEST_LIMITS: Record<SignalFeedLimitSource, number> = {
  all: 200,
  telegram: 300,
  x: 200,
};

const RANGE_LIMITS: Record<SignalFeedLimitSource, number> = {
  all: 1000,
  telegram: 1000,
  x: 1000,
};

const RANGE_SET = new Set<string>(SIGNAL_FEED_RANGES);

export function normalizeSignalFeedRange(value: unknown): SignalFeedRange {
  if (typeof value !== "string") return DEFAULT_SIGNAL_FEED_RANGE;
  const normalized = value.trim().toLowerCase();
  return RANGE_SET.has(normalized)
    ? (normalized as SignalFeedRange)
    : DEFAULT_SIGNAL_FEED_RANGE;
}

export function getSignalFeedRangeSince(
  range: unknown,
  now = new Date(),
): string | null {
  const normalized = normalizeSignalFeedRange(range);
  const rangeMs = RANGE_MS[normalized];
  if (!rangeMs) return null;
  return new Date(now.getTime() - rangeMs).toISOString();
}

export function getSignalFeedRangeLimit(
  range: unknown,
  source: SignalFeedLimitSource,
) {
  return normalizeSignalFeedRange(range) === "latest"
    ? LATEST_LIMITS[source]
    : RANGE_LIMITS[source];
}
