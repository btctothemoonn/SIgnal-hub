import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-stock-detail.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /dataQualityLabel/);
assert.match(source, /providerTrace/);
assert.match(source, /数据链路/);
assert.match(source, /marketDataLoading/);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);
assert.doesNotMatch(source, /CandlestickChart/);
assert.doesNotMatch(source, /candles3d/);

console.log("ok - alpha stock detail market quality UI");
