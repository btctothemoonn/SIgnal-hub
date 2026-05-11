import assert from "node:assert/strict";

const { buildSignalSourceStats } = await import("./signal-source-stats.ts");

const stats = buildSignalSourceStats({
  telegram: {
    channels: [{ ref: "@alpha" }, { ref: "@beta" }],
    feed: [{ id: "tg-1" }, { id: "tg-2" }, { id: "tg-3" }],
    status: "live",
  },
  x: {
    feed: [
      { id: "x-1", username: "lookonchain" },
      { id: "m985-1", username: "ai_9684xtpa", queryLabel: "985monitor / NEW_TWEET" },
      { id: "truth-1", username: "truth:realDonaldTrump" },
      { id: "x-2", username: "Web3Feng" },
      { id: "truth-2", username: "truth:realDonaldTrump" },
    ],
    status: "live",
  },
});

assert.deepEqual(stats, {
  telegramChannels: 2,
  telegramItems: 3,
  xItems: 2,
  monitor985Items: 1,
  truthItems: 2,
  telegramStatus: "在线",
  xStatus: "在线",
  truthStatus: "在线",
});

console.log("ok - signal source stats split x and truth counts");
