import assert from "node:assert/strict";
import { isMarketSnapshotStale } from "./market-snapshot-freshness.ts";

const nowMs = Date.parse("2026-10-30T08:00:00.000Z");
assert.equal(isMarketSnapshotStale("2026-10-30T07:59:00.000Z", nowMs), false);
assert.equal(isMarketSnapshotStale("2026-10-30T07:58:00.000Z", nowMs), true);
assert.equal(isMarketSnapshotStale(null, nowMs), true);
assert.equal(isMarketSnapshotStale("2026-10-30T08:00:30.000Z", nowMs), true);

console.log("ok - market snapshot freshness");
