
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize6551PushedTweet } from "./6551-twitter.ts";
import { classifyXFeedSource } from "./x-feed-source.ts";
import { getXPipelineFeedItem, listXPipelineFeedObservations, openXPipelineDb, upsertXPipelineRealtimeUpdate } from "./x-pipeline-store.ts";
import { hasXPipelineDataSource, isX6551WsEnabled, isXPipelineEnabled } from "./x-pipeline-config.ts";
import { getXSourceBadgeLabel, matchesSignalFeedCollector, matchesSignalFeedTab } from "./signal-feed-tabs.ts";

const id = "2123456789012345678";
const createdAt = "2026-11-18T02:00:00.000Z";
const content = { id, text: "A real post from Alice...", userScreenName: "Alice", createdAt };
const event = { id: 12345, twAccount: "Alice", eventType: "NEW_TWEET", content, createdAt: "2026-11-18T02:01:00Z" };

test("normalizes the tweet ID and publication time from the WSS content", () => {
  const update = normalize6551PushedTweet({ ...event, content: JSON.stringify(content) });
  assert.equal(update.feedItem.id, id);
  assert.equal(update.feedItem.createdAt, createdAt);
  assert.equal(update.feedItem.contentSource, "6551");
  assert.equal(update.feedItem.contentComplete, false);
  assert.equal(update.feedItem.translation, null);
  assert.equal(normalize6551PushedTweet({ ...event, eventType: "NEW_FOLLOWER" }), null);
  assert.equal(normalize6551PushedTweet({ ...event, content: "plain text with no tweet ID" }), null);
  assert.equal(normalize6551PushedTweet({ ...event, content: { ...content, id: Number(id) } }), null);
  assert.equal(normalize6551PushedTweet({ ...event, content: { ...content, userScreenName: "Bob" } }), null);
  assert.equal(normalize6551PushedTweet({ ...event, content: { ...content, createdAt: undefined } }), null);
});

test("merges all three observations by ID and retains the first collector and insert timestamp", (t) => {
  const db = openXPipelineDb(":memory:");
  t.after(() => db.close());
  const push = normalize6551PushedTweet(event);
  const owned = { ...push, feedItem: { ...push.feedItem, text: "A real post from Alice with extra context.", contentComplete: true, contentSource: "owned-reader", queryLabel: "owned-reader / full" } };
  const via985 = { ...push, feedItem: { ...push.feedItem, contentSource: "monitor985", queryLabel: "985monitor / NEW_TWEET" } };
  upsertXPipelineRealtimeUpdate(push, db);
  const firstInserted = db.prepare("select inserted_at from x_feed where id = ?").get(id).inserted_at;
  upsertXPipelineRealtimeUpdate(owned, db);
  upsertXPipelineRealtimeUpdate(via985, db);
  assert.equal(db.prepare("select count(*) as count from x_feed").get().count, 1);
  assert.equal(db.prepare("select inserted_at from x_feed where id = ?").get(id).inserted_at, firstInserted);
  const saved = getXPipelineFeedItem(id, db);
  assert.equal(saved.text, owned.feedItem.text);
  assert.equal(saved.contentSource, "owned-reader");
  assert.equal(classifyXFeedSource(saved), "6551");
  assert.deepEqual(listXPipelineFeedObservations(id, db).map(({ source }) => source), ["6551", "monitor985", "owned-reader"]);
});

test("keeps the existing collector for a legacy row when WSS later fills it in", (t) => {
  const db = openXPipelineDb(":memory:");
  t.after(() => db.close());
  const push = normalize6551PushedTweet({ ...event, content: { ...content, fullText: "Complete text from Alice." } });
  upsertXPipelineRealtimeUpdate({
    ...push,
    feedItem: { ...push.feedItem, text: content.text, contentComplete: false, contentSource: "monitor985", queryLabel: "985monitor / NEW_TWEET" },
  }, db);
  db.prepare("update x_feed set first_source = null where id = ?").run(id);
  upsertXPipelineRealtimeUpdate({
    ...push, eventType: "NEW_TWEET_QUOTE",
    feedItem: { ...push.feedItem, contentSource: "owned-reader", queryLabel: "owned-reader / full" },
  }, db);
  db.prepare("update x_feed set first_source = null where id = ?").run(id);
  db.prepare("update x_feed_observations set first_seen_at = ? where source = 'monitor985'").run(createdAt);
  const weakerPush = normalize6551PushedTweet({ ...event, content: { ...content, createdAt: "2026-11-18T18:00:00Z" } });
  upsertXPipelineRealtimeUpdate(weakerPush, db);
  const saved = getXPipelineFeedItem(id, db);
  assert.equal(saved.text, push.feedItem.text);
  assert.equal(saved.createdAt, createdAt);
  assert.equal(saved.eventType, "NEW_TWEET_QUOTE");
  assert.equal(classifyXFeedSource(saved), "monitor985");
});

test("a later equally complete source can add media but cannot replace first-published text", (t) => {
  const db = openXPipelineDb(":memory:");
  t.after(() => db.close());
  const first = normalize6551PushedTweet({ ...event, content: { ...content, fullText: "First text." } });
  upsertXPipelineRealtimeUpdate(first, db);
  const media = { kind: "image", previewUrl: "https://pbs.twimg.com/media/example.jpg" };
  upsertXPipelineRealtimeUpdate({
    ...first,
    feedItem: { ...first.feedItem, text: "Different text.", media: [media], contentSource: "monitor985", queryLabel: "985monitor / NEW_TWEET" },
  }, db);
  const saved = getXPipelineFeedItem(id, db);
  assert.equal(saved.text, "First text.");
  assert.equal(saved.media[0].previewUrl, media.previewUrl);
  assert.equal(classifyXFeedSource(saved), "6551");
});

test("makes the WSS feed visible with the REST provider disabled", () => {
  const env = { X_6551_WS_ENABLED: "true", TWITTER_TOKEN: "fixture" };
  assert.equal(isX6551WsEnabled(env), true);
  assert.equal(isXPipelineEnabled(env), false);
  assert.equal(hasXPipelineDataSource(env), true);
  assert.equal(isX6551WsEnabled({ TWITTER_CONNECTOR_ENABLED: "true" }), false);
  assert.equal(getXSourceBadgeLabel("6551"), "6551");
  assert.equal(getXSourceBadgeLabel("x"), "6551 历史");
  assert.equal(matchesSignalFeedTab({ source: "6551" }, "x"), true);
  assert.equal(matchesSignalFeedCollector({ source: "6551" }, "6551"), true);
});
