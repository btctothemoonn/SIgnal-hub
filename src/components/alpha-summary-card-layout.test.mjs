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
assert.match(layoutSource, /showHeaderMeta=\{false\}/);

console.log("ok - alpha summary card can hide low-value header metadata");
