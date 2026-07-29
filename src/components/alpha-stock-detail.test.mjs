import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-stock-detail.tsx", import.meta.url),
  "utf8",
);

const primaryMetricsMatch = source.match(
  /const primaryIntelligenceMetrics = \[([\s\S]*?)\];/,
);
assert.ok(primaryMetricsMatch, "primary intelligence metrics must be explicit");
const primaryMetrics = primaryMetricsMatch[1];
const primaryContextIndex = source.indexOf("data-stock-primary-context");
const intelligenceIndex = source.indexOf("data-stock-intelligence");
const supportingResearchIndex = source.indexOf(
  "data-stock-supporting-research",
);

assert.ok(primaryContextIndex >= 0, "primary stock context must exist");
assert.ok(
  primaryContextIndex < intelligenceIndex &&
    intelligenceIndex < supportingResearchIndex,
  "primary context and intelligence must precede supporting research",
);
assert.match(primaryMetrics, /tickerContext\.dataHealth/);
assert.doesNotMatch(
  primaryMetrics,
  /tickerContext\.(price|dayMove|sevenDay|earningsWindow)/,
  "price, move, strength, and earnings must render only in the top tiles",
);
assert.match(
  source,
  /note=\{stock\.financialSnapshot\.nextEarningsDate \|\| "n\/a"\}/,
  "missing earnings dates must retain the n/a fallback",
);

assert.match(source, /dataQualityLabel/);
assert.match(source, /providerTrace/);
assert.match(source, /buildStocksIntelligence/);
assert.match(source, /buildSubscriptionReportInsight/);
assert.match(source, /data-stock-intelligence/);
assert.match(source, /data-stock-primary-context/);
assert.match(source, /data-stock-supporting-research/);
assert.match(source, /tickerContext/);
assert.match(source, /earningsBrief/);
assert.match(source, /riskTags/);
assert.match(source, /structure/);
assert.match(source, /stock\.companyNameZh/);
assert.match(source, /marketDataLoading/);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);
assert.match(source, /Ticker Intelligence/);
assert.match(source, /<StocksResearchStatePanel/);
assert.match(source, /researchStateLoading/);
assert.match(source, /researchStateError/);
assert.match(source, /onSaveResearchState/);
assert.match(source, /getResearchStatePanelMode/);
assert.match(source, /研究状态暂不可用/);
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
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);

console.log("ok - alpha stock detail research review UI");
