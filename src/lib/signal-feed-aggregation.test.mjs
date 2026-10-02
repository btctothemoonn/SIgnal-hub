import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateSignalFeed,
  canonicalSignalOriginalUrl,
  resolveSignalFeedRowId,
  signalFeedOriginalUrl,
  signalFeedUnreadMemberCount,
} from "./signal-feed-aggregation.ts";

function item(overrides = {}) {
  return { id: "x:1", text: "Analysis https://news.example/articles/one", link: "https://x.com/research/status/100", createdAt: "2026-10-02T01:00:00Z", quotedTweet: null, ...overrides };
}

test("status aliases identify the same original without merging different status IDs", () => {
  for (const url of ["https://x.com/alice/status/123?s=20", "http://twitter.com/bob/status/123", "https://mobile.twitter.com/i/web/status/123", "https://www.x.com/i/status/123/photo/1"]) {
    assert.equal(canonicalSignalOriginalUrl(url), "https://x.com/i/status/123");
  }
  assert.notEqual(canonicalSignalOriginalUrl("https://x.com/a/status/124"), canonicalSignalOriginalUrl("https://twitter.com/a/status/123"));
});

test("article keys remove tracking but preserve semantic query values, order, fragments, and protocols", () => {
  assert.equal(canonicalSignalOriginalUrl("https://NEWS.example/articles/one?utm_source=x&id=1&fbclid=abc#section"), "https://news.example/articles/one?id=1#section");
  const rows = aggregateSignalFeed([
    item(), item({ id: "x:2", text: "https://news.example/articles/one?utm_medium=social" }),
    item({ id: "x:3", text: "https://news.example/articles/one?id=2" }),
    item({ id: "x:4", text: "https://news.example/articles/two" }),
    item({ id: "x:5", text: "http://news.example/articles/one" }),
  ]);
  assert.deepEqual(rows.map((row) => row.members.map((member) => member.id)), [["x:1", "x:2"], ["x:3"], ["x:4"], ["x:5"]]);
  assert.notEqual(canonicalSignalOriginalUrl("https://news.example/a?a=1&b=2"), canonicalSignalOriginalUrl("https://news.example/a?b=2&a=1"));
});

test("generic channels, profiles, homepages, unsafe protocols and malformed queries cannot group stories", () => {
  for (const url of ["https://x.com/alice", "https://twitter.com/alice/likes", "https://t.me/alpha", "https://t.me/+invite", "https://news.example/", "https://news.example/profile/alice", "javascript:alert(1)", "ftp://news.example/a", "https://news.example/a?x=%ZZ", "https://news.example/a?%FF=value", "https://user:password@news.example/a", "https://t.co/opaque"]) {
    assert.equal(canonicalSignalOriginalUrl(url), null, url);
  }
  assert.equal(canonicalSignalOriginalUrl("https://t.me/s/Alpha/19?single"), "https://t.me/alpha/19");
  assert.equal(canonicalSignalOriginalUrl("https://telegram.me/c/123/19"), "https://t.me/c/123/19");
  assert.notEqual(canonicalSignalOriginalUrl("https://t.me/alpha/20"), canonicalSignalOriginalUrl("https://t.me/alpha/19"));
});

test("project and listing pages cannot merge unrelated stories while concrete permalinks remain usable", () => {
  for (const url of ["https://github.com/acme/protocol", "https://github.com/acme/protocol/issues", "https://github.com/acme", "https://news.example/category/crypto", "https://news.example/tags/sui", "https://news.example/search?q=sui", "https://docs.example/protocol", "https://protocol.example/docs/getting-started"]) {
    assert.equal(canonicalSignalOriginalUrl(url), null, url);
  }
  const rows = aggregateSignalFeed([
    item({ id: "x:launch", text: "New release https://github.com/acme/protocol", link: "https://x.com/acme/status/101" }),
    item({ id: "x:audit", text: "Security audit https://github.com/acme/protocol", link: "https://x.com/acme/status/102" }),
  ]);
  assert.equal(rows.length, 2);
  for (const url of ["https://github.com/acme/protocol/issues/123", "https://github.com/acme/protocol/commit/abcdef", "https://github.com/acme/protocol/releases/tag/v1.0", "https://news.example/articles/protocol-launch"]) {
    assert.equal(canonicalSignalOriginalUrl(url), url);
  }
});

test("multiple possible originals remain separate and quoted opinion is retained in its member", () => {
  const multi = item({ id: "x:multi", text: "Compare https://news.example/articles/one and https://news.example/articles/two" });
  assert.equal(signalFeedOriginalUrl(multi), null);
  const opinion = item({ id: "x:opinion", text: "I disagree with this interpretation", quotedTweet: { relation: "quote", link: "https://twitter.com/author/status/123", text: "A claim" }, translation: { text: "我不同意这一解读" } });
  const rows = aggregateSignalFeed([item({ id: "x:original", text: "A claim", link: "https://x.com/author/status/123" }), opinion, multi]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].members.map((member) => member.id), ["x:original", "x:opinion"]);
  assert.equal(rows[0].members[1].text, "I disagree with this interpretation");
  assert.equal(rows[0].members[1].translation.text, "我不同意这一解读");
  assert.equal(rows[0].members[1].quotedTweet.text, "A claim");
  assert.equal(signalFeedOriginalUrl(item({ text: "A reply", quotedTweet: { relation: "reply", link: "https://x.com/author/status/123" } })), "https://x.com/i/status/100");
});

test("a later copy keeps the group ID, representative, position, and legacy raw-anchor aliases", () => {
  const first = aggregateSignalFeed([item()]);
  const next = aggregateSignalFeed([item({ id: "telegram:new", createdAt: "2026-10-02T05:00:00Z", text: "New opinion https://news.example/articles/one" }), item()], first);
  assert.equal(next[0].id, first[0].id);
  assert.equal(next[0].representativeId, "x:1");
  assert.equal(next[0].createdAt, "2026-10-02T01:00:00Z");
  assert.equal(next[0].text, "Analysis https://news.example/articles/one");
  assert.equal(resolveSignalFeedRowId(next, "x:1"), next[0].id);
  assert.equal(resolveSignalFeedRowId(next, "telegram:new"), next[0].id);
  assert.equal(resolveSignalFeedRowId(next, first[0].id), next[0].id);
  assert.equal(resolveSignalFeedRowId(next, "missing"), "missing");
  const withOlderCopy = aggregateSignalFeed([item({ id: "telegram:older", createdAt: "2026-10-01T20:00:00Z" }), item()], first);
  assert.equal(withOlderCopy[0].representativeId, "x:1");
  assert.equal(withOlderCopy[0].createdAt, "2026-10-02T01:00:00Z");
});

test("read marks stay per member so an incoming copy makes a previously read group unread", () => {
  const read = new Set(["x:1"]);
  const rows = aggregateSignalFeed([item(), item({ id: "telegram:2" })]);
  assert.equal(signalFeedUnreadMemberCount(rows[0], read), 1);
  assert.equal(signalFeedUnreadMemberCount(rows[0], new Set(["x:1", "telegram:2"])), 0);
});

test("an original linked in a repost groups with the social original's own permalink", () => {
  const rows = aggregateSignalFeed([item({ text: "Original post", link: "https://twitter.com/a/status/456" }), item({ id: "telegram:2", text: "Commentary https://x.com/a/status/456?ref_src=twsrc", link: "https://t.me/channel/2" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].members.length, 2);
});
