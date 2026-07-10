import assert from "node:assert/strict";
import { runAlphaSummarySingleFlight } from "./alpha-summary.ts";

let releaseFirst;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
let calls = 0;

const first = runAlphaSummarySingleFlight("signals:12h", async () => {
  calls += 1;
  await firstGate;
  return "signals";
});
const second = runAlphaSummarySingleFlight("signals:12h", async () => {
  calls += 1;
  return "duplicate";
});
const independent = runAlphaSummarySingleFlight("stocks:12h", async () => {
  calls += 1;
  return "stocks";
});

assert.equal(first, second);
assert.notEqual(first, independent);
assert.equal(calls, 2);
assert.equal(await independent, "stocks");

releaseFirst();
assert.equal(await first, "signals");
assert.equal(await second, "signals");

const afterCompletion = await runAlphaSummarySingleFlight(
  "signals:12h",
  async () => {
    calls += 1;
    return "fresh";
  },
);
assert.equal(afterCompletion, "fresh");
assert.equal(calls, 3);

console.log("ok - alpha summary generation is single-flight per audience and scope");
