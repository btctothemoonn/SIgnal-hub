import assert from "node:assert/strict";

const { classifyXFeedSource } = await import("./x-feed-source.ts");

assert.equal(
  classifyXFeedSource({
    username: "truth:realDonaldTrump",
    queryLabel: "985monitor / truth",
  }),
  "truth",
);

assert.equal(
  classifyXFeedSource({
    username: "ai_9684xtpa",
    queryLabel: "985monitor / NEW_TWEET",
  }),
  "monitor985",
);

assert.equal(
  classifyXFeedSource({
    username: "lookonchain",
    queryLabel: "Telegram trigger / full",
  }),
  "x",
);

console.log("ok - x feed source classification splits 985 and truth");
