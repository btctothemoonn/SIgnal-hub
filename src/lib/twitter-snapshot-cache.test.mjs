import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("mergeRealtimeUpdateIntoTwitterSnapshot prepends new events without duplicating tweets", async () => {
  const { mergeRealtimeUpdateIntoTwitterSnapshot } = await importTs(
    "./twitter-snapshot-cache.ts",
  );

  const baseTweet = {
    id: "1",
    text: "old",
    createdAt: "2026-04-24T00:00:00.000Z",
    username: "old_account",
    displayName: "Old",
    profileUrl: "https://x.com/old_account",
    userAvatar: "https://unavatar.io/twitter/old_account",
    tweetUrl: "https://x.com/old_account/status/1",
    hashtags: [],
    likes: 0,
    retweets: 0,
    replies: 0,
    quotes: 0,
    views: 0,
    media: [],
    origin: "watch",
    queryLabel: "@old_account",
    translation: null,
  };
  const incomingTweet = {
    ...baseTweet,
    id: "2",
    text: "new",
    createdAt: "2026-04-24T00:01:00.000Z",
    username: "new_account",
    displayName: "New",
    profileUrl: "https://x.com/new_account",
    userAvatar: "https://unavatar.io/twitter/new_account",
    tweetUrl: "https://x.com/new_account/status/2",
  };
  const snapshot = {
    provider: "6551",
    baseUrl: "https://ai.6551.io",
    isConfigured: true,
    isConnected: true,
    status: "live",
    watchAccounts: [],
    trackedKeywords: [],
    feed: [baseTweet],
    note: "",
    errors: [],
  };

  const once = mergeRealtimeUpdateIntoTwitterSnapshot(snapshot, {
    eventType: "NEW_TWEET",
    account: "new_account",
    displayName: "New",
    createdAt: incomingTweet.createdAt,
    profileUrl: incomingTweet.profileUrl,
    feedItem: incomingTweet,
    remark: "",
  });
  const twice = mergeRealtimeUpdateIntoTwitterSnapshot(once, {
    eventType: "NEW_TWEET",
    account: "new_account",
    displayName: "New",
    createdAt: incomingTweet.createdAt,
    profileUrl: incomingTweet.profileUrl,
    feedItem: incomingTweet,
    remark: "",
  });

  assert.deepEqual(
    twice.feed.map((item) => item.id),
    ["2", "1"],
  );
  assert.equal(twice.watchAccounts.length, 1);
  assert.equal(twice.watchAccounts[0].username, "new_account");
});

await test("isPersistedTwitterSnapshotFresh rejects stale or malformed cache records", async () => {
  const { isPersistedTwitterSnapshotFresh } = await importTs(
    "./twitter-snapshot-cache.ts",
  );

  assert.equal(
    isPersistedTwitterSnapshotFresh(
      { version: 1, fetchedAt: 1000, snapshot: { provider: "6551" } },
      1000,
      1500,
    ),
    true,
  );
  assert.equal(
    isPersistedTwitterSnapshotFresh(
      { version: 1, fetchedAt: 1000, snapshot: { provider: "6551" } },
      1000,
      2501,
    ),
    false,
  );
  assert.equal(isPersistedTwitterSnapshotFresh(null, 1000, 1500), false);
  assert.equal(
    isPersistedTwitterSnapshotFresh(
      { version: 2, fetchedAt: 1000, snapshot: { provider: "6551" } },
      1000,
      1500,
    ),
    false,
  );
});
