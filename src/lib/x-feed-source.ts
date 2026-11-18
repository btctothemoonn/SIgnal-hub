export type XFeedSource = "x" | "6551" | "monitor985" | "owned-reader" | "truth";

export function classifyXFeedSource(item: {
  username?: string | null;
  queryLabel?: string | null;
  contentSource?: string | null;
  firstSource?: string | null;
}): XFeedSource {
  if (item.username?.startsWith("truth:")) {
    return "truth";
  }

  const first = item.firstSource;
  if (first === "6551" || first === "monitor985" || first === "owned-reader" || first === "x") {
    return first;
  }

  if (/^6551 WSS\s*\//i.test(item.queryLabel || "")) {
    return "6551";
  }

  if (item.contentSource === "owned-reader" || /^owned-reader\b/i.test(item.queryLabel || "")) {
    return "owned-reader";
  }

  if (/^985monitor\b/i.test(item.queryLabel || "")) {
    return "monitor985";
  }

  return "x";
}
