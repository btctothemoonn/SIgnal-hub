import assert from "node:assert/strict";
import {
  initialSignalFeedRenderCount,
  nextSignalFeedRenderCount,
  signalFeedRenderCountForTarget,
} from "./signal-feed-render-window.ts";

assert.equal(initialSignalFeedRenderCount(0), 0);
assert.equal(initialSignalFeedRenderCount(12), 12);
assert.equal(initialSignalFeedRenderCount(200), 30);

assert.equal(nextSignalFeedRenderCount(30, 200), 60);
assert.equal(nextSignalFeedRenderCount(180, 200), 200);
assert.equal(nextSignalFeedRenderCount(200, 200), 200);

const items = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}` }));
assert.equal(signalFeedRenderCountForTarget(items, "item-74", 30), 75);
assert.equal(signalFeedRenderCountForTarget(items, "item-4", 30), 30);
assert.equal(signalFeedRenderCountForTarget(items, "missing", 30), 30);

console.log("ok - signal feed render window grows without hiding navigation targets");
