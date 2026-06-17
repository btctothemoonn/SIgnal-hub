import type {
  TwitterFeedItem,
  TwitterQuotedTweet,
} from "./6551-twitter.ts";
import type { XApiUsageReservation } from "./x-api-usage.ts";
import { isCompleteReferencedTweet } from "./x-hybrid-tweet-quality.ts";

type ResolveHybridQuotedTweetDeps = {
  getFeedItem: (id: string) => TwitterFeedItem | null;
  getQuotedTweet: (id: string) => TwitterQuotedTweet | null;
  saveQuotedTweet: (quotedTweet: TwitterQuotedTweet) => void;
  reservePoints: (tweetId: string) => XApiUsageReservation;
  fetchTweetById: (tweetId: string) => Promise<TwitterFeedItem | null>;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type ResolveHybridQuotedTweetResult = {
  feedItem: TwitterFeedItem;
  status:
    | "none"
    | "complete"
    | "cached"
    | "fetched"
    | "pending"
    | "empty"
    | "failed";
  quotedTweetId: string | null;
  pointsReserved: number;
  detail: string;
};

export function toQuotedTweet(
  feedItem: TwitterFeedItem,
  relation: "quote" | "reply" = "quote",
): TwitterQuotedTweet {
  return {
    id: feedItem.id,
    text: feedItem.text,
    createdAt: feedItem.createdAt,
    username: feedItem.username,
    displayName: feedItem.displayName,
    profileUrl: feedItem.profileUrl,
    userAvatar: feedItem.userAvatar,
    tweetUrl: feedItem.tweetUrl,
    media: feedItem.media || [],
    translation: feedItem.translation || null,
    relation,
  };
}

export function isCompleteHybridQuotedTweet(
  quotedTweet: TwitterQuotedTweet | null | undefined,
): boolean {
  return isCompleteReferencedTweet(quotedTweet);
}

export async function resolveHybridQuotedTweet(
  feedItem: TwitterFeedItem,
  deps: ResolveHybridQuotedTweetDeps,
): Promise<ResolveHybridQuotedTweetResult> {
  const quotedTweet = feedItem.quotedTweet;
  if (!quotedTweet?.id || quotedTweet.id === feedItem.id) {
    return {
      feedItem,
      status: "none",
      quotedTweetId: quotedTweet?.id || null,
      pointsReserved: 0,
      detail: "no quoted tweet to resolve",
    };
  }

  if (isCompleteHybridQuotedTweet(quotedTweet)) {
    deps.saveQuotedTweet(quotedTweet);
    return {
      feedItem,
      status: "complete",
      quotedTweetId: quotedTweet.id,
      pointsReserved: 0,
      detail: "quoted tweet already complete",
    };
  }

  const cachedFeedItem = deps.getFeedItem(quotedTweet.id);
  const cachedQuote =
    deps.getQuotedTweet(quotedTweet.id) ||
    (cachedFeedItem
      ? toQuotedTweet(cachedFeedItem, quotedTweet.relation ?? "quote")
      : null);
  if (cachedQuote && isCompleteHybridQuotedTweet(cachedQuote)) {
    deps.saveQuotedTweet(cachedQuote);
    return {
      feedItem: {
        ...feedItem,
        quotedTweet: cachedQuote,
      },
      status: "cached",
      quotedTweetId: quotedTweet.id,
      pointsReserved: 0,
      detail: "quoted tweet resolved from local cache",
    };
  }

  const reservation = deps.reservePoints(quotedTweet.id);
  if (!reservation.allowed) {
    deps.log?.("x_hybrid_quoted_tweet_pending", {
      tweetId: feedItem.id,
      quotedTweetId: quotedTweet.id,
      reason: reservation.reason,
    });
    return {
      feedItem,
      status: "pending",
      quotedTweetId: quotedTweet.id,
      pointsReserved: 0,
      detail: reservation.reason || "quoted tweet point reservation denied",
    };
  }

  try {
    const fullQuotedTweet = await deps.fetchTweetById(quotedTweet.id);
    if (!fullQuotedTweet) {
      return {
        feedItem,
        status: "empty",
        quotedTweetId: quotedTweet.id,
        pointsReserved: reservation.points,
        detail: "quoted tweet fetch returned empty",
      };
    }

    const normalizedQuote = toQuotedTweet(
      fullQuotedTweet,
      quotedTweet.relation ?? "quote",
    );
    deps.saveQuotedTweet(normalizedQuote);
    return {
      feedItem: {
        ...feedItem,
        quotedTweet: normalizedQuote,
      },
      status: "fetched",
      quotedTweetId: quotedTweet.id,
      pointsReserved: reservation.points,
      detail: "quoted tweet fetched from 6551",
    };
  } catch (error) {
    deps.log?.("x_hybrid_quoted_tweet_failed", {
      tweetId: feedItem.id,
      quotedTweetId: quotedTweet.id,
      error: String(error),
    });
    return {
      feedItem,
      status: "failed",
      quotedTweetId: quotedTweet.id,
      pointsReserved: reservation.points,
      detail: String(error),
    };
  }
}
