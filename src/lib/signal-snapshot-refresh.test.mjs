import assert from "node:assert/strict";
import { shouldRefreshSignalSnapshotsOnEffect } from "./signal-snapshot-refresh.ts";
import * as refresh from "./signal-snapshot-refresh.ts";

assert.equal(shouldRefreshSignalSnapshotsOnEffect(null, "latest"), false);
assert.equal(shouldRefreshSignalSnapshotsOnEffect(null, "24h"), true);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("latest", "latest"), false);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("latest", "7d"), true);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("7d", "latest"), true);
assert.equal(typeof refresh.shouldReconcileSignalSnapshots, "function");
assert.equal(refresh.shouldReconcileSignalSnapshots({ streamsConnected: true, elapsedMs: 30_000 }), false);
assert.equal(refresh.shouldReconcileSignalSnapshots({ streamsConnected: true, elapsedMs: 300_000 }), true);
assert.equal(refresh.shouldReconcileSignalSnapshots({ streamsConnected: false, elapsedMs: 30_000 }), true);
assert.equal(refresh.shouldReconcileSignalSnapshots({ streamsConnected: false, elapsedMs: 10_000 }), false);

console.log("ok - initial signal snapshots remain authoritative until range changes");
