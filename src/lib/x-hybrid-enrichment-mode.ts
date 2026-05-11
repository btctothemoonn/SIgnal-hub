export type XHybridEnrichmentMode = "telegram-only" | "account" | "tweet-id";

function normalizeMode(raw: string | undefined): string {
  return raw?.trim().toLowerCase().replace(/_/g, "-") || "";
}

export function getXHybridEnrichmentMode(
  env: Record<string, string | undefined> = process.env,
): XHybridEnrichmentMode {
  const explicitMode = normalizeMode(env.X_HYBRID_ENRICH_MODE);
  if (["tweet-id", "tweetid", "by-id", "id"].includes(explicitMode)) {
    return "tweet-id";
  }
  if (["account", "user-tweets", "user"].includes(explicitMode)) {
    return "account";
  }
  if (["telegram-only", "telegram", "off", "false", "0"].includes(explicitMode)) {
    return "telegram-only";
  }

  const legacyApiEnrich = normalizeMode(env.X_HYBRID_API_ENRICH);
  if (
    legacyApiEnrich &&
    !["0", "false", "no", "off", "telegram", "telegram-only"].includes(
      legacyApiEnrich,
    )
  ) {
    return "account";
  }

  return "telegram-only";
}
