import assert from "node:assert/strict";
import {
  ALPHA_RESEARCH_DEFAULT_TICKER,
  ALPHA_RESEARCH_SECTORS,
  ALPHA_RESEARCH_STOCKS,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
  getAlphaResearchSectorById,
  getAlphaResearchStocksForSector,
  getAlphaResearchStockByTicker,
  getDefaultAlphaResearchStock,
} from "./alpha-research-pool.ts";

const expectedTickers = [
  "NVDA",
  "TSM",
  "ASML",
  "AMD",
  "INTC",
  "AVGO",
  "LRCX",
  "DRAM",
  "MU",
  "WDC",
  "SNDK",
  "STX",
  "000660.KS",
  "005930.KS",
  "COHR",
  "LITE",
  "IPGP",
  "FN",
  "CIEN",
  "GLW",
  "MSFT",
  "AMZN",
  "GOOG",
  "ORCL",
  "NOW",
  "SNOW",
  "PLTR",
  "DELL",
  "VRT",
  "CLS",
  "CRWV",
  "NBIS",
];

assert.equal(ALPHA_RESEARCH_SECTORS.length, 5);
assert.deepEqual(ALPHA_RESEARCH_STOCK_UNIVERSE, expectedTickers);
assert.equal(ALPHA_RESEARCH_STOCKS.length, expectedTickers.length);
assert.equal(ALPHA_RESEARCH_DEFAULT_TICKER, "NVDA");
assert.equal(getDefaultAlphaResearchStock().ticker, "NVDA");
assert.equal(getAlphaResearchStockByTicker("nvda")?.ticker, "NVDA");
assert.equal(getAlphaResearchStockByTicker("missing"), null);

const intelStock = getAlphaResearchStockByTicker("INTC");
assert.ok(intelStock, "INTC profile missing");
assert.equal(intelStock.sectorId, "semiconductors");
assert.equal(intelStock.companyName, "Intel");
assert.equal(intelStock.priority, "B");
assert.ok(intelStock.businessTags.includes("CPU"));
assert.ok(intelStock.businessTags.includes("Foundry"));

const sectorIds = new Set(ALPHA_RESEARCH_SECTORS.map((sector) => sector.id));
const tickerSet = new Set();

for (const stock of ALPHA_RESEARCH_STOCKS) {
  assert.equal(tickerSet.has(stock.ticker), false, `${stock.ticker} duplicated`);
  tickerSet.add(stock.ticker);
  assert.equal(
    sectorIds.has(stock.sectorId),
    true,
    `${stock.ticker} sector missing`,
  );
  assert.ok(stock.companyName.length > 0, `${stock.ticker} companyName missing`);
  assert.ok(stock.businessTags.length > 0, `${stock.ticker} tags missing`);
  assert.ok(stock.summary.length > 0, `${stock.ticker} summary missing`);
  assert.ok(stock.catalysts.length > 0, `${stock.ticker} catalysts missing`);
  assert.ok(
    stock.financialReadthrough.length > 0,
    `${stock.ticker} readthrough missing`,
  );
  assert.ok(stock.thesis.length > 0, `${stock.ticker} thesis missing`);
  assert.ok(stock.watchPoints.length > 0, `${stock.ticker} watch points missing`);
  assert.ok(stock.risks.length > 0, `${stock.ticker} risks missing`);
  assert.equal(stock.candles3d.length, 3, `${stock.ticker} candles missing`);
  for (const candle of stock.candles3d) {
    assert.ok(candle.date.length > 0, `${stock.ticker} candle date missing`);
    assert.ok(candle.high >= candle.open, `${stock.ticker} high below open`);
    assert.ok(candle.high >= candle.close, `${stock.ticker} high below close`);
    assert.ok(candle.low <= candle.open, `${stock.ticker} low above open`);
    assert.ok(candle.low <= candle.close, `${stock.ticker} low above close`);
  }
  assert.equal(typeof stock.market.dayChangePct, "number");
  assert.equal(typeof stock.market.prePostChangePct, "number");
  assert.equal(typeof stock.market.sevenDayChangePct, "number");
  assert.ok(stock.financialSnapshot.revenue.length > 0);
  assert.ok(stock.financialSnapshot.nextEarningsDate.length > 0);
}

assert.equal(getAlphaResearchSectorById("optical")?.name, "光通信");
assert.equal(getAlphaResearchSectorById("missing"), null);
assert.deepEqual(
  getAlphaResearchStocksForSector("storage").map((stock) => stock.ticker),
  ["DRAM", "MU", "WDC", "SNDK", "STX", "000660.KS", "005930.KS"],
);
assert.deepEqual(
  ALPHA_RESEARCH_SECTORS.map((sector) => sector.id),
  ["semiconductors", "storage", "optical", "cloud-software", "data-center"],
);
assert.equal(getAlphaResearchStockByTicker("000660.ks")?.companyName, "SK hynix");
assert.equal(
  getAlphaResearchStockByTicker("dram")?.companyName,
  "Roundhill Memory ETF",
);
assert.equal(
  getAlphaResearchStockByTicker("005930.ks")?.companyName,
  "Samsung Electronics",
);

console.log("ok - alpha research pool data");
