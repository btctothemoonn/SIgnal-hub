type TweetCacheCandidate = {
  id?: string;
  text?: string;
  queryLabel?: string;
  contentComplete?: boolean;
};

export function isFullTweetByIdCacheHit(
  item: TweetCacheCandidate | null,
  tweetId: string,
): boolean {
  return Boolean(
    item &&
      item.id === tweetId &&
      item.contentComplete !== false &&
      (item.contentComplete === true || item.queryLabel === "Telegram trigger / full") &&
      typeof item.text === "string" &&
      item.text.trim().length > 0,
  );
}
