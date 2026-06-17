import assert from "node:assert/strict";
import {
  isCompleteReferencedTweet,
  isLikelyAbruptlyCutText,
  summarizeTweetFetchQuality,
} from "./x-hybrid-tweet-quality.ts";

function feedItem(overrides = {}) {
  return {
    id: "1",
    text: "main tweet",
    createdAt: "2026-05-05T00:00:00.000Z",
    username: "main",
    displayName: "Main",
    profileUrl: "https://x.com/main",
    userAvatar: "https://unavatar.io/twitter/main",
    tweetUrl: "https://x.com/main/status/1",
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
    ...overrides,
  };
}

assert.equal(isLikelyAbruptlyCutText("This matters because"), true);
assert.equal(isLikelyAbruptlyCutText("PCB 这块主要看沪电、胜宏、生益。"), false);
assert.equal(isCompleteReferencedTweet({ id: "2", text: "quoted text", media: [] }), true);
assert.equal(
  isCompleteReferencedTweet({
    id: "2",
    text: "As he said, he is fully aware of the legal and regulatory risks and",
    media: [],
  }),
  false,
);

assert.deepEqual(summarizeTweetFetchQuality(feedItem()), {
  complete: true,
  reason: "complete",
});
assert.deepEqual(
  summarizeTweetFetchQuality(
    feedItem({
      text: "This matters because",
    }),
  ),
  {
    complete: false,
    reason: "main-text-incomplete",
  },
);
assert.deepEqual(
  summarizeTweetFetchQuality(
    feedItem({
      quotedTweet: {
        id: "2",
        text: "As he said, he is fully aware of the legal and regulatory risks and",
        createdAt: "",
        username: "quoted",
        displayName: "Quoted",
        profileUrl: "https://x.com/quoted",
        userAvatar: "",
        tweetUrl: "https://x.com/quoted/status/2",
        media: [],
        translation: null,
        relation: "quote",
      },
    }),
  ),
  {
    complete: false,
    reason: "quoted-text-incomplete",
  },
);

console.log("ok - x hybrid tweet quality identifies incomplete fetch results");
