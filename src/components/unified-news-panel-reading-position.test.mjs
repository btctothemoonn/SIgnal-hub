import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./unified-news-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /signal-hub:signal-feed-reading-anchor/);
assert.match(source, /parseSignalFeedReadingAnchor/);
assert.match(source, /calculateSignalFeedScrollDelta/);
assert.match(source, /data-signal-feed-timeline/);
assert.match(source, /data-signal-feed-item-id=\{item\.id\}/);
assert.match(source, /captureVisibleReadingAnchor/);
assert.match(source, /stageReadingPositionCompensation/);
assert.match(source, /restoreStagedReadingPosition/);
assert.match(source, /returnToSavedReadingPosition/);
assert.match(source, /返回上次阅读/);
assert.match(source, /window\.localStorage\.setItem/);
assert.match(source, /window\.localStorage\.getItem/);
assert.match(source, /requestAnimationFrame/);

console.log("ok - unified news panel preserves and restores reading anchors");
