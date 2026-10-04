import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "./x-pipeline-store.ts";
import { X_FEED_TRANSLATION_BASE, xFeedTranslationSnapshot } from "./x-feed-merge.ts";

const translation = (text = "这是完整有效的中文译文，保留原帖的观点。") => ({
  provider: "minimax", sourceLanguage: "auto", targetLanguage: "zh-CN", text,
});
const media = [{ kind: "image", mimeType: "", previewUrl: "https://example.com/image.jpg", label: "photo", width: null, height: null }];
const quote = (overrides = {}) => ({
  id: "222", text: "Original quoted statement from this account.", createdAt: "2026-10-04T00:00:00Z",
  username: "Other", displayName: "Other", profileUrl: "https://x.com/Other", userAvatar: "",
  tweetUrl: "https://x.com/Other/status/222", media, translation: translation(), relation: "quote", ...overrides,
});
const item = (overrides = {}) => ({
  id: "111", text: "Complete owned original text with every important detail.", createdAt: "2026-10-04T00:01:00Z",
  username: "Owner", displayName: "Owner", profileUrl: "https://x.com/Owner", userAvatar: "https://example.com/avatar.jpg",
  tweetUrl: "https://x.com/Owner/status/111", hashtags: [], likes: 1, retweets: 0, replies: 0, quotes: 0, views: 0,
  media, quotedTweet: quote(), origin: "watch", queryLabel: "owned-reader / full", contentSource: "owned-reader",
  contentComplete: true, translation: translation(), ...overrides,
});
function write(db, feedItem) {
  store.upsertXPipelineRealtimeUpdate({ eventType: "NEW_TWEET_QUOTE", account: feedItem.username, displayName: feedItem.displayName,
    createdAt: feedItem.createdAt, profileUrl: feedItem.profileUrl, remark: "", feedItem }, db);
}
function database(t) { const db = store.openXPipelineDb(":memory:"); t.after(() => db.close()); return db; }

test("late partial 985 updates counters without erasing full owned body, quote, media or translations", (t) => {
  const db = database(t); const original = item(); write(db, original);
  write(db, item({ text: "Complete owned...", media: [], quotedTweet: null, translation: null, likes: 17,
    contentSource: "monitor985", contentComplete: false, queryLabel: "985monitor / NEW_TWEET_QUOTE", userAvatar: "https://unavatar.io/twitter/Owner" }));
  const result = store.getXPipelineFeedItem("111", db);
  assert.equal(result.text, original.text);
  assert.equal(result.contentSource, "owned-reader");
  assert.equal(result.contentComplete, true);
  assert.equal(result.likes, 17);
  assert.deepEqual(result.media, original.media);
  assert.equal(result.quotedTweet.text, original.quotedTweet.text);
  assert.deepEqual(result.translation, original.translation);
  assert.deepEqual(result.quotedTweet.translation, original.quotedTweet.translation);
  assert.equal(result.userAvatar, original.userAvatar);
  assert.equal(db.prepare("select count(*) as n from x_feed").get().n, 1);
});

test("identical content updates retain valid main and quote translations", (t) => {
  const db = database(t); write(db, item());
  write(db, item({ translation: null, quotedTweet: quote({ translation: null, media: [] }), media: [] }));
  const result = store.getXPipelineFeedItem("111", db);
  assert.deepEqual(result.translation, translation());
  assert.deepEqual(result.quotedTweet.translation, translation());
  assert.deepEqual(result.quotedTweet.media, media);
});

test("partial observations can add independently valid media without replacing the full body", (t) => {
  const db = database(t); write(db, item({ media: [] }));
  write(db, item({ text: "Brief...", contentSource: "monitor985", contentComplete: false,
    queryLabel: "985monitor / NEW_TWEET", translation: null }));
  assert.equal(store.getXPipelineFeedItem("111", db).text, item().text);
  assert.deepEqual(store.getXPipelineFeedItem("111", db).media, media);
});

test("same body observations cannot erase a known revision before a later verified edit", (t) => {
  const db = database(t); write(db, item({ contentVersion: "1" })); write(db, item());
  write(db, item({ text: "Corrected statement.", translation: null, contentVersion: "2" }));
  assert.equal(store.getXPipelineFeedItem("111", db).text, "Corrected statement.");
});

test("a late preview from another root retains the shared complete quote and its translation in both feeds", (t) => {
  const db = database(t);
  const full = quote({ contentSource: "owned-reader", contentComplete: true, contentVersion: "1" });
  write(db, item({ id: "root-a", quotedTweet: full }));
  write(db, item({ id: "root-b", text: "A different root references the same post.", contentSource: "monitor985", contentComplete: false,
    queryLabel: "985monitor / NEW_TWEET_QUOTE", quotedTweet: quote({ text: "Original quoted...", media: [], translation: null,
      contentSource: "monitor985", contentComplete: false }) }));
  const cached = store.getXPipelineQuotedTweet("222", db);
  const second = store.getXPipelineFeedItem("root-b", db).quotedTweet;
  for (const result of [cached, second, store.getXPipelineFeedItem("root-a", db).quotedTweet]) {
    assert.equal(result.text, full.text);
    assert.deepEqual(result.translation, full.translation);
    assert.deepEqual(result.media, full.media);
    assert.equal(result.contentSource, "owned-reader");
    assert.equal(result.contentComplete, true);
    assert.equal(result.contentVersion, "1");
  }
});

test("a quote's newer edit proof replaces longer cached text and invalidates carried translation independently of root quality", (t) => {
  const db = database(t);
  const full = quote({ contentSource: "owned-reader", contentComplete: true, contentVersion: "1" });
  write(db, item({ id: "root-a", quotedTweet: full }));
  const edited = { ...full, text: "Corrected quoted claim.", media: [], contentVersion: "2" };
  write(db, item({ id: "root-b", contentSource: "monitor985", contentComplete: false,
    queryLabel: "985monitor / NEW_TWEET_QUOTE", quotedTweet: edited }));
  for (const result of [store.getXPipelineQuotedTweet("222", db), store.getXPipelineFeedItem("root-b", db).quotedTweet]) {
    assert.equal(result.text, edited.text);
    assert.equal(result.translation, null);
    assert.equal(result.contentVersion, "2");
    assert.deepEqual(result.media, media);
  }
  // A partial root update can carry independently proved, complete quote edits.
  write(db, item({ id: "root-a", text: "Main preview...", contentSource: "monitor985", contentComplete: false,
    queryLabel: "985monitor / NEW_TWEET_QUOTE", quotedTweet: edited }));
  assert.equal(store.getXPipelineFeedItem("root-a", db).text, item().text);
  assert.equal(store.getXPipelineFeedItem("root-a", db).quotedTweet.text, edited.text);
});

test("missing quote fields preserve known full context and cached context fills a new empty reference", (t) => {
  const db = database(t);
  const full = quote({ contentSource: "owned-reader", contentComplete: true });
  write(db, item({ id: "root-a", quotedTweet: full }));
  write(db, item({ id: "root-a", media: [], quotedTweet: null }));
  assert.equal(store.getXPipelineFeedItem("root-a", db).quotedTweet.text, full.text);
  write(db, item({ id: "root-b", quotedTweet: quote({ text: "", media: [], translation: null, contentComplete: false }) }));
  const restored = store.getXPipelineFeedItem("root-b", db).quotedTweet;
  assert.equal(restored.text, full.text);
  assert.deepEqual(restored.media, media);
  assert.deepEqual(restored.translation, full.translation);
});

test("stale ingestion translation cannot revert an unversioned quoted original or its current translation", (t) => {
  const db = database(t);
  const original = item({ contentSource: "monitor985", contentComplete: undefined, queryLabel: "985monitor / NEW_TWEET_QUOTE",
    translation: null, quotedTweet: quote({ text: "The older quoted original statement.", translation: null }) });
  write(db, original);
  const before = xFeedTranslationSnapshot(store.getXPipelineFeedItem("111", db));
  const currentQuote = quote({ text: "The current quoted original has changed.", translation: translation("当前引用原文对应的有效中文译文。") });
  write(db, { ...original, quotedTweet: currentQuote });
  const staleTranslated = { ...original, translation: translation(), quotedTweet: { ...original.quotedTweet, translation: translation("先前引用正文的旧中文译文。") },
    [X_FEED_TRANSLATION_BASE]: { original: before, leaseOwner: "old-task" } };
  write(db, staleTranslated);
  for (const result of [store.getXPipelineFeedItem("111", db).quotedTweet, store.getXPipelineQuotedTweet("222", db)]) {
    assert.equal(result.text, currentQuote.text);
    assert.deepEqual(result.translation, currentQuote.translation);
  }
  assert.equal(store.getXPipelineFeedItem("111", db).translation, null);
});

test("another root changing the shared quote rejects old ingestion output and hydrates the first root with current context", (t) => {
  const db = database(t);
  const original = item({ id: "root-a", contentSource: "monitor985", contentComplete: undefined, queryLabel: "985monitor / NEW_TWEET_QUOTE",
    translation: null, quotedTweet: quote({ text: "The older shared quoted original.", translation: null }) });
  write(db, original);
  const before = xFeedTranslationSnapshot(store.getXPipelineFeedItem("root-a", db));
  const currentQuote = quote({ text: "Another root observed the current shared quoted original.", translation: translation("另一根帖新收录了当前引用内容，这是对应的有效译文。") });
  write(db, { ...original, id: "root-b", text: "Another root with this quoted post.", quotedTweet: currentQuote });
  assert.equal(store.getXPipelineFeedItem("root-a", db).quotedTweet.text, original.quotedTweet.text,
    "the first root is still unchanged when its old model output arrives");
  const staleTranslated = { ...original, translation: translation(), quotedTweet: { ...original.quotedTweet, translation: translation("引用旧正文生成的过期译文。") },
    [X_FEED_TRANSLATION_BASE]: { original: before, leaseOwner: "old-task" } };
  write(db, staleTranslated);
  for (const result of [store.getXPipelineFeedItem("root-a", db).quotedTweet, store.getXPipelineFeedItem("root-b", db).quotedTweet,
    store.getXPipelineQuotedTweet("222", db)]) {
    assert.equal(result.text, currentQuote.text);
    assert.deepEqual(result.translation, currentQuote.translation);
  }
  assert.equal(store.getXPipelineFeedItem("root-a", db).translation, null);
});

test("an older quoted revision cannot remove current media and partial context only adds unique media", (t) => {
  const db = database(t);
  const second = { ...media[0], previewUrl: "https://example.com/second.jpg" };
  const third = { ...media[0], previewUrl: "https://example.com/third.jpg" };
  const full = quote({ text: "Current complete quoted original statement.", media: [...media, second],
    contentSource: "owned-reader", contentComplete: true, contentVersion: "2" });
  write(db, item({ id: "root-a", quotedTweet: full }));
  write(db, item({ id: "root-b", quotedTweet: { ...full, text: "Earlier quoted original statement.", media, contentVersion: "1" } }));
  assert.deepEqual(store.getXPipelineQuotedTweet("222", db).media, [...media, second]);
  assert.deepEqual(store.getXPipelineFeedItem("root-b", db).quotedTweet.media, [...media, second]);
  write(db, item({ id: "root-c", quotedTweet: { ...full, text: "Current complete...", media: [media[0], third],
    contentSource: "monitor985", contentComplete: false, contentVersion: undefined } }));
  assert.deepEqual(store.getXPipelineQuotedTweet("222", db).media, [...media, second, third]);
  assert.deepEqual(store.getXPipelineFeedItem("root-c", db).quotedTweet.media, [...media, second, third]);
  write(db, item({ id: "root-d", quotedTweet: { ...full, text: "A newer corrected claim.", media: [third], contentVersion: "3", translation: null } }));
  assert.deepEqual(store.getXPipelineQuotedTweet("222", db).media, [third]);
});

test("explicit newer revision permits shorter text and invalidates only changed translations", (t) => {
  const db = database(t); write(db, item({ contentVersion: "2026-10-04T00:02:00Z" }));
  write(db, item({ text: "Corrected statement.", translation: null, contentVersion: "2026-10-04T00:03:00Z" }));
  const result = store.getXPipelineFeedItem("111", db);
  assert.equal(result.text, "Corrected statement.");
  assert.equal(result.translation, null);
  assert.deepEqual(result.quotedTweet.translation, translation());
  write(db, item({ contentVersion: "2026-10-04T00:02:00Z" }));
  assert.equal(store.getXPipelineFeedItem("111", db).text, "Corrected statement.");
});

test("unproven changed owned text cannot downgrade an existing complete revision", (t) => {
  const db = database(t); write(db, item());
  write(db, item({ text: "Unproven changed statement.", translation: translation("不应写入的旧译文") }));
  assert.equal(store.getXPipelineFeedItem("111", db).text, item().text);
});

test("changed originals invalidate carried-forward translations for body and quoted text", (t) => {
  const db = database(t); write(db, item({ contentVersion: "1" }));
  write(db, item({ text: "Edited main statement.", contentVersion: "2",
    quotedTweet: quote({ text: "Edited quoted statement." }) }));
  const result = store.getXPipelineFeedItem("111", db);
  assert.equal(result.translation, null);
  assert.equal(result.quotedTweet.translation, null);
});

test("old feed translation cannot regress a newer original in the shared quote cache", (t) => {
  const db = database(t); const original = item({ translation: null, quotedTweet: quote({ translation: null }) }); write(db, original);
  store.upsertXPipelineQuotedTweet(quote({ text: "The latest quoted original has changed.", translation: null }), db);
  assert.equal(store.setXPipelineFeedTranslation("111", translation(), db, quote(), { text: original.text, quotedTweet: original.quotedTweet }), false);
  assert.equal(store.getXPipelineQuotedTweet("222", db).text, "The latest quoted original has changed.");
  assert.equal(store.getXPipelineQuotedTweet("222", db).translation, null);
  assert.equal(store.getXPipelineFeedItem("111", db).quotedTweet.text, "The latest quoted original has changed.");
});

test("985 wins equal completeness while full owned enrichment beats partial 985", (t) => {
  const db = database(t);
  const monitored = item({ text: "Complete monitored original.", contentSource: "monitor985", contentComplete: true, queryLabel: "985monitor / NEW_TWEET" });
  write(db, monitored); write(db, item());
  assert.equal(store.getXPipelineFeedItem("111", db).text, monitored.text);
  write(db, item({ id: "333", text: "Brief...", contentSource: "monitor985", contentComplete: false }));
  write(db, item({ id: "333" }));
  assert.equal(store.getXPipelineFeedItem("333", db).text, item().text);
});

test("both sources retain independent first and last observations despite content precedence", (t) => {
  const db = database(t); write(db, item());
  write(db, item({ contentSource: "monitor985", contentComplete: false, queryLabel: "985monitor / NEW_TWEET", text: "Brief..." }));
  const rows = db.prepare("select * from x_feed_observations where tweet_id = ? order by source").all("111");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.source, row.author_username, row.content_complete]), [["monitor985", "Owner", 0], ["owned-reader", "Owner", 1]]);
  const first = rows.find((row) => row.source === "monitor985").first_seen_at;
  db.prepare("update x_feed_observations set last_seen_at = ? where tweet_id = ? and source = ?").run("2020-01-01T00:00:00Z", "111", "monitor985");
  write(db, item({ contentSource: "monitor985", contentComplete: false, queryLabel: "985monitor / NEW_TWEET" }));
  const seen = db.prepare("select * from x_feed_observations where tweet_id = ? and source = ?").get("111", "monitor985");
  assert.equal(seen.first_seen_at, first); assert.notEqual(seen.last_seen_at, "2020-01-01T00:00:00Z");
});

test("translation CAS refuses a changed main text and leaves quote cache unchanged", (t) => {
  const db = database(t); const original = item({ translation: null, quotedTweet: quote({ translation: null }), contentVersion: "1" }); write(db, original);
  write(db, item({ text: "Edited original statement.", translation: null, quotedTweet: quote({ translation: null }), contentVersion: "2" }));
  assert.equal(store.setXPipelineFeedTranslation("111", translation(), db, quote(), { text: original.text, quotedTweet: original.quotedTweet }), false);
  assert.equal(store.getXPipelineFeedItem("111", db).translation, null);
  assert.equal(store.getXPipelineQuotedTweet("222", db).translation, null);
});

test("translation CAS refuses a changed quote even when the main text is unchanged", (t) => {
  const db = database(t); const original = item({ translation: null, quotedTweet: quote({ translation: null }) }); write(db, original);
  write(db, item({ translation: null, quotedTweet: quote({ id: "444", text: "New quoted statement.", translation: null }) }));
  assert.equal(store.setXPipelineFeedTranslation("111", translation(), db, quote(), { text: original.text, quotedTweet: original.quotedTweet }), false);
  assert.equal(store.getXPipelineFeedItem("111", db).quotedTweet.id, "444");
  assert.equal(store.getXPipelineQuotedTweet("222", db).translation, null);
});

test("translation CAS succeeds on unchanged originals and retains quote media", (t) => {
  const db = database(t); const original = item({ translation: null, quotedTweet: quote({ translation: null }) }); write(db, original);
  assert.equal(store.setXPipelineFeedTranslation("111", translation(), db, quote({ media: [] }), { text: original.text, quotedTweet: original.quotedTweet }), true);
  assert.deepEqual(store.getXPipelineFeedItem("111", db).translation, translation());
  assert.deepEqual(store.getXPipelineFeedItem("111", db).quotedTweet.media, media);
});

test("SQLite translation lease gives exactly one connection ownership and survives wrong-owner release", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "x-translation-lease-")); const path = join(dir, "feed.sqlite");
  const db1 = store.openXPipelineDb(path); const db2 = store.openXPipelineDb(path);
  t.after(() => { db1.close(); db2.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(store.acquireXPipelineTranslationLease("111", "process-a", { db: db1, nowMs: 1000, ttlMs: 100 }), true);
  assert.equal(store.acquireXPipelineTranslationLease("111", "process-b", { db: db2, nowMs: 1001, ttlMs: 100 }), false);
  assert.equal(store.releaseXPipelineTranslationLease("111", "process-b", db2), false);
  assert.equal(store.acquireXPipelineTranslationLease("111", "process-b", { db: db2, nowMs: 1099, ttlMs: 100 }), false);
  assert.equal(store.acquireXPipelineTranslationLease("111", "process-b", { db: db2, nowMs: 1100, ttlMs: 100 }), true);
  assert.equal(store.releaseXPipelineTranslationLease("111", "process-a", db1), false);
  assert.equal(store.releaseXPipelineTranslationLease("111", "process-b", db2), true);
});
