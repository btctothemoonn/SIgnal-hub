import assert from "node:assert/strict";
import {
  getXPipelineConfiguredAccounts,
  getXPipelineConfiguredTruthAccounts,
} from "./x-pipeline-accounts.ts";

const accounts = getXPipelineConfiguredAccounts(
  {
    twitterAccounts: [
      { ref: "@SpaceY", tags: ["alpha"] },
      { ref: "duplicate", tags: [] },
    ],
    telegramChannels: [],
  },
  {
    TWITTER_WATCH_USERNAMES: "duplicate, @Other\nSpaceY",
  },
);

assert.deepEqual(
  accounts.map((account) => account.username),
  ["SpaceY", "duplicate", "Other"],
);
assert.deepEqual(accounts[0].tags, ["alpha"]);
assert.equal(accounts[2].profileUrl, "https://x.com/Other");

const truthAccounts = getXPipelineConfiguredTruthAccounts({
  MONITOR985_TRUTH_ACCOUNTS: "realDonaldTrump, truth:@realDonaldTrump, @OtherTruth",
});
assert.deepEqual(
  truthAccounts.map((account) => account.username),
  ["truth:realDonaldTrump", "truth:OtherTruth"],
);
assert.equal(truthAccounts[0].name, "realDonaldTrump");
assert.equal(truthAccounts[0].profileUrl, "https://truthsocial.com/@realDonaldTrump");
assert.equal(truthAccounts[0].note, "985monitor truth config");

console.log("ok - x pipeline configured accounts are local-only and deduped");
