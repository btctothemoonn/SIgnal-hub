import assert from "node:assert/strict";
import {
  getMonitor985AccountSyncIntervalMs,
  shouldRefreshMonitor985Accounts,
} from "./monitor985-sync-policy.ts";

assert.equal(getMonitor985AccountSyncIntervalMs({}), 60 * 60 * 1000);
assert.equal(
  getMonitor985AccountSyncIntervalMs({
    MONITOR985_ACCOUNT_SYNC_INTERVAL_MS: "300000",
  }),
  300000,
);
assert.equal(
  getMonitor985AccountSyncIntervalMs({
    MONITOR985_ACCOUNT_SYNC_INTERVAL_MS: "0",
  }),
  60 * 60 * 1000,
);

assert.equal(
  shouldRefreshMonitor985Accounts({
    force: false,
    intervalMs: 60 * 60 * 1000,
    lastSyncedAtMs: null,
    nowMs: 1000,
  }),
  true,
);
assert.equal(
  shouldRefreshMonitor985Accounts({
    force: false,
    intervalMs: 60 * 60 * 1000,
    lastSyncedAtMs: 0,
    nowMs: 59 * 60 * 1000,
  }),
  false,
);
assert.equal(
  shouldRefreshMonitor985Accounts({
    force: false,
    intervalMs: 60 * 60 * 1000,
    lastSyncedAtMs: 0,
    nowMs: 60 * 60 * 1000,
  }),
  true,
);
assert.equal(
  shouldRefreshMonitor985Accounts({
    force: true,
    intervalMs: 60 * 60 * 1000,
    lastSyncedAtMs: 1000,
    nowMs: 2000,
  }),
  true,
);

console.log("ok - monitor985 account sync policy defaults to one hour");
