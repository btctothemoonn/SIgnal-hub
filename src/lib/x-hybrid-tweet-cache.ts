type TweetCacheCandidate = {
  id?: string;
  text?: string;
  queryLabel?: string;
};

export function isFullTweetByIdCacheHit(
  item: TweetCacheCandidate | null,
  tweetId: string,
): boolean {
  return Boolean(
    item &&
      item.id === tweetId &&
      item.queryLabel === "Telegram trigger / full" &&
      typeof item.text === "string" &&
      item.text.trim().length > 0,
  );
}
