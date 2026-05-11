import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-sector-list.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /<aside className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:top-\[11\.75rem\][^"]*"/);
assert.match(source, /<aside className="[^"]*lg:self-start[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:max-h-\[calc\(100vh-12\.5rem\)\][^"]*"/);
assert.match(source, /<aside className="[^"]*lg:overflow-y-auto[^"]*"/);
assert.match(source, /marketDataLoading/);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);

console.log("ok - alpha sector list sticky layout");
