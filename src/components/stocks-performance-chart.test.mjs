import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-performance-chart.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /今日相对涨跌幅/);
assert.match(source, /基准为今天第一条本地缓存价/);
assert.match(source, /aria-label="今日股票相对涨跌幅对比图"/);
assert.match(source, /formatSignedPercent\(labelPoint\.changePct\)/);
assert.match(source, /viewBox="0 0 720 260"/);
assert.match(source, /sectors\.map/);
assert.match(source, /aria-pressed=\{selected\}/);
assert.match(source, /onSelectSector\(sector\.id\)/);
assert.match(source, /sector\.tickers\.join\(", "\)/);
assert.match(source, /useState<ZoomState>/);
assert.match(source, /handleWheelZoom/);
assert.match(source, /onWheel=\{handleWheelZoom\}/);
assert.match(source, /onPointerDown=\{handlePointerDown\}/);
assert.match(source, /onPointerMove=\{handlePointerMove\}/);
assert.match(source, /onDoubleClick=\{resetZoom\}/);
assert.match(source, /aria-label="Zoom in chart"/);
assert.match(source, /aria-label="Reset chart zoom"/);
assert.match(source, /formatAxisTime/);
assert.match(source, /hasMultipleMarketDates/);
assert.doesNotMatch(source, /segmentPointsByTradingSession/);
assert.match(source, /createTradingTimeAxis/);
assert.match(source, /timeIndexByMs/);
assert.match(source, /stock\.companyNameZh/);
assert.match(source, /visibleStartIndex/);
assert.match(source, /visibleEndIndex/);
assert.match(source, /axisIndexForCapturedAt/);
assert.match(source, /const visibleRangeKey =/);
assert.match(source, /setCurrentZoomRange\(FULL_ZOOM_RANGE\)/);
assert.match(source, /zoomState\.key === visibleRangeKey/);
assert.match(source, /setCurrentZoomRange/);

console.log("ok - stocks performance chart UI");
