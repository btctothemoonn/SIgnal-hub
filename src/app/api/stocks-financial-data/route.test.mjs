import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const financialSource = readFileSync(
  new URL("../../../lib/stocks-financial-data.ts", import.meta.url),
  "utf8",
);

assert.match(routeSource, /getCachedStocksFinancialSnapshot/);
assert.match(routeSource, /NextResponse\.json\(snapshot\)/);
assert.match(financialSource, /latestEarnings\?: StocksEarningsComparison \| null/);
assert.match(financialSource, /earningsInsight\?: StocksEarningsInsight \| null/);
assert.match(financialSource, /revenue: financial\.revenue/);
assert.match(financialSource, /eps: financial\.eps/);
assert.match(financialSource, /nextEarningsDate: financial\.nextEarningsDate/);

console.log("ok - stocks financial API compatibility");
