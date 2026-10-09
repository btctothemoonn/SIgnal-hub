export type SignalFeedSource = "telegram" | "x" | "monitor985" | "owned-reader" | "truth" | "alert";
export type SignalFeedTab = "all" | "telegram" | "x" | "truth";
export type SignalFeedCollector = "all" | "monitor985" | "owned-reader";

export function isMergedXSignalSource(source: SignalFeedSource) {
  return source === "x" || source === "monitor985" || source === "owned-reader";
}

export function matchesSignalFeedTab(
  item: { source: SignalFeedSource },
  tab: SignalFeedTab,
) {
  if (tab === "all") return true;
  if (tab === "x") return isMergedXSignalSource(item.source);
  return item.source === tab;
}

export function matchesSignalFeedCollector(
  item: { source: SignalFeedSource },
  collector: SignalFeedCollector,
) {
  return collector === "all" || item.source === collector;
}

export function getXSourceBadgeLabel(source: SignalFeedSource) {
  if (source === "x") return "6551 历史";
  if (source === "monitor985") return "985 采集";
  if (source === "owned-reader") return "VPS 采集";
  return null;
}
