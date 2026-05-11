import assert from "node:assert/strict";
import { getXSnapshotMode, isXRestSnapshotMode } from "./x-snapshot-mode.ts";

assert.equal(getXSnapshotMode({}), "pipeline");
assert.equal(getXSnapshotMode({ X_API_MODE: "6551_rest" }), "6551_rest");
assert.equal(getXSnapshotMode({ X_API_MODE: "rest" }), "6551_rest");
assert.equal(getXSnapshotMode({ X_API_MODE: "pipeline" }), "pipeline");
assert.equal(isXRestSnapshotMode({ X_API_MODE: "6551_rest" }), true);
assert.equal(isXRestSnapshotMode({ X_API_MODE: "pipeline" }), false);

console.log("ok - x snapshot mode switches between pipeline and rest api");
