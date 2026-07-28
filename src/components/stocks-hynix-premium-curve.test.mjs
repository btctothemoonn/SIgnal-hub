import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-hynix-premium-curve.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /币安海力士溢价曲线/);
assert.match(source, /SKHYUSDT/);
assert.match(source, /SKHYNIXUSDT/);
assert.match(source, /SKHYUSDT \* 10 \/ SKHYNIXUSDT/);
assert.match(source, /5m K 线/);
assert.match(source, /\/api\/stocks-hynix-premium/);
assert.match(source, /STOCKS_HYNIX_PREMIUM_CACHE_KEY/);
assert.match(source, /useBrowserJsonCache<BinanceHynixPremiumSnapshot>/);
assert.match(source, /window\.setInterval\(loadPremiumData,\s*60 \* 1000\)/);
assert.match(source, /premiumPct/);
assert.match(source, /basePrice/);
assert.match(source, /benchmarkPrice/);
assert.match(source, /<svg/);
assert.match(source, /polyline/);

console.log("ok - stocks hynix premium curve");
