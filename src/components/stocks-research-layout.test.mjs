import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync(
  new URL("./stocks-research-layout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("./alpha-research-page.tsx", import.meta.url),
  "utf8",
);

assert.match(layout, /type StocksMobilePanel = "pool" \| "chart" \| "detail"/);
assert.match(layout, /useState<StocksMobilePanel>\("pool"\)/);
assert.match(layout, /data-stocks-desktop-layout/);
assert.match(layout, /data-mobile-stocks-pager/);
assert.match(layout, /mobileScrollerRef/);
assert.match(layout, /snap-x snap-mandatory/);
assert.match(layout, /onScroll=\{handleMobileScroll\}/);
assert.match(layout, /aria-pressed=\{activeMobilePanel === panel\.id\}/);
assert.match(layout, /lg:grid-cols-\[minmax\(22rem,24rem\)_minmax\(0,1fr\)\]/);
assert.match(layout, /xl:grid-cols-\[minmax\(25rem,28rem\)_minmax\(0,1fr\)\]/);
assert.match(layout, /2xl:grid-cols-\[minmax\(28rem,30rem\)_minmax\(0,1fr\)\]/);
assert.match(layout, /<AlphaSectorList/);
assert.match(layout, /<StocksPerformanceChart/);
assert.match(layout, /<AlphaStockDetail/);
assert.match(layout, /compact/);
assert.match(page, /import \{ StocksResearchLayout \}/);
assert.match(page, /<StocksResearchLayout/);
assert.doesNotMatch(page, /<AlphaResearchPool/);

console.log("ok - stocks research layout uses desktop split and mobile pager");
