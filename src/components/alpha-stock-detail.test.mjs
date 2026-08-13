import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-stock-detail.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-stock-primary-context/);
assert.match(source, /研究结论/);
assert.match(source, /结构与财报/);
assert.match(source, /跟踪要点/);
assert.match(source, /Structure Snapshot/);
assert.match(source, /Earnings Brief/);
assert.match(source, /stock\.summary/);
assert.match(source, /stock\.thesis\.slice\(0, 2\)/);
assert.match(source, /compactTrackingPoints\(stock\)/);
assert.match(
  source,
  /<dd className="text-sm font-semibold text-foreground">\s*\{value\?\.trim\(\) \|\| "n\/a"\}\s*<\/dd>/,
  "empty financial values must use the required n/a display fallback",
);
assert.match(
  source,
  /note=\{stock\.financialSnapshot\.nextEarningsDate \|\| "n\/a"\}/,
  "missing earnings dates must retain the n/a fallback",
);

assert.doesNotMatch(source, /Ticker Intelligence/);
assert.doesNotMatch(source, /Impact & Risk Tags/);
assert.doesNotMatch(source, /StocksResearchStatePanel/);
assert.doesNotMatch(source, /订阅研报/);
assert.doesNotMatch(source, /今日催化/);
assert.doesNotMatch(source, /财报复盘/);
assert.doesNotMatch(source, /主线验证/);
assert.doesNotMatch(source, /splitStocksCatalystsForDisplay/);
assert.doesNotMatch(source, /buildSubscriptionReportInsight/);
assert.doesNotMatch(source, /stock\.catalysts/);
assert.doesNotMatch(source, /researchState/);
assert.doesNotMatch(source, /riskTags/);
assert.doesNotMatch(source, /data-stock-intelligence/);
assert.doesNotMatch(source, /data-stock-supporting-research/);
assert.doesNotMatch(source, /Priority \{stock\.priority\}/);
assert.doesNotMatch(source, /sessionLabel/);
assert.doesNotMatch(source, /CandlestickChart/);
assert.doesNotMatch(source, /candles3d/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);

console.log("ok - compact alpha stock detail UI");
