import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { guardedTweetByIdFetch } from "./x-hybrid-tweet-fetch.ts";
import { initXPipelineDb } from "./x-pipeline-store.ts";

const db = new DatabaseSync(":memory:");
initXPipelineDb(db);

const completeTweet = {
  id: "123",
  text: "完整主文，结尾正常。",
  createdAt: "2026-06-17T00:00:00.000Z",
  username: "demo",
  displayName: "Demo",
  profileUrl: "https://x.com/demo",
  userAvatar: "",
  tweetUrl: "https://x.com/demo/status/123",
  hashtags: [],
  likes: 0,
  retweets: 0,
  replies: 0,
  quotes: 0,
  views: 0,
  media: [],
  quotedTweet: null,
  origin: "watch",
  queryLabel: "Telegram trigger / full",
  translation: null,
};

const lowQualityTweet = {
  ...completeTweet,
  id: "456",
  text: "This matters because",
};

const first = await guardedTweetByIdFetch({
  tweetId: "123",
  detail: "tweet-id 123",
  fetchTweetById: async () => completeTweet,
  db,
});
assert.equal(first.status, "success");
assert.equal(first.pointsReserved, 1);

const second = await guardedTweetByIdFetch({
  tweetId: "123",
  detail: "tweet-id 123",
  fetchTweetById: async () => {
    throw new Error("should not refetch inside cooldown");
  },
  db,
});
assert.equal(second.status, "cooldown");
assert.equal(second.pointsReserved, 0);

const lowQuality = await guardedTweetByIdFetch({
  tweetId: "456",
  detail: "tweet-id 456",
  fetchTweetById: async () => lowQualityTweet,
  db,
});
assert.equal(lowQuality.status, "low_quality");
assert.equal(lowQuality.pointsReserved, 1);

const lowQualityRepeat = await guardedTweetByIdFetch({
  tweetId: "456",
  detail: "tweet-id 456",
  fetchTweetById: async () => {
    throw new Error("should not refetch low quality inside cooldown");
  },
  db,
});
assert.equal(lowQualityRepeat.status, "cooldown");
assert.equal(lowQualityRepeat.pointsReserved, 0);

console.log("ok - guarded tweet-by-id fetch shares cooldown across callers");
