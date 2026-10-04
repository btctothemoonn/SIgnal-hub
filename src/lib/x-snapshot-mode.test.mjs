import assert from "node:assert/strict";
import { getXSnapshotMode, isXRestSnapshotMode } from "./x-snapshot-mode.ts";

assert.equal(getXSnapshotMode({}), "pipeline");
assert.equal(getXSnapshotMode({ X_API_MODE: "6551_rest" }), "pipeline");
assert.equal(getXSnapshotMode({ X_API_MODE: "rest", TWITTER_CONNECTOR_ENABLED: "false" }), "pipeline");
assert.equal(getXSnapshotMode({ X_API_MODE: "rest", TWITTER_CONNECTOR_ENABLED: "true" }), "6551_rest");
assert.equal(getXSnapshotMode({ X_API_MODE: "pipeline" }), "pipeline");
assert.equal(isXRestSnapshotMode({ X_API_MODE: "6551_rest", TWITTER_CONNECTOR_ENABLED: "true" }), true);
assert.equal(isXRestSnapshotMode({ X_API_MODE: "pipeline" }), false);

console.log("ok - x snapshot mode switches between pipeline and rest api");
