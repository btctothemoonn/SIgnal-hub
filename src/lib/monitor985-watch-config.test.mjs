import assert from "node:assert/strict";
import {
  buildMonitor985FollowExtraBody,
  buildMonitor985UnfollowBody,
  parseMonitor985WatchConfig,
  toMonitor985XPipelineAccounts,
} from "./monitor985-watch-config.ts";

const parsed = parseMonitor985WatchConfig({
  config: {
    twitter: [
      {
        handle: "specteranalyst",
        displayName: "Specter",
        remark: "public pool",
        tags: ["macro"],
        source: "global",
      },
      {
        handle: "darkfarms1",
        displayName: "Darkfarms",
        source: "global",
      },
    ],
  },
  overlay: {
    twitter: {
      extraFollows: [
        {
          handle: "Web3Feng",
          displayName: "Web3Feng",
          remark: "Signal Hub",
          source: "user-extra",
        },
      ],
      unfollowed: ["darkfarms1"],
    },
  },
});

assert.deepEqual(
  parsed.effectiveTwitter.map((account) => account.handle),
  ["specteranalyst", "Web3Feng"],
);
assert.equal(parsed.effectiveTwitter[0].displayName, "Specter");
assert.equal(parsed.effectiveTwitter[0].remark, "public pool");
assert.equal(parsed.effectiveTwitter[0].source, "global");

const accounts = toMonitor985XPipelineAccounts(parsed);
assert.deepEqual(
  accounts.map((account) => account.username),
  ["specteranalyst", "Web3Feng"],
);
assert.equal(accounts[0].name, "Specter");
assert.equal(accounts[0].note, "985monitor / global / public pool");
assert.deepEqual(accounts[0].tags, ["macro"]);
assert.equal(accounts[1].note, "985monitor / user-extra / Signal Hub");

assert.deepEqual(buildMonitor985FollowExtraBody("@Web3Feng"), {
  alertSound: "",
  displayName: "Web3Feng",
  favorite: false,
  handle: "Web3Feng",
  remark: "Signal Hub",
  source: "twitter",
});

assert.deepEqual(buildMonitor985UnfollowBody("@Web3Feng"), {
  handle: "Web3Feng",
  source: "twitter",
});

console.log("ok - 985 watch config yields effective x accounts and sync bodies");
