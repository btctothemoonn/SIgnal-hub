import assert from "node:assert/strict";
import { getXPipelineConfiguredAccounts } from "./x-pipeline-accounts.ts";

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

console.log("ok - x pipeline configured accounts are local-only and deduped");
