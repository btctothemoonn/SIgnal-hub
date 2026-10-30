import assert from "node:assert/strict";
import { enforceRebuildableStorageBudget, isRebuildableBrowserStorageKey } from "./browser-storage-budget.ts";

assert.equal(isRebuildableBrowserStorageKey("signal-hub:theme:cromojo-dark-dashboard:v1"), false);
assert.equal(isRebuildableBrowserStorageKey("signal-hub:signal-feed-reading-anchor"), false);
assert.equal(isRebuildableBrowserStorageKey("signal-hub:push-device:v1"), false);
assert.equal(isRebuildableBrowserStorageKey("unrelated-private-data"), false);
assert.equal(isRebuildableBrowserStorageKey("signal-hub:stocks:hynix-premium:v4:5m"), true);
assert.equal(isRebuildableBrowserStorageKey("signal-hub:stocks:hynix-premium:v5:5m"), false);

function storageFrom(seed) {
  const values = new Map(seed);
  const removed = [];
  return {
    values,
    removed,
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key); removed.push(key); },
  };
}

const storage = storageFrom([
  ["signal-hub:theme:cromojo-dark-dashboard:v1", "dark"],
  ["signal-hub:signal-feed-reading-anchor", "position"],
  ["signal-hub:push-device:v1", "device"],
  ["custom-unknown", "keep-me"],
  ["signal-hub:stocks:hynix-premium:v4:1m", "m".repeat(800)],
  ["signal-hub:stocks:hynix-premium:v4:5m", "f".repeat(900)],
  ["signal-hub.binance-holding-snapshot.v1", "h".repeat(700)],
]);
const removed = enforceRebuildableStorageBudget(storage, "signal-hub:stocks:performance-snapshot:v1:AAPL%2CMSFT", "n".repeat(500), 1200);
assert.deepEqual(removed, ["signal-hub:stocks:hynix-premium:v4:1m", "signal-hub:stocks:hynix-premium:v4:5m"]);
assert.equal(storage.values.get("signal-hub:theme:cromojo-dark-dashboard:v1"), "dark");
assert.equal(storage.values.get("signal-hub:signal-feed-reading-anchor"), "position");
assert.equal(storage.values.get("signal-hub:push-device:v1"), "device");
assert.equal(storage.values.get("custom-unknown"), "keep-me");
assert.equal(storage.values.has("signal-hub.binance-holding-snapshot.v1"), true);
assert.equal(enforceRebuildableStorageBudget(storage, "signal-hub:theme:cromojo-dark-dashboard:v1", "x".repeat(5000), 1200).length, 0);

console.log("ok - browser storage budget");
