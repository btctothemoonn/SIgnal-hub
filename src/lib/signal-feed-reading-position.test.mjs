import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const {
  calculateSignalFeedScrollDelta,
  parseSignalFeedReadingAnchor,
} = await importTs("./signal-feed-reading-position.ts");

const savedAt = "2026-06-02T08:00:00.000Z";

assert.deepEqual(
  parseSignalFeedReadingAnchor(
    JSON.stringify({ itemId: "x:123", viewportTop: 184.5, savedAt }),
  ),
  { itemId: "x:123", viewportTop: 184.5, savedAt },
);
assert.equal(parseSignalFeedReadingAnchor(null), null);
assert.equal(parseSignalFeedReadingAnchor("{"), null);
assert.equal(
  parseSignalFeedReadingAnchor(
    JSON.stringify({ itemId: "", viewportTop: 184.5, savedAt }),
  ),
  null,
);
assert.equal(
  parseSignalFeedReadingAnchor(
    JSON.stringify({ itemId: "x:123", viewportTop: "184.5", savedAt }),
  ),
  null,
);
assert.equal(
  parseSignalFeedReadingAnchor(
    JSON.stringify({ itemId: "x:123", viewportTop: 184.5, savedAt: "invalid" }),
  ),
  null,
);

assert.equal(calculateSignalFeedScrollDelta(184.5, 344.5), 160);
assert.equal(calculateSignalFeedScrollDelta(184.5, 184.5), 0);
assert.equal(calculateSignalFeedScrollDelta(344.5, 184.5), -160);

console.log("ok - signal feed reading anchors validate and preserve viewport position");
