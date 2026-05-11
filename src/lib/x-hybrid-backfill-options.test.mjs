import assert from "node:assert/strict";

const {
  DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS,
  resolveXHybridBackfillLookbackHours,
  resolveXHybridBackfillLookbackMs,
} = await import("./x-hybrid-backfill-options.ts");

assert.equal(DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS, 24);
assert.equal(resolveXHybridBackfillLookbackHours({}), 24);
assert.equal(resolveXHybridBackfillLookbackHours({ lookbackHours: 6 }), 6);
assert.equal(resolveXHybridBackfillLookbackHours({ lookbackHours: "bad" }), 24);
assert.equal(resolveXHybridBackfillLookbackMs({}), 24 * 60 * 60_000);

console.log("ok - x hybrid backfill defaults to 24h");
