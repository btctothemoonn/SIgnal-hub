import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-stock-detail.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /dataQualityLabel/);
assert.match(source, /providerTrace/);
assert.match(source, /stock\.companyNameZh/);
assert.match(source, /marketDataLoading/);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);
assert.match(source, /研究结论/);
assert.match(source, /今日催化/);
assert.match(source, /财报复盘/);
assert.match(source, /主线验证/);
assert.match(source, /接下来盯什么/);
assert.match(source, /visibleCatalysts/);
assert.match(source, /stock\.catalysts\.slice\(0,\s*5\)/);
assert.match(source, /<details/);
assert.doesNotMatch(source, /Priority \{stock\.priority\}/);
assert.doesNotMatch(source, /sessionLabel/);
assert.doesNotMatch(source, /CandlestickChart/);
assert.doesNotMatch(source, /candles3d/);

console.log("ok - alpha stock detail research review UI");
