import assert from "node:assert/strict";
import {
  monitor985AccountKey,
  resolveMonitor985AcceptedAccounts,
  shouldAcceptMonitor985Account,
} from "./monitor985-account-filter.ts";

const localAccounts = [
  {
    username: "bboczeng",
    name: "bboczeng",
    profileUrl: "https://x.com/bboczeng",
    avatar: "",
    note: "local config",
    tags: [],
  },
];
const truthAccounts = [
  {
    username: "truth:realDonaldTrump",
    name: "realDonaldTrump",
    profileUrl: "https://truthsocial.com/@realDonaldTrump",
    avatar: "",
    note: "truth config",
    tags: ["truth"],
  },
];
const remoteAccounts = [
  {
    username: "bboczeng",
    name: "bboczeng",
    profileUrl: "https://x.com/bboczeng",
    avatar: "",
    note: "985",
    tags: [],
  },
  {
    username: "PublicAdded",
    name: "PublicAdded",
    profileUrl: "https://x.com/PublicAdded",
    avatar: "",
    note: "985 public",
    tags: [],
  },
];

assert.equal(monitor985AccountKey("@_FORAB"), "_forab");

{
  const result = resolveMonitor985AcceptedAccounts({
    localAccounts,
    truthAccounts,
    remoteAccounts,
  });

  assert.deepEqual(
    result.accounts.map((account) => account.username),
    ["bboczeng", "truth:realDonaldTrump"],
  );
  assert.deepEqual(
    result.ignoredRemoteAccounts.map((account) => account.username),
    ["PublicAdded"],
  );
  assert.equal(result.allowedAccountKeys.has("bboczeng"), true);
  assert.equal(result.allowedAccountKeys.has("publicadded"), false);
}

{
  const allowed = new Set(["bboczeng"]);
  assert.equal(
    shouldAcceptMonitor985Account("bboczeng", allowed, {
      MONITOR985_FILTER_MODE: "all",
    }),
    true,
  );
  assert.equal(
    shouldAcceptMonitor985Account("PublicAdded", allowed, {
      MONITOR985_FILTER_MODE: "all",
    }),
    false,
  );
  assert.equal(
    shouldAcceptMonitor985Account("PublicAdded", allowed, {
      MONITOR985_FILTER_MODE: "all",
      MONITOR985_ALLOW_UNCONFIGURED_ACCOUNTS: "true",
    }),
    true,
  );
}

console.log("ok - monitor985 account filter keeps local site follows authoritative");
