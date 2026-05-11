import assert from "node:assert/strict";
import {
  getXHybridEffectiveLookbackMs,
  getXHybridRecoveryGapMs,
  getXHybridRecoveryLookbackMs,
  shouldKeepXHybridRecoveryWindow,
} from "./x-hybrid-recovery-window.ts";

const hourMs = 60 * 60_000;
const dayMs = 24 * hourMs;
const nowMs = Date.parse("2026-05-09T05:05:00.000Z");

assert.equal(getXHybridRecoveryLookbackMs({}), dayMs);
assert.equal(
  getXHybridRecoveryLookbackMs({ X_HYBRID_RECOVERY_LOOKBACK_MS: "7200000" }),
  2 * hourMs,
);
assert.equal(getXHybridRecoveryGapMs({}), 10 * 60_000);

assert.deepEqual(
  getXHybridEffectiveLookbackMs({
    normalLookbackMs: hourMs,
    recoveryLookbackMs: dayMs,
    recoveryGapMs: 10 * 60_000,
    lastTickFinishedAtMs: null,
    nowMs,
  }),
  { lookbackMs: dayMs, recovery: true },
);

assert.deepEqual(
  getXHybridEffectiveLookbackMs({
    normalLookbackMs: hourMs,
    recoveryLookbackMs: dayMs,
    recoveryGapMs: 10 * 60_000,
    lastTickFinishedAtMs: nowMs - 2 * 60_000,
    nowMs,
  }),
  { lookbackMs: hourMs, recovery: false },
);

assert.deepEqual(
  getXHybridEffectiveLookbackMs({
    normalLookbackMs: hourMs,
    recoveryLookbackMs: dayMs,
    recoveryGapMs: 10 * 60_000,
    lastTickFinishedAtMs: nowMs - 2 * hourMs,
    nowMs,
  }),
  { lookbackMs: dayMs, recovery: true },
);

assert.equal(
  shouldKeepXHybridRecoveryWindow({
    recovery: true,
    checkedRows: 5,
    batchLimit: 5,
  }),
  true,
);
assert.equal(
  shouldKeepXHybridRecoveryWindow({
    recovery: true,
    checkedRows: 4,
    batchLimit: 5,
  }),
  false,
);
assert.equal(
  shouldKeepXHybridRecoveryWindow({
    recovery: true,
    checkedRows: 0,
    batchLimit: 5,
    hasPendingBacklog: true,
  }),
  true,
);
assert.equal(
  shouldKeepXHybridRecoveryWindow({
    recovery: false,
    checkedRows: 5,
    batchLimit: 5,
  }),
  false,
);

console.log("ok - x hybrid recovery window expands after downtime");
