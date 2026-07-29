import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-hynix-premium-curve.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /币安海力士溢价曲线/);
assert.match(source, /SKHYUSDT/);
assert.match(source, /PREMIUM_INTERVAL_OPTIONS/);
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
assert.match(source, /1小时/);
assert.match(source, /1天/);
assert.match(source, /\/api\/stocks-hynix-premium/);
assert.match(source, /interval=\$\{selectedInterval\}/);
assert.match(source, /startTime=\$\{BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS\}/);
assert.match(source, /\/api\/stocks-hynix-funding/);
assert.match(source, /资金费/);
assert.match(source, /溢价回归套利/);
assert.match(source, /HYNIX_PREMIUM_ALERT_THRESHOLD_PCT/);
assert.match(source, /role="alertdialog"/);
assert.match(source, /aria-modal="true"/);
assert.match(source, /shouldShowHynixPremiumAlert/);
assert.match(source, /dismissHynixPremiumAlertCycle/);
assert.match(source, /new WebSocket/);
assert.match(source, /websocket\?\.url/);
assert.match(source, /parseBinanceFuturesWebSocketMessage/);
assert.match(source, /STOCKS_HYNIX_PREMIUM_CACHE_KEY/);
assert.match(source, /signal-hub:stocks:hynix-premium:v4/);
assert.match(source, /useBrowserJsonCache<BinanceHynixPremiumSnapshot>/);
assert.match(source, /useBrowserJsonCache<BinanceHynixFundingSnapshot>/);
assert.match(source, /window\.setInterval\(loadPremiumData,\s*60 \* 1000\)/);
assert.match(source, /premiumPct/);
assert.match(source, /basePrice/);
assert.match(source, /benchmarkPrice/);
assert.match(source, /lightweight-charts/);
assert.match(source, /createChart/);
assert.match(source, /CandlestickSeries/);
assert.match(source, /HistogramSeries/);
assert.match(source, /fitContent\(\)/);
assert.match(source, /ResizeObserver/);
assert.doesNotMatch(source, /<svg/);
assert.doesNotMatch(source, /polyline/);

console.log("ok - stocks hynix premium curve");
