import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cardSource = readFileSync(
  new URL("./alpha-summary-card.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("./signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);

assert.match(cardSource, /showHeaderMeta = true/);
assert.match(cardSource, /showHeaderMeta \? \(/);
assert.match(cardSource, /const summaryPeriodLabel =/);
assert.match(cardSource, /data-alpha-summary-period/);
assert.match(cardSource, /function AlphaSummaryScopeResult\(/);
assert.doesNotMatch(cardSource, /showHeaderMeta=\{showHeaderMeta\}/);
assert.match(cardSource, /showHeaderMeta \? \(/);
assert.doesNotMatch(cardSource, /scopeTabs: ReactNode/);
assert.doesNotMatch(cardSource, /scopeTabs,\n\s+showHeaderMeta/);
assert.doesNotMatch(cardSource, /scopeTabs=\{scopeTabs\}/);
assert.match(cardSource, /const scopeTabs = \(/);
assert.doesNotMatch(cardSource, /<section[\s\S]*?>\s*\{scopeTabs\}\s*<AlphaSummaryScopeResult/);
assert.match(
  cardSource,
  /<div className="border-b border-line\/60 bg-panel-strong\/72 px-4 py-3 sm:px-5">[\s\S]*\{scopeTabs\}[\s\S]*<\/div>\s*<AlphaSummaryScopeResult/,
);
assert.match(layoutSource, /showHeaderMeta=\{false\}/);
assert.match(layoutSource, /minmax\(30rem,0\.88fr\)/);

console.log("ok - alpha summary card can hide low-value header metadata");
