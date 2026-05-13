import type { TwitterFeedItem, TwitterRealtimeUpdate } from "./6551-twitter.ts";

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
