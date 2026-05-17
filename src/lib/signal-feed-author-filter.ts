import type { SignalFeedSource } from "./signal-feed-tabs.ts";

export const ALL_SIGNAL_FEED_AUTHOR_FILTER = "__all__";

export type SignalFeedAuthorFilterItem = {
  source: SignalFeedSource;
  title: string;
  subtitle: string | null;
};

export type SignalFeedAuthorOption = {
  value: string;
  label: string;
  count: number;
};

function normalizeAuthorPart(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function handleFromSubtitle(subtitle: string | null) {
  const match = subtitle?.match(/@[\w_]+/);
  return match?.[0] ?? null;
}

function sourceBucket(source: SignalFeedSource) {
  return source === "monitor985" ? "x" : source;
}

export function signalFeedAuthorKey(item: SignalFeedAuthorFilterItem) {
  const handle = handleFromSubtitle(item.subtitle);
  const identity = normalizeAuthorPart(handle || item.title);
  return `${sourceBucket(item.source)}:${identity}`;
}

export function signalFeedAuthorLabel(item: SignalFeedAuthorFilterItem) {
  const handle = handleFromSubtitle(item.subtitle);
  if (!handle) return item.title;
  if (normalizeAuthorPart(item.title) === normalizeAuthorPart(handle)) {
    return handle;
  }
  return `${item.title} ${handle}`;
}

export function buildSignalFeedAuthorOptions(
  items: SignalFeedAuthorFilterItem[],
): SignalFeedAuthorOption[] {
  const options = new Map<string, SignalFeedAuthorOption>();
  for (const item of items) {
    const value = signalFeedAuthorKey(item);
    const existing = options.get(value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    options.set(value, {
      value,
      label: signalFeedAuthorLabel(item),
      count: 1,
    });
  }
  return [...options.values()].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  );
}

export function matchesSignalFeedAuthorFilter(
  item: SignalFeedAuthorFilterItem,
  filter: string,
) {
  return filter === ALL_SIGNAL_FEED_AUTHOR_FILTER || signalFeedAuthorKey(item) === filter;
}
