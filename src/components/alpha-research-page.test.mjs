import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-research-page.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../app/stocks/page.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(pageSource, /statusPills=/);
assert.doesNotMatch(pageSource, /strongCount/);
assert.doesNotMatch(pageSource, /upcomingEarnings/);
assert.doesNotMatch(pageSource, /ALPHA_RESEARCH_STOCKS/);

assert.match(source, /<section className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<section className="[^"]*lg:top-\[5\.25rem\][^"]*"/);
assert.match(source, /<section className="[^"]*lg:z-30[^"]*"/);
assert.match(source, /<section className="[^"]*lg:backdrop-blur-xl[^"]*"/);
assert.match(source, /type AlphaTab = "research" \| "messages"/);
assert.match(source, /美股投研池/);
assert.match(source, /STOCKS 投研总结/);
assert.match(source, /StocksResearchLayout/);
assert.doesNotMatch(source, /StocksHynixPremiumCurve/);
assert.match(source, /StocksTodayChanges/);
assert.match(source, /AlphaSummaryCard/);
assert.match(source, /行情尝试接入 Yahoo，财报采用 FMP 标准化数据/);
assert.match(source, /data-stocks-workspace/);
assert.match(source, /data-stocks-chart-band/);
assert.match(source, /data-stocks-research-split/);
assert.match(source, /grid-cols-2/);
assert.match(source, /setActiveTab\("research"\)/);
assert.match(source, /\/api\/stocks-market-data/);
assert.match(source, /\/api\/stocks-financial-data/);
assert.match(source, /\/api\/stocks-performance\?tickers=/);
assert.match(source, /startDate=/);
assert.match(source, /format=compact/);
assert.match(source, /expandCompactStocksPerformanceSnapshot/);
assert.match(source, /scheduleDeferredBrowserTask/);
assert.match(source, /scheduleDeferredBrowserTask\(loadFinancialData/);
assert.match(source, /performanceTickersKey/);
assert.match(source, /activeSectorId=\{selectedSector\?\.id/);
assert.match(source, /onSelectSector=\{\(sectorId\) =>/);
assert.match(source, /setSelectedTicker\(sector\.tickers\[0\]\)/);
assert.match(source, /STOCKS_MARKET_SNAPSHOT_CACHE_KEY/);
assert.match(source, /useBrowserJsonCache/);
assert.match(source, /useBrowserJsonCache<StocksMarketSnapshot>\(STOCKS_MARKET_SNAPSHOT_CACHE_KEY\)/);
assert.match(source, /writeMarketSnapshotCache\(snapshot\)/);
assert.match(source, /useBrowserJsonCache<StocksFinancialSnapshot>/);
assert.match(source, /writeFinancialSnapshotCache\(snapshot\)/);
assert.match(source, /performanceSnapshotCacheKey\(performanceTickersKey\)/);
assert.match(source, /useBrowserJsonCache<StocksPerformanceSnapshot>\(performanceCacheKey\)/);
assert.match(source, /setLivePerformanceSnapshot\(\{ cacheKey, snapshot \}\)/);
assert.match(source, /writePerformanceSnapshotCache\(snapshot\)/);
assert.match(source, /livePerformanceSnapshot\?\.cacheKey === performanceCacheKey/);
assert.match(source, /hasPerformanceSeries\(snapshot\)/);
assert.match(source, /hasPerformanceSeries\(cachedPerformanceSnapshot\)/);
assert.match(source, /if \(hasPerformanceSeries\(snapshot\)\)/);
assert.match(source, /snapshotIssueLabel/);
assert.match(source, /isPerformanceCacheNotice/);
assert.match(source, /const activeErrors = \[/);
assert.match(source, /data-stocks-error-alert/);
assert.match(source, /new Set\(activeErrors\)/);
assert.match(
  source,
  /const stocks = useMemo\(\(\) => \{[\s\S]*?mergeStocksMarketSnapshot\([\s\S]*?ALPHA_RESEARCH_STOCKS,[\s\S]*?marketSnapshot,[\s\S]*?\)[\s\S]*?return mergeStocksFinancialSnapshot\(withMarket, financialSnapshot\);[\s\S]*?\}, \[financialSnapshot, marketSnapshot\]\);/,
);
assert.doesNotMatch(source, /订阅研报/);
assert.doesNotMatch(source, /StocksSubscriptionReports/);
assert.doesNotMatch(source, /buildStocksSubscriptionReports/);
assert.doesNotMatch(source, /\/api\/stocks-catalysts/);
assert.doesNotMatch(source, /\/api\/stocks-research-state/);
assert.doesNotMatch(source, /mergeStocksCatalystSnapshot/);
assert.doesNotMatch(source, /STOCKS_CATALYST_SNAPSHOT_CACHE_KEY/);
assert.doesNotMatch(source, /数据健康中心/);
assert.doesNotMatch(source, /researchStates/);
assert.doesNotMatch(source, /useState<StocksCatalystSnapshot/);
assert.doesNotMatch(source, /scheduleDeferredBrowserTask\(loadCatalystData/);
assert.doesNotMatch(source, /performanceIssueLabel/);
assert.doesNotMatch(source, /window\.localStorage\.getItem/);
assert.doesNotMatch(source, /window\.localStorage\.setItem/);

console.log("ok - alpha research page retained Stocks contract");
