import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-performance-chart.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /今日相对涨跌幅/);
assert.match(source, /基准为今天第一条本地缓存价/);
assert.match(source, /aria-label="今日股票相对涨跌幅对比图"/);
assert.match(source, /formatSignedPercent\(item\.latestChangePct\)/);
assert.match(source, /viewBox="0 0 720 260"/);
assert.match(source, /sectors\.map/);
assert.match(source, /aria-pressed=\{selected\}/);
assert.match(source, /onSelectSector\(sector\.id\)/);
assert.match(source, /sector\.tickers\.join\(", "\)/);

console.log("ok - stocks performance chart UI");
