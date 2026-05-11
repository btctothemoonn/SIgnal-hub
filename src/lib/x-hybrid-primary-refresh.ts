import {
  resolveXHybrid985Gate,
  type XHybrid985GateDecision,
} from "./x-hybrid-985-gate.ts";

type ExistingTweetLike = {
  id?: string | null;
  text?: string | null;
  queryLabel?: string | null;
};

export type XHybridPrimaryRefreshCandidate<T> = {
  item: T;
  tweetId: string;
  sourceCreatedAt: string;
};

export type XHybridPrimaryRefreshResult<T> = {
  ready: XHybridPrimaryRefreshCandidate<T>[];
  skippedExisting: XHybridPrimaryRefreshCandidate<T>[];
  pending: Array<{
    candidate: XHybridPrimaryRefreshCandidate<T>;
    detail: string;
  }>;
  refreshAttempted: boolean;
  refreshFailed: boolean;
  primaryCheckedAt: string | null;
  refreshDetail: string | null;
  failureDetail: string | null;
};

type RefreshPrimaryResult = {
  checkedAt: string | null;
  detail?: string | null;
};

function bucketByGate<T>({
  candidate,
  gate,
  ready,
  skippedExisting,
  pending,
}: {
  candidate: XHybridPrimaryRefreshCandidate<T>;
  gate: XHybrid985GateDecision;
  ready: XHybridPrimaryRefreshCandidate<T>[];
  skippedExisting: XHybridPrimaryRefreshCandidate<T>[];
  pending: XHybridPrimaryRefreshResult<T>["pending"];
}) {
  if (gate.action === "skip-existing") {
    skippedExisting.push(candidate);
    return;
  }
  if (gate.action === "wait") {
    pending.push({ candidate, detail: gate.detail });
    return;
  }
  ready.push(candidate);
}

function reachedGraceWindow({
  sourceCreatedAt,
  nowMs,
  delayMs,
}: {
  sourceCreatedAt: string;
  nowMs: number;
  delayMs: number;
}) {
  const parsed = Date.parse(sourceCreatedAt);
  return Number.isFinite(parsed) && nowMs - parsed >= delayMs;
}

export async function confirmXHybridPrimaryMisses<T>({
  candidates,
  primaryCheckedAt,
  delayMs,
  nowMs = Date.now(),
  getExistingTweet,
  refreshPrimary,
}: {
  candidates: XHybridPrimaryRefreshCandidate<T>[];
  primaryCheckedAt: string | null;
  delayMs: number;
  nowMs?: number;
  getExistingTweet: (tweetId: string) => ExistingTweetLike | null;
  refreshPrimary: () => Promise<RefreshPrimaryResult>;
}): Promise<XHybridPrimaryRefreshResult<T>> {
  const readyBeforeRefresh: XHybridPrimaryRefreshCandidate<T>[] = [];
  const skippedExisting: XHybridPrimaryRefreshCandidate<T>[] = [];
  const pending: XHybridPrimaryRefreshResult<T>["pending"] = [];

  for (const candidate of candidates) {
    const existingTweet = getExistingTweet(candidate.tweetId);
    const gate = resolveXHybrid985Gate({
      tweetId: candidate.tweetId,
      existingTweet,
      sourceCreatedAt: candidate.sourceCreatedAt,
      primaryCheckedAt,
      nowMs,
      delayMs,
    });

    if (gate.action === "skip-existing") {
      skippedExisting.push(candidate);
    } else if (
      gate.action === "enrich" ||
      reachedGraceWindow({
        sourceCreatedAt: candidate.sourceCreatedAt,
        nowMs,
        delayMs,
      })
    ) {
      readyBeforeRefresh.push(candidate);
    } else {
      pending.push({ candidate, detail: gate.detail });
    }
  }

  if (readyBeforeRefresh.length === 0) {
    return {
      ready: [],
      skippedExisting,
      pending,
      refreshAttempted: false,
      refreshFailed: false,
      primaryCheckedAt,
      refreshDetail: null,
      failureDetail: null,
    };
  }

  let refreshed: RefreshPrimaryResult;
  try {
    refreshed = await refreshPrimary();
  } catch (error) {
    const detail = String(error);
    return {
      ready: [],
      skippedExisting,
      pending: [
        ...pending,
        ...readyBeforeRefresh.map((candidate) => ({
          candidate,
          detail: `985 primary refresh failed before 6551 fallback: ${detail}`,
        })),
      ],
      refreshAttempted: true,
      refreshFailed: true,
      primaryCheckedAt,
      refreshDetail: null,
      failureDetail: detail,
    };
  }

  const checkedAt = refreshed.checkedAt ?? primaryCheckedAt;
  const ready: XHybridPrimaryRefreshCandidate<T>[] = [];
  for (const candidate of readyBeforeRefresh) {
    bucketByGate({
      candidate,
      gate: resolveXHybrid985Gate({
        tweetId: candidate.tweetId,
        existingTweet: getExistingTweet(candidate.tweetId),
        sourceCreatedAt: candidate.sourceCreatedAt,
        primaryCheckedAt: checkedAt,
        nowMs,
        delayMs,
      }),
      ready,
      skippedExisting,
      pending,
    });
  }

  return {
    ready,
    skippedExisting,
    pending,
    refreshAttempted: true,
    refreshFailed: false,
    primaryCheckedAt: checkedAt,
    refreshDetail: refreshed.detail ?? null,
    failureDetail: null,
  };
}
