import assert from "node:assert/strict";

const { nextWorkerDelay, waitFor } = await import("./market-alerts-worker-runtime.mjs");

assert.equal(nextWorkerDelay(60_000, 1_000, 4_000), 57_000);
assert.equal(nextWorkerDelay(60_000, 1_000, 62_000), 0);

function fakeSignal() {
  return {
    aborted: false,
    listener: null,
    added: 0,
    removed: 0,
    addEventListener(_type, listener) {
      this.listener = listener;
      this.added += 1;
    },
    removeEventListener(_type, listener) {
      if (this.listener === listener) this.listener = null;
      this.removed += 1;
    },
  };
}

const elapsedSignal = fakeSignal();
await waitFor(1, elapsedSignal);
assert.equal(elapsedSignal.added, 1);
assert.equal(elapsedSignal.removed, 1);

const abortedSignal = fakeSignal();
const abortedWait = waitFor(1_000, abortedSignal);
abortedSignal.aborted = true;
abortedSignal.listener();
await abortedWait;
assert.equal(abortedSignal.removed, 1);

console.log("ok - market workers keep start-to-start cadence");
