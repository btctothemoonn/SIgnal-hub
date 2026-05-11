import assert from "node:assert/strict";

process.env.TWITTER_TOKEN = "test-token";
process.env.TWITTER_TRANSLATE_ENABLED = "false";

const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  return new Response(
    JSON.stringify({
      data: {
        id: "2049724698435735806",
        text: "This some wild shit\nKind of feels like oil is up infinite",
        createdAt: "Thu Apr 30 05:37:04 +0000 2026",
        favoriteCount: 10,
        retweetCount: 2,
        replyCount: 3,
        quoteCount: 1,
        viewCount: 1000,
        userScreenName: "DonAlt",
        userName: "DonAlt",
        media: [
          {
            type: "photo",
            url: "https://pbs.twimg.com/media/example.jpg",
          },
        ],
        quotedTweet: {
          id: "2049000000000000000",
          text: "quoted original text",
          createdAt: "Thu Apr 30 04:00:00 +0000 2026",
          userScreenName: "MacroScope",
          userName: "Macro Scope",
          permanentUrl: "https://x.com/MacroScope/status/2049000000000000000",
          media: [
            {
              type: "photo",
              url: "https://pbs.twimg.com/media/quote.jpg",
            },
          ],
        },
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
};

const { get6551TwitterTweetById } = await import("./6551-twitter.ts");

const tweet = await get6551TwitterTweetById("2049724698435735806");

assert.equal(requests.length, 1);
assert.equal(String(requests[0].url), "https://ai.6551.io/open/twitter_tweet_by_id");
assert.deepEqual(JSON.parse(requests[0].init.body), {
  twId: "2049724698435735806",
});
assert.equal(tweet?.id, "2049724698435735806");
assert.equal(tweet?.username, "DonAlt");
assert.equal(tweet?.queryLabel, "Telegram trigger / full");
assert.equal(tweet?.text, "This some wild shit Kind of feels like oil is up infinite");
assert.deepEqual(tweet?.quotedTweet, {
  id: "2049000000000000000",
  text: "quoted original text",
  createdAt: "Thu Apr 30 04:00:00 +0000 2026",
  username: "MacroScope",
  displayName: "Macro Scope",
  profileUrl: "https://x.com/MacroScope",
  userAvatar: "",
  tweetUrl: "https://x.com/MacroScope/status/2049000000000000000",
  media: [
    {
      kind: "image",
      mimeType: "",
      previewUrl: "https://pbs.twimg.com/media/quote.jpg",
      label: "photo",
      width: null,
      height: null,
    },
  ],
  translation: null,
  relation: "quote",
});
assert.deepEqual(tweet?.media, [
  {
    kind: "image",
    mimeType: "",
    previewUrl: "https://pbs.twimg.com/media/example.jpg",
    label: "photo",
    width: null,
    height: null,
  },
]);
assert.equal(tweet?.translation, null);

const replyRequests = [];
globalThis.fetch = async (url, init) => {
  replyRequests.push({ url, init });
  return new Response(
    JSON.stringify({
      data: {
        id: "2051538614425981072",
        text: "81300\u5e73\u4e86\u5df2\u7ecf",
        createdAt: "Tue May 05 05:44:56 +0000 2026",
        userScreenName: "Jason60704294",
        userName: "jasonleo",
        isReply: true,
        replyStatus: {
          id: "2051493470779687341",
          text: " ",
          createdAt: "Tue May 05 02:45:32 +0000 2026",
          userScreenName: "Jason60704294",
          userName: "jasonleo",
          media: [
            {
              type: "photo",
              url: "https://pbs.twimg.com/media/HHheb32a0AAWvIB.jpg",
            },
          ],
        },
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
};

const replyTweet = await get6551TwitterTweetById("2051538614425981072");

assert.equal(replyRequests.length, 1);
assert.equal(replyTweet?.id, "2051538614425981072");
assert.equal(replyTweet?.userAvatar, "");
assert.deepEqual(replyTweet?.media, []);
assert.deepEqual(replyTweet?.quotedTweet, {
  id: "2051493470779687341",
  text: "",
  createdAt: "Tue May 05 02:45:32 +0000 2026",
  username: "Jason60704294",
  displayName: "jasonleo",
  profileUrl: "https://x.com/Jason60704294",
  userAvatar: "",
  tweetUrl: "https://x.com/Jason60704294/status/2051493470779687341",
  media: [
    {
      kind: "image",
      mimeType: "",
      previewUrl: "https://pbs.twimg.com/media/HHheb32a0AAWvIB.jpg",
      label: "photo",
      width: null,
      height: null,
    },
  ],
  translation: null,
  relation: "reply",
});

console.log("ok - 6551 tweet by id normalizes a single tweet");
