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
assert.match(source, /StocksPerformanceChart/);
assert.match(source, /\/api\/stocks-performance\?tickers=/);
assert.match(source, /performanceTickersKey/);
assert.match(source, /activeSectorId=\{selectedSector\?\.id/);
assert.match(source, /onSelectSector=\{\(sectorId\) =>/);
assert.match(source, /setSelectedTicker\(sector\.tickers\[0\]\)/);

console.log("ok - alpha research page sticky controls");
