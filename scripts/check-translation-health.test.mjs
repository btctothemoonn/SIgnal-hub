import assert from "node:assert/strict";
import { summarizeWorker } from "./check-translation-health.mjs";

const failure = (reason) => ({ event: "minimax_translation_failure", model: "MiniMax-M3", failure: reason });
assert.deepEqual(
  summarizeWorker("monitor985", [
    { event: "x_translation_backfill", checked: 4, translated: 1, failed: 1, deferred: 2 },
    failure("unusable_output"), failure("timeout"),
    { event: "x_translation_backfill", checked: 3, translated: 2, failed: 0, deferred: 2 },
  ]),
  { translated: 3, failed: 2, failures: { unusable_output: 1, timeout: 1 }, backlog: 3 },
);
assert.deepEqual(
  summarizeWorker("x6551", [{ event: "x_6551_translation", translated: 1 }, { event: "x_6551_translation", translated: 0, superseded: 1 }]),
  { translated: 1, failed: 0, failures: {} },
);
assert.deepEqual(
  summarizeWorker("telegram", [{ event: "telegram_translation_backfilled", translated: 2, failed: 1 }, failure("unusable_output"), { event: "unrelated" }]),
  { translated: 2, failed: 1, failures: { unusable_output: 1 } },
);
console.log("ok - translation health check summarizes every translating worker");
