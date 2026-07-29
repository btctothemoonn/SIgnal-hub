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
assert.match(layout, /data-stocks-research-split/);
assert.match(layout, /data-mobile-stocks-pager/);
assert.match(layout, /mobileScrollerRef/);
assert.match(layout, /snap-x snap-mandatory/);
assert.match(layout, /onScroll=\{handleMobileScroll\}/);
assert.match(layout, /aria-pressed=\{activeMobilePanel === panel\.id\}/);
assert.match(layout, /lg:grid-cols-\[minmax\(18rem,0\.34fr\)_minmax\(0,0\.66fr\)\]/);
assert.doesNotMatch(layout, /xl:grid-cols-\[/);
assert.doesNotMatch(layout, /2xl:grid-cols-\[/);
assert.match(layout, /<AlphaSectorList/);
assert.match(layout, /<StocksPerformanceChart/);
assert.match(layout, /<AlphaStockDetail/);
assert.match(layout, /compact/);
assert.match(layout, /labelMode="ranked-list"/);
assert.match(layout, /researchStatusFilter/);
assert.match(layout, /researchStatesError/);
assert.match(page, /import \{ StocksResearchLayout \}/);
assert.match(page, /<StocksResearchLayout/);
assert.match(page, /researchStatesError=\{researchStatesError\}/);
assert.doesNotMatch(page, /<AlphaResearchPool/);

console.log("ok - stocks research layout uses desktop split and mobile pager");
