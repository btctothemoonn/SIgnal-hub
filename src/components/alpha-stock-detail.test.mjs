import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-stock-detail.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /dataQualityLabel/);
assert.match(source, /providerTrace/);
assert.match(source, /buildStocksIntelligence/);
assert.match(source, /buildSubscriptionReportInsight/);
assert.match(source, /tickerContext/);
assert.match(source, /earningsBrief/);
assert.match(source, /riskTags/);
assert.match(source, /structure/);
assert.match(source, /stock\.companyNameZh/);
assert.match(source, /marketDataLoading/);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);
assert.match(source, /Ticker Intelligence/);
assert.match(source, /Impact & Risk Tags/);
assert.match(source, /Structure Snapshot/);
assert.match(source, /研究结论/);
assert.match(source, /今日催化/);
assert.match(source, /财报复盘/);
assert.match(source, /主线验证/);
assert.match(source, /接下来盯什么/);
assert.match(source, /visibleCatalysts/);
assert.match(source, /visibleCatalysts\.map\(\(catalyst,\s*catalystIndex\)/);
assert.match(source, /hiddenCatalysts\.map\(\(catalyst,\s*catalystIndex\)/);
assert.match(source, /catalystIndex/);
assert.match(source, /splitStocksCatalystsForDisplay\(stock\.catalysts,\s*5\)/);
assert.match(source, /<details/);
assert.doesNotMatch(source, /Priority \{stock\.priority\}/);
assert.doesNotMatch(source, /sessionLabel/);
assert.doesNotMatch(source, /CandlestickChart/);
assert.doesNotMatch(source, /candles3d/);

console.log("ok - alpha stock detail research review UI");
