export type XFeedSource = "x" | "monitor985" | "owned-reader" | "truth";

export function classifyXFeedSource(item: {
  username?: string | null;
  queryLabel?: string | null;
  contentSource?: string | null;
}): XFeedSource {
  if (item.username?.startsWith("truth:")) {
    return "truth";
  }

  if (item.contentSource === "owned-reader" || /^owned-reader\b/i.test(item.queryLabel || "")) {
    return "owned-reader";
  }

  if (/^985monitor\b/i.test(item.queryLabel || "")) {
    return "monitor985";
  }

  return "x";
}
