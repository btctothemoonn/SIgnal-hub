import assert from "node:assert/strict";
import { confirmXHybridPrimaryMisses } from "./x-hybrid-primary-refresh.ts";

const nowMs = Date.parse("2026-05-05T10:10:00.000Z");
const delayMs = 5 * 60_000;

function candidate(overrides = {}) {
  return {
    item: {
      sourceId: "telegram:1:1",
      tweetId: "tweet-1",
    },
    tweetId: "tweet-1",
    sourceCreatedAt: "2026-05-05T10:04:00.000Z",
    ...overrides,
  };
}

{
  let refreshes = 0;
  const existing = new Set();
  const result = await confirmXHybridPrimaryMisses({
    candidates: [candidate()],
    primaryCheckedAt: "2026-05-05T10:09:00.000Z",
    delayMs,
    nowMs,
    getExistingTweet: (tweetId) =>
      existing.has(tweetId) ? { id: tweetId, text: "from 985" } : null,
    refreshPrimary: async () => {
      refreshes += 1;
      existing.add("tweet-1");
      return {
        checkedAt: "2026-05-05T10:10:00.000Z",
        detail: "985 refreshed",
      };
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(result.refreshAttempted, true);
  assert.equal(result.ready.length, 0);
  assert.equal(result.skippedExisting.length, 1);
  assert.equal(result.pending.length, 0);
  assert.equal(result.skippedExisting[0].item.sourceId, "telegram:1:1");
}

{
  let refreshes = 0;
  const result = await confirmXHybridPrimaryMisses({
    candidates: [candidate()],
    primaryCheckedAt: "2026-05-05T10:09:00.000Z",
    delayMs,
    nowMs,
    getExistingTweet: () => null,
    refreshPrimary: async () => {
      refreshes += 1;
      return {
        checkedAt: "2026-05-05T10:10:00.000Z",
        detail: "985 refreshed",
      };
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(result.ready.length, 1);
  assert.equal(result.skippedExisting.length, 0);
  assert.equal(result.pending.length, 0);
}

{
  let refreshes = 0;
  const result = await confirmXHybridPrimaryMisses({
    candidates: [candidate()],
    primaryCheckedAt: "2026-05-05T10:09:00.000Z",
    delayMs,
    nowMs,
    getExistingTweet: () => null,
    refreshPrimary: async () => {
      refreshes += 1;
      throw new Error("985 unavailable");
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(result.refreshFailed, true);
  assert.equal(result.ready.length, 0);
  assert.equal(result.pending.length, 1);
  assert.match(result.failureDetail || "", /985 unavailable/);
}

{
  let refreshes = 0;
  const result = await confirmXHybridPrimaryMisses({
    candidates: [
      candidate({
        sourceCreatedAt: "2026-05-05T10:08:00.000Z",
      }),
    ],
    primaryCheckedAt: "2026-05-05T10:09:00.000Z",
    delayMs,
    nowMs,
    getExistingTweet: () => null,
    refreshPrimary: async () => {
      refreshes += 1;
      return { checkedAt: "2026-05-05T10:10:00.000Z" };
    },
  });

  assert.equal(refreshes, 0);
  assert.equal(result.refreshAttempted, false);
  assert.equal(result.ready.length, 0);
  assert.equal(result.pending.length, 1);
}

{
  let refreshes = 0;
  const result = await confirmXHybridPrimaryMisses({
    candidates: [candidate()],
    primaryCheckedAt: null,
    delayMs,
    nowMs,
    getExistingTweet: () => null,
    refreshPrimary: async () => {
      refreshes += 1;
      return {
        checkedAt: "2026-05-05T10:10:00.000Z",
        detail: "985 refreshed without previous proof",
      };
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(result.refreshAttempted, true);
  assert.equal(result.ready.length, 1);
  assert.equal(result.pending.length, 0);
}

console.log("ok - x hybrid confirms 985 miss before 6551 fallback");
