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
assert.match(layoutSource, /showHeaderMeta=\{false\}/);
assert.match(layoutSource, /minmax\(30rem,0\.88fr\)/);

console.log("ok - alpha summary card can hide low-value header metadata");
