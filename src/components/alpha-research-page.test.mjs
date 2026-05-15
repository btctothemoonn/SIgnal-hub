import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-research-page.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /<section className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<section className="[^"]*lg:top-\[5\.25rem\][^"]*"/);
assert.match(source, /<section className="[^"]*lg:z-30[^"]*"/);
assert.match(source, /<section className="[^"]*lg:backdrop-blur-xl[^"]*"/);
assert.match(source, /StocksResearchLayout/);
assert.match(source, /StocksSubscriptionReports/);
assert.match(source, /buildStocksSubscriptionReports\(stocks\)/);
assert.match(source, /type AlphaTab = "research" \| "reports" \| "messages"/);
assert.match(source, /行情\/财报\/新闻优先，TG\/X 补充信号/);
assert.match(source, /订阅研报/);
assert.match(source, /setActiveTab\("research"\)/);
assert.match(source, /\/api\/stocks-performance\?tickers=/);
assert.match(source, /lookbackDays=7/);
assert.match(source, /performanceTickersKey/);
assert.match(source, /activeSectorId=\{selectedSector\?\.id/);
assert.match(source, /onSelectSector=\{\(sectorId\) =>/);
assert.match(source, /setSelectedTicker\(sector\.tickers\[0\]\)/);
assert.match(source, /STOCKS_MARKET_SNAPSHOT_CACHE_KEY/);
assert.match(source, /window\.localStorage\.getItem/);
assert.match(source, /window\.localStorage\.setItem/);
assert.match(source, /readCachedSnapshot<StocksMarketSnapshot>/);
assert.match(source, /writeCachedSnapshot\(STOCKS_MARKET_SNAPSHOT_CACHE_KEY, snapshot\)/);
assert.match(source, /readCachedSnapshot<StocksFinancialSnapshot>/);
assert.match(source, /writeCachedSnapshot\(STOCKS_FINANCIAL_SNAPSHOT_CACHE_KEY, snapshot\)/);
assert.match(source, /readCachedSnapshot<StocksCatalystSnapshot>/);
assert.match(source, /writeCachedSnapshot\(STOCKS_CATALYST_SNAPSHOT_CACHE_KEY, snapshot\)/);
assert.match(source, /performanceSnapshotCacheKey\(performanceTickersKey\)/);
assert.match(source, /writeCachedSnapshot\(cacheKey, snapshot\)/);
assert.match(source, /hasPerformanceSeries\(snapshot\)/);
assert.match(source, /hasPerformanceSeries\(cached\) \? cached : null/);
assert.match(source, /if \(hasPerformanceSeries\(snapshot\)\)/);
assert.match(source, /snapshotIssueLabel/);
assert.match(source, /部分源失败/);
assert.match(source, /已回落本地/);
assert.match(source, /setFinancialError\(null\)/);
assert.match(source, /setCatalystError\(null\)/);

console.log("ok - alpha research page sticky controls");
