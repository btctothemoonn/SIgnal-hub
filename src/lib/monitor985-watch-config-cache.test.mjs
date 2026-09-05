import assert from "node:assert/strict";
import { createMonitor985WatchConfigCache } from "./monitor985-watch-config-cache.ts";

let now = 0;
let calls = 0;
let failing = false;
const failures = [];
const cache = createMonitor985WatchConfigCache({
  now: () => now,
  load: async () => { calls += 1; if (failing) throw new Error("offline"); return [calls]; },
  onError: (error) => failures.push(error.message),
});
assert.deepEqual(await cache.get(), [1]);
now = 60_000;
assert.deepEqual(await cache.get(), [1]);
assert.equal(calls, 1);
now = 3_600_000;
assert.deepEqual(await cache.get(), [2]);
now += 3_600_000;
failing = true;
assert.deepEqual(await cache.get(), [2], "failure retains the previous watch list");
now += 60_000;
assert.deepEqual(await cache.get(), [2]);
assert.equal(calls, 3, "failed calls have a five-minute cooldown");
assert.deepEqual(failures, ["offline"]);
now += 4 * 60_000;
failing = false;
await Promise.all([cache.get(), cache.get()]);
assert.equal(calls, 4, "concurrent refreshes share one request");
console.log("ok - hourly watch configuration cache and bounded retry");
