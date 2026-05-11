import assert from "node:assert/strict";
import { isFullTweetByIdCacheHit } from "./x-hybrid-tweet-cache.ts";

assert.equal(isFullTweetByIdCacheHit(null, "1"), false);
assert.equal(
  isFullTweetByIdCacheHit(
    {
      id: "1",
      text: "cached full tweet",
      queryLabel: "Telegram trigger / full",
    },
    "1",
  ),
  true,
);
assert.equal(
  isFullTweetByIdCacheHit(
    {
      id: "1",
      text: "fallback only",
      queryLabel: "Telegram trigger / fallback",
    },
    "1",
  ),
  false,
);
assert.equal(
  isFullTweetByIdCacheHit(
    {
      id: "2",
      text: "cached full tweet",
      queryLabel: "Telegram trigger / full",
    },
    "1",
  ),
  false,
);

console.log("ok - x hybrid tweet cache detects full tweet-id hits");
