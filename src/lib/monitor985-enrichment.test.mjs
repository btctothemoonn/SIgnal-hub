import assert from "node:assert/strict";
import {
  mergeFullTweetIntoMonitor985Update,
  shouldRefreshMonitor985FeedItem,
} from "./monitor985-enrichment.ts";

function feedItem(overrides = {}) {
  return {
    id: "2054413901953966428",
    text: "披露内容：每月的 11日 和 21日... https://x.com/xiaomustock/status/2054413901953966428",
    createdAt: "2026-05-13T06:26:00.000Z",
    username: "xiaomustock",
    displayName: "川沐",
    profileUrl: "https://x.com/xiaomustock",
    userAvatar: "",
    tweetUrl: "https://x.com/xiaomustock/status/2054413901953966428",
    hashtags: [],
    likes: 0,
    retweets: 0,
    replies: 0,
    quotes: 0,
    views: 0,
    media: [],
    quotedTweet: null,
    origin: "watch",
    queryLabel: "985monitor / NEW_TWEET_QUOTE",
    translation: null,
    ...overrides,
  };
}

function update(overrides = {}) {
  const item = feedItem(overrides.feedItem);
  return {
    eventType: "NEW_TWEET_QUOTE",
    account: item.username,
    displayName: item.displayName,
    createdAt: item.createdAt,
    profileUrl: item.profileUrl,
    remark: "985monitor",
    feedItem: item,
    ...overrides,
  };
}

assert.equal(shouldRefreshMonitor985FeedItem(feedItem()), true);
assert.equal(
  shouldRefreshMonitor985FeedItem(
    feedItem({ text: "完整内容没有截断标记", queryLabel: "985monitor / NEW_TWEET" }),
  ),
  false,
);
assert.equal(
  shouldRefreshMonitor985FeedItem(
    feedItem({ username: "truth:realDonaldTrump", queryLabel: "985monitor / truth" }),
  ),
  false,
);

const fullTweet = feedItem({
  text: "披露内容：每月的 11日和 21日韩国海关会公布完整趋势报告，能够提前观察 SSD 与 HBM 需求变化。",
  queryLabel: "Telegram trigger / full",
  likes: 12,
  media: [
    {
      kind: "image",
      mimeType: "",
      previewUrl: "https://pbs.twimg.com/media/full.jpg",
      label: "photo",
      width: null,
      height: null,
    },
  ],
  translation: {
    provider: "minimax",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    text: "完整翻译",
  },
});

const merged = mergeFullTweetIntoMonitor985Update(update(), fullTweet);
assert.equal(merged.feedItem.text, fullTweet.text);
assert.equal(merged.feedItem.queryLabel, "985monitor / NEW_TWEET_QUOTE");
assert.equal(merged.feedItem.likes, 12);
assert.equal(merged.feedItem.media.length, 1);
assert.equal(merged.feedItem.translation?.text, "完整翻译");
assert.equal(merged.remark, "985monitor");

assert.equal(
  mergeFullTweetIntoMonitor985Update(update(), feedItem({ id: "other" })).feedItem
    .text,
  update().feedItem.text,
);

console.log("ok - 985monitor enrichment refreshes truncated tweet text");
