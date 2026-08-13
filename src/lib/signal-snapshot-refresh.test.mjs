import assert from "node:assert/strict";
import { shouldRefreshSignalSnapshotsOnEffect } from "./signal-snapshot-refresh.ts";

assert.equal(shouldRefreshSignalSnapshotsOnEffect(null, "latest"), false);
assert.equal(shouldRefreshSignalSnapshotsOnEffect(null, "24h"), true);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("latest", "latest"), false);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("latest", "7d"), true);
assert.equal(shouldRefreshSignalSnapshotsOnEffect("7d", "latest"), true);

console.log("ok - initial signal snapshots remain authoritative until range changes");
