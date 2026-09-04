import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-hynix-premium-curve.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /币安海力士溢价曲线/);
assert.match(source, /type StocksHynixPremiumCurveProps =/);
assert.match(source, /compactByDefault\?: boolean/);
assert.match(source, /useState\(!compactByDefault\)/);
assert.match(source, /aria-expanded=\{expanded\}/);
assert.match(source, /展开图表/);
assert.match(source, /收起图表/);
assert.match(source, /SKHYUSDT/);
assert.match(source, /PREMIUM_INTERVAL_OPTIONS/);
assert.match(source, /\{ value: "1m",/);
assert.match(source, /useState<BinanceHynixPremiumInterval>\("1m"\)/);
assert.match(source, /5m/);
assert.match(source, /1h/);
assert.match(source, /1d/);
assert.match(source, /UTC\+8/);
assert.match(source, /2026-07-14/);
assert.match(source, /formatShanghaiChartTime/);
assert.match(source, /tickMarkFormatter/);
assert.match(source, /timeFormatter/);
assert.match(source, /SKHYNIXUSDT/);
assert.match(source, /SKHYUSDT \* 10 \/ SKHYNIXUSDT/);
assert.match(source, /selectedInterval\} K 线/);
assert.match(source, /5分钟/);
assert.match(source, /selectedInterval === "5m" \? "最近5天"/);
assert.match(source, /1小时/);
assert.match(source, /1天/);
assert.match(source, /\/api\/stocks-hynix-premium/);
assert.match(source, /interval=\$\{selectedInterval\}/);
assert.match(source, /getBinanceHynixPremiumStartTimeMs\(selectedInterval\)/);
assert.match(source, /startTime=\$\{startTime\}/);
assert.match(source, /\/api\/stocks-hynix-funding/);
assert.match(source, /资金费/);
assert.match(source, /溢价回归套利/);
assert.match(source, /HYNIX_PREMIUM_ALERT_DEFAULT_SETTINGS/);
assert.match(source, /PREMIUM_ALERT_SETTINGS_POLL_MS/);
assert.match(source, /fetch\("\/api\/settings"/);
assert.doesNotMatch(source, /STOCKS_HYNIX_PREMIUM_ALERT_ENABLED_CACHE_KEY/);
assert.match(source, /role="switch"/);
assert.match(source, /aria-checked=\{premiumAlertEnabled\}/);
assert.match(source, /预警阈值/);
assert.match(source, /type="number"/);
assert.match(source, /step="0\.1"/);
assert.match(source, /hynixPremiumAlert\.set/);
assert.match(source, /premiumAlertThresholdPct/);
assert.match(source, /premiumAlertThresholdRef/);
assert.doesNotMatch(
  source,
  /\[premiumAlertThresholdPct, selectedInterval, writeCachedSnapshot\]/,
);
assert.doesNotMatch(
  source,
  /snapshot\?\.websocket\?\.url,\s*premiumAlertThresholdPct,\s*selectedInterval/,
);
assert.match(source, /role="alertdialog"/);
assert.match(source, /aria-modal="true"/);
assert.match(source, /shouldShowHynixPremiumAlert/);
assert.match(source, /dismissHynixPremiumAlertCycle/);
assert.match(source, /new WebSocket/);
assert.match(source, /websocket\?\.url/);
assert.match(source, /parseBinanceFuturesWebSocketMessage/);
assert.match(source, /STOCKS_HYNIX_PREMIUM_CACHE_KEY/);
assert.match(source, /signal-hub:stocks:hynix-premium:v4/);
assert.match(source, /STOCKS_HYNIX_PREMIUM_INTERVAL_CACHE_KEY/);
assert.match(source, /signal-hub:stocks:hynix-premium:selected-interval:v1/);
assert.match(source, /compactBinanceHynixPremiumSnapshot/);
assert.match(source, /restoreBinanceHynixPremiumSnapshot/);
assert.match(source, /!\("v" in cachedSnapshotValue\)/);
assert.match(source, /writeCachedSelectedInterval\(option\.value\)/);
assert.match(
  source,
  /writeCachedSnapshot\(snapshot\);\s*writeCachedSelectedInterval\(selectedInterval\);/,
);
assert.match(source, /useBrowserJsonCache<BinanceHynixFundingSnapshot>/);
assert.match(source, /window\.setInterval\(loadPremiumData,\s*60 \* 1000\)/);
assert.match(
  source,
  /if \(snapshot\.points\.length > 1\) \{\s*setLiveSnapshot\(snapshot\)/,
);
assert.match(source, /premiumPct/);
assert.match(source, /basePrice/);
assert.match(source, /benchmarkPrice/);
assert.match(source, /lightweight-charts/);
assert.match(source, /createChart/);
assert.match(source, /CandlestickSeries/);
assert.match(source, /HistogramSeries/);
assert.match(source, /fitContent\(\)/);
assert.match(source, /ResizeObserver/);
assert.match(source, /expanded \? "min-h-\[32rem\]" : "min-h-0"/);
assert.doesNotMatch(source, /<svg/);
assert.doesNotMatch(source, /polyline/);

console.log("ok - stocks hynix premium curve");
