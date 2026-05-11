export type SignalFeedSource = "telegram" | "x" | "monitor985" | "truth" | "alert";
export type SignalFeedTab = "all" | "telegram" | "x" | "truth";

export function isMergedXSignalSource(source: SignalFeedSource) {
  return source === "x" || source === "monitor985";
}

export function matchesSignalFeedTab(
  item: { source: SignalFeedSource },
  tab: SignalFeedTab,
) {
  if (tab === "all") return true;
  if (tab === "x") return isMergedXSignalSource(item.source);
  return item.source === tab;
}

export function getXSourceBadgeLabel(source: SignalFeedSource) {
  if (source === "x") return "6551";
  if (source === "monitor985") return "985";
  return null;
}
