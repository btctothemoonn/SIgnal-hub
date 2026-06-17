import assert from "node:assert/strict";
import {
  isCompleteHybridQuotedTweet,
  resolveHybridQuotedTweet,
  toQuotedTweet,
} from "./x-hybrid-quoted-tweet.ts";

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

function quoted(overrides = {}) {
  return {
    id: "2",
    text: "",
    createdAt: "",
    username: "quoted",
    displayName: "Quoted",
    profileUrl: "https://x.com/quoted",
    userAvatar: "https://unavatar.io/twitter/quoted",
    tweetUrl: "https://x.com/quoted/status/2",
    media: [],
    translation: null,
    ...overrides,
  };
}

function deps(overrides = {}) {
  const saved = [];
  return {
    saved,
    getFeedItem: () => null,
    getQuotedTweet: () => null,
    saveQuotedTweet: (item) => saved.push(item),
    reservePoints: () => ({
      allowed: true,
      kind: "tweet_by_id",
      points: 1,
      snapshot: {},
      reason: null,
    }),
    fetchTweetById: async () => null,
    ...overrides,
  };
}

assert.equal(isCompleteHybridQuotedTweet(null), false);
assert.equal(isCompleteHybridQuotedTweet(quoted()), false);
assert.equal(isCompleteHybridQuotedTweet(quoted({ text: "quoted text" })), true);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      text: "As he said, he is fully aware of the legal and regulatory risks. Yet a shell called @Aster_DEX was created that appears to copy the @HyperliquidX model and",
    }),
  ),
  false,
);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      text: "PCB 这块主要看沪电、胜宏、生益",
    }),
  ),
  true,
);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      text: "This matters because",
    }),
  ),
  false,
);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      text: "He said \"the move is just getting",
    }),
  ),
  false,
);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      text: "truncated quoted text... https://x.com/quoted/status/2",
    }),
  ),
  false,
);
assert.equal(
  isCompleteHybridQuotedTweet(
    quoted({
      relation: "reply",
      media: [
        {
          kind: "image",
          mimeType: "",
          previewUrl: "https://pbs.twimg.com/media/reply.jpg",
          label: "photo",
          width: null,
          height: null,
        },
      ],
    }),
  ),
  true,
);

assert.deepEqual(toQuotedTweet(feedItem()).text, "main tweet");

{
  const d = deps();
  const result = await resolveHybridQuotedTweet(feedItem(), d);
  assert.equal(result.status, "none");
  assert.equal(d.saved.length, 0);
}

{
  const d = deps();
  const main = feedItem({ quotedTweet: quoted({ text: "embedded quote" }) });
  const result = await resolveHybridQuotedTweet(main, d);
  assert.equal(result.status, "complete");
  assert.equal(result.feedItem.quotedTweet.text, "embedded quote");
  assert.equal(d.saved[0].text, "embedded quote");
}

{
  const fetched = feedItem({
    id: "2",
    text: "fetched full quoted text with the missing tail restored",
  });
  const d = deps({ fetchTweetById: async () => fetched });
  const result = await resolveHybridQuotedTweet(
    feedItem({
      quotedTweet: quoted({
        text: "fetched full quoted text... https://x.com/quoted/status/2",
      }),
    }),
    d,
  );
  assert.equal(result.status, "fetched");
  assert.equal(
    result.feedItem.quotedTweet.text,
    "fetched full quoted text with the missing tail restored",
  );
  assert.equal(d.saved[0].text, "fetched full quoted text with the missing tail restored");
}

{
  const cached = feedItem({ id: "2", text: "cached quote" });
  const d = deps({ getFeedItem: () => cached });
  const result = await resolveHybridQuotedTweet(
    feedItem({ quotedTweet: quoted() }),
    d,
  );
  assert.equal(result.status, "cached");
  assert.equal(result.feedItem.quotedTweet.text, "cached quote");
  assert.equal(result.pointsReserved, 0);
}

{
  const fetched = feedItem({ id: "2", text: "fetched quote" });
  const d = deps({ fetchTweetById: async () => fetched });
  const result = await resolveHybridQuotedTweet(
    feedItem({ quotedTweet: quoted({ relation: "reply" }) }),
    d,
  );
  assert.equal(result.status, "fetched");
  assert.equal(result.feedItem.quotedTweet.text, "fetched quote");
  assert.equal(result.feedItem.quotedTweet.relation, "reply");
  assert.equal(result.pointsReserved, 1);
  assert.equal(d.saved[0].text, "fetched quote");
  assert.equal(d.saved[0].relation, "reply");
}

{
  const d = deps({
    reservePoints: () => ({
      allowed: false,
      kind: "tweet_by_id",
      points: 1,
      snapshot: {},
      reason: "limit reached",
    }),
  });
  const result = await resolveHybridQuotedTweet(
    feedItem({ quotedTweet: quoted() }),
    d,
  );
  assert.equal(result.status, "pending");
  assert.equal(result.pointsReserved, 0);
  assert.equal(result.feedItem.quotedTweet.text, "");
}

console.log("ok - x hybrid quoted tweet resolver fills missing quote text");
