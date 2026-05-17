import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "x-pipeline-store-test-"));
  const runtimeStorageSource = await readFile(
    new URL("./runtime-storage.ts", import.meta.url),
    "utf8",
  );
  const configSource = (
    await readFile(new URL("./x-pipeline-config.ts", import.meta.url), "utf8")
  ).replace('from "./runtime-storage.ts"', 'from "./runtime-storage.mjs"');
  const usageSource = (
    await readFile(new URL("./x-api-usage.ts", import.meta.url), "utf8")
  ).replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"');
  const translateSource = await readFile(
    new URL("./translate.ts", import.meta.url),
    "utf8",
  );
  const translationQualitySource = await readFile(
    new URL("./translation-quality.ts", import.meta.url),
    "utf8",
  );
  const storeSource = (
    await readFile(new URL("./x-pipeline-store.ts", import.meta.url), "utf8")
  )
    .replace('from "./x-pipeline-config.ts"', 'from "./x-pipeline-config.mjs"')
    .replace('from "./x-api-usage.ts"', 'from "./x-api-usage.mjs"')
    .replace('from "./translate.ts"', 'from "./translate.mjs"')
    .replace('from "./translation-quality.ts"', 'from "./translation-quality.mjs"');

  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  await writeFile(
    join(dir, "runtime-storage.mjs"),
    ts.transpileModule(runtimeStorageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-pipeline-config.mjs"),
    ts.transpileModule(configSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-api-usage.mjs"),
    ts.transpileModule(usageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "translation-quality.mjs"),
    ts.transpileModule(translationQualitySource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "translate.mjs"),
    ts.transpileModule(
      translateSource.replace(
        'from "./translation-quality.ts"',
        'from "./translation-quality.mjs"',
      ),
      { compilerOptions },
    ).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "x-pipeline-store.mjs"),
    ts.transpileModule(storeSource, { compilerOptions }).outputText,
    "utf8",
  );
  return import(`file:///${join(dir, "x-pipeline-store.mjs").replace(/\\/g, "/")}`);
}

const {
  openXPipelineDb,
  disableXPipelineAccountsExcept,
  getXPipelineLatestUpdatedAt,
  getXPipelineSnapshot,
  listXPipelineTranslationCandidates,
  setXPipelineFeedTranslation,
  setXPipelineHealth,
  upsertXPipelineAccount,
  upsertXPipelineRealtimeUpdate,
} = await transpileToTemp();

process.env.TWITTER_TOKEN = "test-token";

const db = openXPipelineDb(":memory:");
upsertXPipelineAccount(
  {
    username: "SpaceY",
    name: "Space Y",
    profileUrl: "https://x.com/SpaceY",
    avatar: "https://cdn.example/avatar.jpg",
    note: "local",
    tags: ["alpha"],
  },
  db,
);
upsertXPipelineAccount(
  {
    username: "unused",
    name: "Unused",
    profileUrl: "https://x.com/unused",
    avatar: "",
    note: "",
    tags: [],
  },
  db,
);
disableXPipelineAccountsExcept(["spacey"], db);
upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_TWEET",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T00:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "177",
      text: "first tweet",
      createdAt: "2026-04-28T00:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "https://cdn.example/avatar.jpg",
      tweetUrl: "https://x.com/SpaceY/status/177",
      hashtags: ["BTC"],
      likes: 1,
      retweets: 2,
      replies: 3,
      quotes: 4,
      views: 5,
      media: [
        {
          kind: "image",
          mimeType: "",
          previewUrl: "https://pbs.twimg.com/media/example.jpg",
          label: "photo",
          width: null,
          height: null,
        },
      ],
      quotedTweet: {
        id: "quote-1",
        text: "quoted original",
        createdAt: "2026-04-27T23:59:00.000Z",
        username: "Quoted",
        displayName: "Quoted Account",
        profileUrl: "https://x.com/Quoted",
        userAvatar: "https://unavatar.io/twitter/Quoted",
        tweetUrl: "https://x.com/Quoted/status/quote-1",
        media: [],
        translation: null,
      },
      origin: "watch",
      queryLabel: "Realtime - new tweet",
      translation: null,
    },
  },
  db,
);
upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_TWEET",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T00:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "177",
      text: "updated tweet",
      createdAt: "2026-04-28T00:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "https://cdn.example/avatar.jpg",
      tweetUrl: "https://x.com/SpaceY/status/177",
      hashtags: ["BTC"],
      likes: 10,
      retweets: 20,
      replies: 30,
      quotes: 40,
      views: 50,
      media: [
        {
          kind: "image",
          mimeType: "",
          previewUrl: "https://pbs.twimg.com/media/example-updated.jpg",
          label: "photo",
          width: null,
          height: null,
        },
      ],
      quotedTweet: {
        id: "quote-1",
        text: "quoted original updated",
        createdAt: "2026-04-27T23:59:00.000Z",
        username: "Quoted",
        displayName: "Quoted Account",
        profileUrl: "https://x.com/Quoted",
        userAvatar: "https://unavatar.io/twitter/Quoted",
        tweetUrl: "https://x.com/Quoted/status/quote-1",
        media: [],
        translation: {
          provider: "mymemory",
          sourceLanguage: "en",
          targetLanguage: "zh-CN",
          text: "引用原文",
        },
      },
      origin: "watch",
      queryLabel: "Realtime - new tweet",
      translation: null,
    },
  },
  db,
);
setXPipelineHealth(
  {
    scope: "collector",
    status: "live",
    detail: "connected",
  },
  db,
);

const snapshot = getXPipelineSnapshot(100, db);
assert.equal(snapshot.provider, "6551");
assert.equal(snapshot.status, "live");
assert.equal(snapshot.watchAccounts.length, 1);
assert.equal(snapshot.watchAccounts[0].username, "SpaceY");
assert.equal(snapshot.feed.length, 1);
assert.equal(snapshot.feed[0].id, "177");
assert.equal(snapshot.feed[0].text, "updated tweet");
assert.deepEqual(snapshot.feed[0].hashtags, ["BTC"]);
assert.deepEqual(snapshot.feed[0].media, [
  {
    kind: "image",
    mimeType: "",
    previewUrl: "https://pbs.twimg.com/media/example-updated.jpg",
    label: "photo",
    width: null,
    height: null,
  },
]);
assert.deepEqual(snapshot.feed[0].quotedTweet, {
  id: "quote-1",
  text: "quoted original updated",
  createdAt: "2026-04-27T23:59:00.000Z",
  username: "Quoted",
  displayName: "Quoted Account",
  profileUrl: "https://x.com/Quoted",
  userAvatar: "https://unavatar.io/twitter/Quoted",
  tweetUrl: "https://x.com/Quoted/status/quote-1",
  media: [],
  translation: {
    provider: "mymemory",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    text: "引用原文",
  },
  relation: "quote",
});
assert.equal(snapshot.feed[0].likes, 10);
assert.deepEqual(listXPipelineTranslationCandidates(10, db), [
  { id: "177", text: "updated tweet" },
]);
setXPipelineFeedTranslation("177", {
  provider: "mymemory",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  text: "更新的推文",
}, db);
assert.equal(getXPipelineSnapshot(100, db).feed[0].translation?.text, "更新的推文");
assert.ok(getXPipelineLatestUpdatedAt(db));

upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_TWEET",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "Wed Feb 04 22:22:46 +0000 2026",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "old-twitter-date",
      text: "old tweet with twitter date",
      createdAt: "Wed Feb 04 22:22:46 +0000 2026",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "https://cdn.example/avatar.jpg",
      tweetUrl: "https://x.com/SpaceY/status/old-twitter-date",
      hashtags: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      media: [],
      origin: "watch",
      queryLabel: "Telegram trigger / full",
      translation: null,
    },
  },
  db,
);
const sortedSnapshot = getXPipelineSnapshot(100, db);
assert.equal(sortedSnapshot.feed[0].id, "177");
assert.equal(sortedSnapshot.feed[1].id, "old-twitter-date");
assert.equal(
  sortedSnapshot.feed[1].createdAt,
  "2026-02-04T22:22:46.000Z",
);

process.env.TWITTER_CONNECTOR_ENABLED = "false";
process.env.MONITOR985_ENABLED = "true";
assert.equal(getXPipelineSnapshot(100, db).status, "live");
process.env.TWITTER_CONNECTOR_ENABLED = "";
process.env.MONITOR985_ENABLED = "";

upsertXPipelineRealtimeUpdate(
  {
    eventType: "TG_HYBRID",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T01:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "missing-avatar",
      text: "tweet without avatar from by-id fallback",
      createdAt: "2026-04-28T01:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "",
      tweetUrl: "https://x.com/SpaceY/status/missing-avatar",
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
    },
  },
  db,
);
upsertXPipelineRealtimeUpdate(
  {
    eventType: "TG_HYBRID",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T02:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "quoted-missing-avatar",
      text: "tweet with quoted author avatar missing",
      createdAt: "2026-04-28T02:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "",
      tweetUrl: "https://x.com/SpaceY/status/quoted-missing-avatar",
      hashtags: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      media: [],
      quotedTweet: {
        id: "quoted-no-avatar",
        text: "quoted text",
        createdAt: "2026-04-28T01:59:00.000Z",
        username: "QuoteAuthor",
        displayName: "Quote Author",
        profileUrl: "https://x.com/QuoteAuthor",
        userAvatar: "",
        tweetUrl: "https://x.com/QuoteAuthor/status/quoted-no-avatar",
        media: [
          {
            kind: "image",
            mimeType: "",
            previewUrl: "https://pbs.twimg.com/media/not-avatar.jpg",
            label: "photo",
            width: null,
            height: null,
          },
        ],
        translation: null,
        relation: "quote",
      },
      origin: "watch",
      queryLabel: "Telegram trigger / full",
      translation: null,
    },
  },
  db,
);
const missingAvatarItem = getXPipelineSnapshot(100, db).feed.find(
  (item) => item.id === "missing-avatar",
);
assert.equal(missingAvatarItem?.userAvatar, "https://cdn.example/avatar.jpg");

upsertXPipelineAccount(
  {
    username: "SpaceY",
    name: "Space Y",
    profileUrl: "https://x.com/SpaceY",
    avatar: "https://unavatar.io/twitter/spacey",
    note: "fallback should not replace cached avatar",
  },
  db,
);
const preservedAccount = getXPipelineSnapshot(100, db).watchAccounts.find(
  (account) => account.username === "SpaceY",
);
assert.equal(preservedAccount?.avatar, "https://cdn.example/avatar.jpg");

upsertXPipelineRealtimeUpdate(
  {
    eventType: "TG_HYBRID",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T03:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "fallback-avatar-incoming",
      text: "tweet with fallback avatar from incoming source",
      createdAt: "2026-04-28T03:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "https://unavatar.io/twitter/spacey",
      tweetUrl: "https://x.com/SpaceY/status/fallback-avatar-incoming",
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
    },
  },
  db,
);
const fallbackIncomingItem = getXPipelineSnapshot(100, db).feed.find(
  (item) => item.id === "fallback-avatar-incoming",
);
assert.equal(fallbackIncomingItem?.userAvatar, "https://cdn.example/avatar.jpg");
const rangeSnapshot = getXPipelineSnapshot(100, db, {
  since: "2026-04-28T02:30:00.000Z",
});
assert.deepEqual(
  rangeSnapshot.feed.map((item) => item.id),
  ["fallback-avatar-incoming"],
);

const quotedMissingAvatarItem = getXPipelineSnapshot(100, db).feed.find(
  (item) => item.id === "quoted-missing-avatar",
);
assert.equal(
  quotedMissingAvatarItem?.quotedTweet?.userAvatar,
  "https://unavatar.io/twitter/QuoteAuthor",
);

upsertXPipelineRealtimeUpdate(
  {
    eventType: "NEW_RETWEET",
    account: "SpaceY",
    displayName: "Space Y",
    createdAt: "2026-04-28T04:00:00.000Z",
    profileUrl: "https://x.com/SpaceY",
    remark: "",
    feedItem: {
      id: "legacy-short-translation",
      text: "1/ Meet Dritan Kapllani Jr, a US based threat actor tied to $19M from social engineering thefts targeting crypto holders.\n\nDritan flexes luxury cars, watches, private jets, & clubs all over social media.\n\nRecently he was recorded on a call showing off a wallet with stolen funds.",
      createdAt: "2026-04-28T04:00:00.000Z",
      username: "SpaceY",
      displayName: "Space Y",
      profileUrl: "https://x.com/SpaceY",
      userAvatar: "https://cdn.example/avatar.jpg",
      tweetUrl: "https://x.com/SpaceY/status/legacy-short-translation",
      hashtags: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      media: [],
      quotedTweet: null,
      origin: "watch",
      queryLabel: "985monitor / NEW_RETWEET",
      translation: null,
    },
  },
  db,
);
setXPipelineFeedTranslation(
  "legacy-short-translation",
  {
    provider: "985monitor",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    text: "RT @zachxbt:1/ 见到美国威胁演员小Dritan Kapllani,",
  },
  db,
);
const legacyShortTranslationItem = getXPipelineSnapshot(100, db).feed.find(
  (item) => item.id === "legacy-short-translation",
);
assert.equal(legacyShortTranslationItem?.translation, null);
assert.ok(
  listXPipelineTranslationCandidates(100, db).some(
    (item) => item.id === "legacy-short-translation",
  ),
);

const editDb = openXPipelineDb(":memory:");
upsertXPipelineAccount(
  {
    username: "bboczeng",
    name: "勃勃OC",
    profileUrl: "https://x.com/bboczeng",
    avatar: "https://cdn.example/bboczeng.jpg",
    note: "monitor985",
    tags: [],
  },
  editDb,
);
setXPipelineHealth(
  {
    scope: "collector",
    status: "live",
    detail: "connected",
  },
  editDb,
);

const editedTweetBase = {
  username: "bboczeng",
  displayName: "勃勃OC",
  profileUrl: "https://x.com/bboczeng",
  userAvatar: "https://cdn.example/bboczeng.jpg",
  hashtags: [],
  likes: 0,
  retweets: 0,
  replies: 0,
  quotes: 0,
  views: 0,
  media: [],
  quotedTweet: null,
  origin: "watch",
  queryLabel: "985monitor / NEW_TWEET",
  translation: null,
};

for (const update of [
  {
    id: "edit-1",
    createdAt: "2026-05-17T11:36:00.000Z",
    text: "睡了一会儿，从梦中惊醒\n\nThis time, is indeed\n\nDifferent",
  },
  {
    id: "edit-2",
    createdAt: "2026-05-17T11:37:00.000Z",
    text: "睡了一会儿，从梦中惊醒\n\nThis time, is indeed\n\nDifferent\n\nAI 将吞噬全世界\n\n直到2030年！",
  },
  {
    id: "edit-3",
    createdAt: "2026-05-17T11:39:00.000Z",
    text: "睡了一会儿，从梦中惊醒\n\nThis time, is indeed\n\nDifferent\n\nAI 将吞噬全世界\n\n注：最终版保留\n\n直到2030年！",
  },
  {
    id: "separate",
    createdAt: "2026-05-17T11:40:00.000Z",
    text: "这是另一条完全不同的推文，不能因为时间接近就被折叠。",
  },
  {
    id: "short-edit-1",
    createdAt: "2026-05-17T11:41:00.000Z",
    text: "我操，这下得做多SNDK和LITE了\n\n谢谢大家\n\n😓😓😓",
  },
  {
    id: "short-edit-2",
    createdAt: "2026-05-17T11:42:00.000Z",
    text: "我操，这下得做多SNDK和LITE了\n\nAI Bottleneck，而且还是Rule of 80\n\n谢谢大家\n\n😓😓😓",
  },
  {
    id: "cross-event-reply",
    eventType: "NEW_TWEET_REPLY",
    queryLabel: "985monitor / NEW_TWEET_REPLY",
    createdAt: "2026-05-17T11:43:00.000Z",
    text: "这是我问了AI的结果，忘记说Offloading了，难怪NAND价格爆炸😓😓\n\n1. 片上/板内通信不需要光\n\n2. 机柜间需要光通信",
  },
  {
    id: "cross-event-retweet",
    eventType: "NEW_RETWEET",
    queryLabel: "985monitor / NEW_RETWEET",
    createdAt: "2026-05-17T11:43:05.000Z",
    text: "这是我问了AI的结果，忘记说Offloading了，难怪NAND价格爆炸😓😓\n\n1. 片上/板内通信不需要光\n\n2. 机柜间需要光通信",
  },
]) {
  upsertXPipelineRealtimeUpdate(
    {
      eventType: update.eventType || "NEW_TWEET",
      account: "bboczeng",
      displayName: "勃勃OC",
      createdAt: update.createdAt,
      profileUrl: "https://x.com/bboczeng",
      remark: "",
      feedItem: {
        ...editedTweetBase,
        id: update.id,
        text: update.text,
        createdAt: update.createdAt,
        tweetUrl: `https://x.com/bboczeng/status/${update.id}`,
        queryLabel: update.queryLabel || editedTweetBase.queryLabel,
      },
    },
    editDb,
  );
}

assert.deepEqual(
  getXPipelineSnapshot(100, editDb).feed.map((item) => item.id),
  ["cross-event-retweet", "short-edit-2", "separate", "edit-3"],
);

console.log("ok - x pipeline store builds local dashboard snapshots");
