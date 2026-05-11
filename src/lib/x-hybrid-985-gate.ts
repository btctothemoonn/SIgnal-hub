type ExistingTweetLike = {
  id?: string | null;
  text?: string | null;
  queryLabel?: string | null;
};

export type XHybrid985GateAction = "skip-existing" | "wait" | "enrich";

export type XHybrid985GateDecision = {
  action: XHybrid985GateAction;
  detail: string;
};

function hasExistingTweet(
  tweetId: string,
  existingTweet: ExistingTweetLike | null,
): boolean {
  const queryLabel = existingTweet?.queryLabel || "";
  if (/telegram trigger\s*\/\s*(?:fallback|pending)/i.test(queryLabel)) {
    return false;
  }
  return Boolean(
    tweetId &&
      existingTweet?.id === tweetId &&
      typeof existingTweet.text === "string" &&
      existingTweet.text.trim().length > 0,
  );
}

function ageMs(createdAt: string, nowMs: number): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed)
    ? Math.max(0, nowMs - parsed)
    : Number.POSITIVE_INFINITY;
}

function timestampMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveXHybrid985Gate({
  tweetId,
  existingTweet,
  sourceCreatedAt,
  primaryCheckedAt,
  nowMs = Date.now(),
  delayMs,
}: {
  tweetId: string | null | undefined;
  existingTweet: ExistingTweetLike | null;
  sourceCreatedAt: string;
  primaryCheckedAt?: string | null;
  nowMs?: number;
  delayMs: number;
}): XHybrid985GateDecision {
  const cleanTweetId = String(tweetId || "").trim();
  if (!cleanTweetId) {
    return {
      action: "enrich",
      detail: "no tweet id; gate does not apply",
    };
  }

  if (hasExistingTweet(cleanTweetId, existingTweet)) {
    return {
      action: "skip-existing",
      detail: "tweet already present before 6551 fallback",
    };
  }

  if (ageMs(sourceCreatedAt, nowMs) < delayMs) {
    return {
      action: "wait",
      detail: "waiting for 985 primary feed grace window",
    };
  }

  const sourceMs = timestampMs(sourceCreatedAt);
  const checkedMs = timestampMs(primaryCheckedAt);
  if (!checkedMs || !sourceMs) {
    return {
      action: "wait",
      detail: "waiting for 985 primary feed refresh proof",
    };
  }

  if (checkedMs < sourceMs + delayMs) {
    return {
      action: "wait",
      detail: "waiting for 985 primary feed to refresh after grace window",
    };
  }

  return {
    action: "enrich",
    detail: "985 refreshed after grace window; use 6551 tweet_by_id fallback",
  };
}
