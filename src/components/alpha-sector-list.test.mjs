import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./alpha-sector-list.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-stocks-pool/);
assert.match(source, /className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /className="[^"]*lg:top-\[11\.75rem\][^"]*"/);
assert.match(source, /className="[^"]*lg:self-start[^"]*"/);
assert.match(source, /className="[^"]*lg:max-h-\[calc\(100vh-12\.5rem\)\][^"]*"/);
assert.match(source, /className="[^"]*lg:overflow-y-auto[^"]*"/);
assert.match(source, /marketDataLoading/);
assert.match(source, /companyNameZh/);
assert.match(
  source,
  /title=\{`\$\{stock\.companyNameZh\} . \$\{stock\.companyName\}`\}/,
);
assert.match(source, /行情加载中/);
assert.match(source, /stockPriceLabel/);
assert.doesNotMatch(source, /研究状态筛选/);
assert.doesNotMatch(source, /RESEARCH_STATUS_FILTERS/);
assert.doesNotMatch(source, /StocksResearchState/);

console.log("ok - alpha sector list sticky layout");
