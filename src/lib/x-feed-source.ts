export type XFeedSource = "x" | "monitor985" | "truth";

export function classifyXFeedSource(item: {
  username?: string | null;
  queryLabel?: string | null;
}): XFeedSource {
  if (item.username?.startsWith("truth:")) {
    return "truth";
  }

  if (/^985monitor\b/i.test(item.queryLabel || "")) {
    return "monitor985";
  }

  return "x";
}
