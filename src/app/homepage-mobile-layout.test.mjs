import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const responsiveLayout = readFileSync(
  new URL("../components/signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);

assert.match(page, /import \{ SignalsResponsiveLayout \}/);
assert.match(page, /getXPipelineSnapshot\(0/);
assert.doesNotMatch(page, /getCached6551TwitterSnapshot/);
assert.match(page, /mainClassName="[^"]*min-h-0[^"]*"/);
assert.match(responsiveLayout, /data-mobile-signal-pager/);
assert.match(responsiveLayout, /snap-x snap-mandatory/);
assert.match(responsiveLayout, /lg:gap-4/);
assert.match(responsiveLayout, /<section id="signals"/);
assert.match(responsiveLayout, /<aside\s+id="alpha"/);
assert.match(responsiveLayout, /className="[^"]*mobile-command-summary[^"]*"/);

console.log("ok - homepage mobile signal pager layout");
