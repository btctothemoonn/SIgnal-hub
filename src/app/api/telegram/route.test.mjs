import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const feedLimit = getSignalFeedRangeLimit\(range,\s*"telegram"\)/,
);
assert.match(
  source,
  /getTelegramPipelineSnapshot\(feedLimit,[\s\S]*?since: getSignalFeedRangeSince\(range\)/,
);
assert.match(
  source,
  /prepareTelegramSnapshotForClient\([\s\S]*?\{\s*feedLimit\s*\},?\s*\)/,
);

console.log("ok - telegram range limit reaches the client snapshot");
