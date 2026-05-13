import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-sector-list.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /grid-cols-\[3\.75rem_minmax\(8rem,1fr\)_5\.25rem\]/);
assert.match(source, /{stock\.companyNameZh}\s*<\/span>/);
assert.match(source, /{stock\.companyName}\s*<\/span>/);
assert.doesNotMatch(source, /{stock\.companyNameZh} 路 {stock\.companyName}/);

console.log("ok - alpha sector list keeps stock names readable in widened pool");
