import assert from "node:assert/strict";

const { normalizeMonitor985Event } = await import("./monitor985.ts");

const quoteEvent = {
  key: "coin_casanova::NEW_TWEET_QUOTE::2051186335395054071",
  eventType: "NEW_TWEET_QUOTE",
  twAccount: "coin_casanova",
  createdAt: "2026-05-04T14:25:07.359455236+08:00",
  profileUrl: "https://pbs.twimg.com/profile_images/1736904520729341952/M7fED2Pw_normal.jpg",
  content: {
    id: "2051186335395054071",
    text: "Interesting time. The market is rewarding both participants. https://x.com/coin_casanova/status/2050445523879174448",
    createdAt: "Mon May 04 06:25:06 +0000 2026",
    favoriteCount: 7,
    retweetCount: 2,
    replyCount: 1,
    viewCount: 100,
    userScreenName: "coin_casanova",
    userName: "casa",
    userIdStr: "974403218099843072",
    userFollowers: 4017,
    isQuote: true,
    quotedStatus: {
      id: "2050445523879174448",
      text: "$BIO for left iq- peptide momentum - onchain degen - narrative driven\n\n$CARDS for liquid funds - muh revenue - decent unlock - invalidation thesis driven\n\ndoable.",
      createdAt: "2026-05-02T05:21:22.000Z",
      favoriteCount: 13,
      replyCount: 0,
      viewCount: 0,
      userScreenName: "coin_casanova",
      userName: "casa",
      profileUrl: "https://pbs.twimg.com/profile_images/1736904520729341952/M7fED2Pw_normal.jpg",
      media: [],
      translation: {
        zh: "$BIO 代表左派智商 - 肽动量 - 链上退化 - 叙事驱动",
        source: "ai",
      },
    },
    translation: {
      zh: "有趣的时刻。市场正在奖励参与者。",
      source: "ai",
    },
  },
  savedAt: 1777875907389,
};

const quoteUpdate = normalizeMonitor985Event(quoteEvent);
assert.equal(quoteUpdate?.eventType, "NEW_TWEET_QUOTE");
assert.equal(quoteUpdate?.account, "coin_casanova");
assert.equal(quoteUpdate?.displayName, "casa");
assert.equal(quoteUpdate?.createdAt, "2026-05-04T06:25:06.000Z");
assert.equal(quoteUpdate?.profileUrl, "https://x.com/coin_casanova");
assert.equal(quoteUpdate?.feedItem.id, "2051186335395054071");
assert.equal(quoteUpdate?.feedItem.username, "coin_casanova");
assert.equal(quoteUpdate?.feedItem.userAvatar, "https://pbs.twimg.com/profile_images/1736904520729341952/M7fED2Pw_normal.jpg");
assert.equal(quoteUpdate?.feedItem.tweetUrl, "https://x.com/coin_casanova/status/2051186335395054071");
assert.equal(quoteUpdate?.feedItem.translation?.text, "有趣的时刻。市场正在奖励参与者。");
assert.equal(quoteUpdate?.feedItem.likes, 7);
assert.equal(quoteUpdate?.feedItem.retweets, 2);
assert.equal(quoteUpdate?.feedItem.replies, 1);
assert.equal(quoteUpdate?.feedItem.views, 100);
assert.deepEqual(quoteUpdate?.feedItem.quotedTweet, {
  id: "2050445523879174448",
  text: "$BIO for left iq- peptide momentum - onchain degen - narrative driven\n\n$CARDS for liquid funds - muh revenue - decent unlock - invalidation thesis driven\n\ndoable.",
  createdAt: "2026-05-02T05:21:22.000Z",
  username: "coin_casanova",
  displayName: "casa",
  profileUrl: "https://x.com/coin_casanova",
  userAvatar: "https://pbs.twimg.com/profile_images/1736904520729341952/M7fED2Pw_normal.jpg",
  tweetUrl: "https://x.com/coin_casanova/status/2050445523879174448",
  media: [],
  translation: null,
  /* skippedTranslation: {
    provider: "985monitor",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    text: "$BIO 代表左派智商 - 肽动量 - 链上退化 - 叙事驱动",
  }, */
});

const replyUpdate = normalizeMonitor985Event({
  eventType: "NEW_TWEET_REPLY",
  twAccount: "jeery314159",
  createdAt: "2026-05-04T14:20:09.50806587+08:00",
  profileUrl: "https://pbs.twimg.com/profile_images/2016369472362160128/cV0LdYIZ_normal.jpg",
  content: {
    id: "2051185085227946048",
    text: "@GoldenCicada 他只能买它了 $ASTEROID",
    createdAt: "Mon May 04 06:20:08 +0000 2026",
    userScreenName: "jeery314159",
    userName: "Jeery",
    isReply: true,
    replyStatus: {
      id: "2051172205413998874",
      text: "这个人貌似很猛\n$ASTEROID",
      createdAt: "2026-05-04T05:28:57.000Z",
      userScreenName: "GoldenCicada",
      userName: "卷柏",
      profileUrl: "https://pbs.twimg.com/profile_images/1968364832446627842/hlMJsi0h_normal.jpg",
      media: [],
      translation: { skip: true },
    },
  },
});
assert.equal(replyUpdate?.feedItem.quotedTweet?.id, "2051172205413998874");
assert.equal(replyUpdate?.feedItem.quotedTweet?.username, "GoldenCicada");
assert.equal(replyUpdate?.feedItem.quotedTweet?.text, "这个人貌似很猛\n$ASTEROID");
assert.equal(replyUpdate?.feedItem.quotedTweet?.translation, null);

const truthUpdate = normalizeMonitor985Event({
  key: "truth::realDonaldTrump::38158",
  source: "truth",
  eventType: "NEW_TRUTH_POST",
  twAccount: "truth:realDonaldTrump",
  createdAt: "2026-05-04T02:51:11.000Z",
  profileUrl: "https://static-assets-1.truthsocial.com/avatar.png",
  content: {
    id: "38158",
    text: "TERMINATE THE FILIBUSTER, AND WIN!!! President DJT",
    userName: "Donald J. Trump",
    userScreenName: "realDonaldTrump",
    profileUrl: "https://static-assets-1.truthsocial.com/avatar.png",
    media: [],
    webLink: "https://truthsocial.com/@realDonaldTrump/posts/116514034239300873",
    source: "truth",
    translation: {
      zh: "终止阻挠议事，然后赢！！！总统DJT",
      source: "ai",
    },
  },
});
assert.equal(truthUpdate?.eventType, "NEW_TRUTH_POST");
assert.equal(truthUpdate?.account, "truth:realDonaldTrump");
assert.equal(truthUpdate?.displayName, "Donald J. Trump");
assert.equal(truthUpdate?.profileUrl, "https://truthsocial.com/@realDonaldTrump");
assert.equal(truthUpdate?.feedItem.id, "truth:38158");
assert.equal(truthUpdate?.feedItem.username, "truth:realDonaldTrump");
assert.equal(truthUpdate?.feedItem.profileUrl, "https://truthsocial.com/@realDonaldTrump");
assert.equal(truthUpdate?.feedItem.tweetUrl, "https://truthsocial.com/@realDonaldTrump/posts/116514034239300873");
assert.equal(truthUpdate?.feedItem.userAvatar, "https://static-assets-1.truthsocial.com/avatar.png");
assert.equal(truthUpdate?.feedItem.queryLabel, "985monitor / truth");
assert.equal(truthUpdate?.feedItem.translation?.text, "终止阻挠议事，然后赢！！！总统DJT");

assert.equal(normalizeMonitor985Event({ eventType: "NEW_TWEET", content: {} }), null);

console.log("ok - 985monitor events normalize into x pipeline updates");
