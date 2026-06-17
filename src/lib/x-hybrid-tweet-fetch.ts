import type { DatabaseSync } from "node:sqlite";
import type { TwitterFeedItem } from "./6551-twitter.ts";
import { reserveXApiPoints } from "./x-api-usage.ts";
import {
  getXHybridTweetFetchDecision,
  markXHybridTweetFetch,
} from "./x-pipeline-store.ts";
import { summarizeTweetFetchQuality } from "./x-hybrid-tweet-quality.ts";

export type GuardedTweetByIdFetchResult = {
  status:
    | "success"
    | "low_quality"
    | "cooldown"
    | "blocked"
    | "empty"
    | "error";
  tweet: TwitterFeedItem | null;
  detail: string;
  pointsReserved: number;
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function successCooldownMs() {
  return positiveInt(process.env.X_HYBRID_TWEET_SUCCESS_COOLDOWN_MS, 6 * 60 * 60_000);
}

function lowQualityCooldownMs() {
  return positiveInt(process.env.X_HYBRID_TWEET_LOW_QUALITY_COOLDOWN_MS, 6 * 60 * 60_000);
}

function emptyCooldownMs() {
  return positiveInt(process.env.X_HYBRID_TWEET_EMPTY_COOLDOWN_MS, 60 * 60_000);
}

function errorCooldownMs() {
  return positiveInt(process.env.X_HYBRID_TWEET_ERROR_COOLDOWN_MS, 30 * 60 * 60_000);
}

export async function guardedTweetByIdFetch({
  tweetId,
  detail,
  fetchTweetById,
  db,
}: {
  tweetId: string;
  detail: string;
  fetchTweetById: (tweetId: string) => Promise<TwitterFeedItem | null>;
  db?: DatabaseSync;
}): Promise<GuardedTweetByIdFetchResult> {
  const decision = getXHybridTweetFetchDecision(tweetId, {
    db,
    successCooldownMs: successCooldownMs(),
    lowQualityCooldownMs: lowQualityCooldownMs(),
    emptyCooldownMs: emptyCooldownMs(),
    errorCooldownMs: errorCooldownMs(),
  });
  if (!decision.allowed) {
    return {
      status: "cooldown",
      tweet: null,
      detail: `${decision.reason}: ${decision.state?.detail || tweetId}`,
      pointsReserved: 0,
    };
  }

  const reservation = reserveXApiPoints({
    db,
    kind: "tweet_by_id",
    detail,
  });
  if (!reservation.allowed) {
    return {
      status: "blocked",
      tweet: null,
      detail: reservation.reason || "tweet_by_id blocked",
      pointsReserved: 0,
    };
  }

  try {
    const tweet = await fetchTweetById(tweetId);
    if (!tweet) {
      markXHybridTweetFetch(
        {
          tweetId,
          status: "empty",
          detail: "tweet_by_id returned empty",
        },
        db,
      );
      return {
        status: "empty",
        tweet: null,
        detail: `tweet_by_id returned empty for ${tweetId}`,
        pointsReserved: reservation.points,
      };
    }

    const quality = summarizeTweetFetchQuality(tweet);
    if (!quality.complete) {
      markXHybridTweetFetch(
        {
          tweetId,
          status: "low_quality",
          detail: quality.reason,
        },
        db,
      );
      return {
        status: "low_quality",
        tweet,
        detail: `${quality.reason} for ${tweetId}`,
        pointsReserved: reservation.points,
      };
    }

    markXHybridTweetFetch(
      {
        tweetId,
        status: "success",
        detail: "tweet_by_id complete",
      },
      db,
    );
    return {
      status: "success",
      tweet,
      detail: `tweet_by_id complete for ${tweetId}`,
      pointsReserved: reservation.points,
    };
  } catch (error) {
    markXHybridTweetFetch(
      {
        tweetId,
        status: "error",
        detail: String(error),
      },
      db,
    );
    return {
      status: "error",
      tweet: null,
      detail: `tweet_by_id failed for ${tweetId}: ${String(error)}`,
      pointsReserved: reservation.points,
    };
  }
}
