import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./alpha-summary-card.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /const pollTimer = window\.setInterval/);
assert.doesNotMatch(source, /const generateTimer = window\.setInterval/);
assert.match(source, /method: force \? "POST" : "GET"/);
assert.match(source, /onClick=\{\(\) => void loadSummary\(true, scope\)\}/);

console.log("ok - browser polls summaries without scheduled force generation");
