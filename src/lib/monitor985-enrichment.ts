import type { DatabaseSync } from "node:sqlite";
import type { TwitterFeedItem, TwitterRealtimeUpdate } from "./6551-twitter.ts";
import { isFullTweetByIdCacheHit } from "./x-hybrid-tweet-cache.ts";
import { guardedTweetByIdFetch } from "./x-hybrid-tweet-fetch.ts";

function isMonitor985Item(feedItem: TwitterFeedItem): boolean {
  return /^985monitor\b/i.test(feedItem.queryLabel || "");
}

function hasTruncationMarker(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\.\.\.\s*(?:https?:\/\/\S+)?$/i.test(trimmed) ||
    /…\s*(?:https?:\/\/\S+)?$/i.test(trimmed)
  );
}

export function shouldRefreshMonitor985FeedItem(
  feedItem: TwitterFeedItem,
): boolean {
  if (!feedItem.id || feedItem.username.startsWith("truth:")) return false;
  if (!isMonitor985Item(feedItem)) return false;
  return hasTruncationMarker(feedItem.text);
}

export function mergeFullTweetIntoMonitor985Update(
  update: TwitterRealtimeUpdate,
  fullTweet: TwitterFeedItem | null,
): TwitterRealtimeUpdate {
  if (!fullTweet || fullTweet.id !== update.feedItem.id) {
    return update;
  }

  return {
    ...update,
    account: update.account || fullTweet.username,
    displayName: update.displayName || fullTweet.displayName,
    createdAt: fullTweet.createdAt || update.createdAt,
    profileUrl: update.profileUrl || fullTweet.profileUrl,
    feedItem: {
      ...fullTweet,
      origin: update.feedItem.origin,
      queryLabel: update.feedItem.queryLabel || fullTweet.queryLabel,
    },
  };
}

export async function resolveMonitor985FullTweet(
  feedItem: TwitterFeedItem,
  {
    getFeedItem,
    fetchTweetById,
    db,
    log,
  }: {
    getFeedItem: (id: string, db?: DatabaseSync) => TwitterFeedItem | null;
    fetchTweetById: (tweetId: string) => Promise<TwitterFeedItem | null>;
    db?: DatabaseSync;
    log?: (event: string, data?: Record<string, unknown>) => void;
  },
): Promise<TwitterFeedItem | null> {
  if (!shouldRefreshMonitor985FeedItem(feedItem)) return null;

  const cachedTweet = getFeedItem(feedItem.id, db);
  if (isFullTweetByIdCacheHit(cachedTweet, feedItem.id)) {
    log?.("monitor985_full_tweet_cache_hit", {
      tweetId: feedItem.id,
    });
    return cachedTweet;
  }

  const fetchResult = await guardedTweetByIdFetch({
    tweetId: feedItem.id,
    detail: `985monitor ${feedItem.id}`,
    fetchTweetById,
    db,
  });

  if (fetchResult.status === "success" && fetchResult.tweet) {
    return fetchResult.tweet;
  }

  log?.("monitor985_full_tweet_skipped", {
    tweetId: feedItem.id,
    status: fetchResult.status,
    detail: fetchResult.detail,
  });
  return fetchResult.tweet;
}
