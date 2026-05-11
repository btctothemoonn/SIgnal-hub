import assert from "node:assert/strict";
import { resolveXHybrid985Gate } from "./x-hybrid-985-gate.ts";

const nowMs = Date.parse("2026-05-05T10:10:00.000Z");
const delayMs = 5 * 60_000;

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000000",
    existingTweet: { id: "1919300000000000000", text: "985 already has it" },
    sourceCreatedAt: "2026-05-05T10:04:00.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "skip-existing",
    detail: "tweet already present before 6551 fallback",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000000",
    existingTweet: {
      id: "1919300000000000000",
      text: "synthetic fallback text",
      queryLabel: "Telegram trigger / fallback",
    },
    sourceCreatedAt: "2026-05-05T10:04:00.000Z",
    primaryCheckedAt: "2026-05-05T10:10:00.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "enrich",
    detail: "985 refreshed after grace window; use 6551 tweet_by_id fallback",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000001",
    existingTweet: null,
    sourceCreatedAt: "2026-05-05T10:06:00.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "wait",
    detail: "waiting for 985 primary feed grace window",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000002",
    existingTweet: null,
    sourceCreatedAt: "2026-05-05T10:04:59.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "wait",
    detail: "waiting for 985 primary feed refresh proof",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000002",
    existingTweet: null,
    sourceCreatedAt: "2026-05-05T10:04:59.000Z",
    primaryCheckedAt: "2026-05-05T10:05:30.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "wait",
    detail: "waiting for 985 primary feed to refresh after grace window",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "1919300000000000002",
    existingTweet: null,
    sourceCreatedAt: "2026-05-05T10:04:59.000Z",
    primaryCheckedAt: "2026-05-05T10:10:00.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "enrich",
    detail: "985 refreshed after grace window; use 6551 tweet_by_id fallback",
  },
);

assert.deepEqual(
  resolveXHybrid985Gate({
    tweetId: "",
    existingTweet: null,
    sourceCreatedAt: "2026-05-05T10:04:00.000Z",
    nowMs,
    delayMs,
  }),
  {
    action: "enrich",
    detail: "no tweet id; gate does not apply",
  },
);

console.log("ok - x hybrid waits for 985 before spending 6551 points");
