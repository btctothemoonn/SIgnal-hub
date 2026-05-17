import assert from "node:assert/strict";
import {
  DEFAULT_SIGNAL_FEED_RANGE,
  SIGNAL_FEED_RANGE_OPTIONS,
  getSignalFeedRangeLimit,
  getSignalFeedRangeSince,
  normalizeSignalFeedRange,
} from "./signal-feed-range.ts";

const now = new Date("2026-05-17T08:30:00.000Z");

assert.equal(DEFAULT_SIGNAL_FEED_RANGE, "latest");
assert.deepEqual(
  SIGNAL_FEED_RANGE_OPTIONS.map((option) => option.id),
  ["latest", "12h", "24h", "3d", "7d"],
);
assert.equal(normalizeSignalFeedRange("bad"), "latest");
assert.equal(normalizeSignalFeedRange("7D"), "7d");
assert.equal(getSignalFeedRangeSince("latest", now), null);
assert.equal(
  getSignalFeedRangeSince("12h", now),
  "2026-05-16T20:30:00.000Z",
);
assert.equal(
  getSignalFeedRangeSince("7d", now),
  "2026-05-10T08:30:00.000Z",
);
assert.equal(getSignalFeedRangeLimit("latest", "telegram"), 300);
assert.equal(getSignalFeedRangeLimit("latest", "x"), 200);
assert.equal(getSignalFeedRangeLimit("7d", "telegram"), 1000);
assert.equal(getSignalFeedRangeLimit("7d", "x"), 1000);
assert.equal(getSignalFeedRangeLimit("7d", "all"), 1000);

console.log("ok - signal feed range options");
