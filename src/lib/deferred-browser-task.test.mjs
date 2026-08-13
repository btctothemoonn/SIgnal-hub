import assert from "node:assert/strict";
import { scheduleDeferredBrowserTask } from "./deferred-browser-task.ts";

let pendingTask = null;
let cancelledTask = null;
const host = {
  requestIdleCallback(callback) {
    pendingTask = callback;
    return 17;
  },
  cancelIdleCallback(id) {
    cancelledTask = id;
  },
  setTimeout() {
    throw new Error("idle callback should be preferred");
  },
  clearTimeout() {},
};

let calls = 0;
const cancel = scheduleDeferredBrowserTask(() => {
  calls += 1;
}, { host, timeoutMs: 250 });

assert.equal(typeof pendingTask, "function");
pendingTask();
assert.equal(calls, 1);
cancel();
assert.equal(cancelledTask, 17);

let fallbackTask = null;
const fallbackHost = {
  setTimeout(callback) {
    fallbackTask = callback;
    return 23;
  },
  clearTimeout(id) {
    cancelledTask = id;
  },
};

scheduleDeferredBrowserTask(() => {
  calls += 1;
}, { host: fallbackHost, timeoutMs: 250 });
fallbackTask();
assert.equal(calls, 2);

console.log("ok - deferred browser task supports idle and timer hosts");
