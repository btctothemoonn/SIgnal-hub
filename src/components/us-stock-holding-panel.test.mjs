import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./us-stock-holding-panel.tsx", import.meta.url),
  "utf8",
);
const positionBriefCellSource = source.slice(
  source.indexOf("function PositionBriefCell"),
  source.indexOf("function UsHoldingSummaryCell"),
);
const usHoldingSummaryCellSource = source.slice(
  source.indexOf("function UsHoldingSummaryCell"),
  source.indexOf("function positionLogoTone"),
);
const positionBriefPnlSource = source.slice(
  source.indexOf("function PositionBriefPnl"),
  source.indexOf("function PositionBriefCards"),
);
const positionLogoSource = source.slice(
  source.indexOf("function positionLogoTone"),
  source.indexOf("function PositionBriefPnl"),
);
const equityCurveSource = source.slice(
  source.indexOf("function EquityCurve"),
  source.indexOf("export function USStockHoldingPanel"),
);

assert.match(source, /USStockHoldingPanel/);
assert.match(source, /US_STOCK_HOLDING_SNAPSHOT/);
assert.match(source, /\/api\/holdings\/tiger/);
assert.match(source, /EquityCurve/);
assert.match(source, /PositionBriefCards/);
assert.match(source, /getUsStockHoldingBriefCards/);
assert.match(source, /function PositionBriefPnl/);
assert.match(source, /formatSignedPercent\(card\.unrealizedPnlPercent\)/);
assert.match(source, /data-us-holding-summary/);
assert.match(source, /data-us-position-card/);
assert.match(source, /getUsHoldingEquityMetric/);
assert.match(source, /isFiniteTigerHoldingSnapshot/);
assert.match(source, /label=\{equityMetric\.label\}/);
assert.match(equityCurveSource, /className="h-56 w-full overflow-hidden"/);
assert.match(equityCurveSource, /const padX = 48;/);
assert.match(equityCurveSource, /x2=\{width - padX\}/);
assert.match(
  equityCurveSource,
  /<text\s+x=\{width - 4\}\s+y=\{y \+ 4\}\s+textAnchor="end"[\s\S]*?\{formatCompactUsd\(value\)\.replace\("\+", ""\)\}/,
);
assert.doesNotMatch(equityCurveSource, /x=\{width - padX \+ 8\}/);
assert.doesNotMatch(
  positionLogoSource,
  /bg-gradient-|from-[a-z]|to-[a-z]/,
);
assert.doesNotMatch(positionBriefCellSource, /truncate|overflow-hidden|whitespace-nowrap/);
assert.match(positionBriefCellSource, /\[overflow-wrap:anywhere\]/);
assert.doesNotMatch(usHoldingSummaryCellSource, /truncate|overflow-hidden|whitespace-nowrap/);
assert.match(usHoldingSummaryCellSource, /\[overflow-wrap:anywhere\]/);
assert.doesNotMatch(positionBriefPnlSource, /truncate|overflow-hidden|whitespace-nowrap/);
assert.match(positionBriefPnlSource, /\[overflow-wrap:anywhere\]/);
assert.match(source, /持仓状况/);
assert.match(source, /最后更新/);
assert.match(source, /数据每 60 秒更新一次/);
assert.match(source, /function PositionLogo/);
assert.match(source, /xl:grid-cols-2/);
assert.doesNotMatch(source, /<OptionRiskStrip/);
assert.doesNotMatch(source, /<ThemeAllocation/);
assert.doesNotMatch(source, /主题暴露/);
assert.doesNotMatch(source, /<PositionTreemap/);
assert.doesNotMatch(source, /<HoldingDetailTable/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
assert.match(source, /window\.setTimeout\(\(\) => void loadTiger\(\), 0\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void loadTiger\(\)/);

console.log("ok - us stock holding panel tiger contract");
