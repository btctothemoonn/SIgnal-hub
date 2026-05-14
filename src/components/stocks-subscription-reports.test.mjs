import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-subscription-reports.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /订阅研报/);
assert.match(source, /Patreon \/ bboczeng/);
assert.match(source, /reports\.map/);
assert.match(source, /report\.tickers\.map/);
assert.match(source, /onSelectTicker\?\.\(ticker\)/);
assert.match(source, /打开原文/);
assert.match(source, /暂无订阅研报/);

console.log("ok - stocks subscription reports component");
