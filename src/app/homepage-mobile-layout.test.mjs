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
assert.match(responsiveLayout, /opportunityEnabled \? enabledMobilePanels : mobilePanels/);
assert.match(responsiveLayout, /MOBILE_PANEL_INDEX\[panel\]/);
assert.match(responsiveLayout, /MOBILE_PANEL_INDEX\.opportunities/);
assert.match(responsiveLayout, /if \(!opportunityEnabled\)/);
assert.match(responsiveLayout, /grid grid-cols-2 gap-1/);
assert.match(responsiveLayout, /grid-cols-3/);
assert.match(responsiveLayout, /w-full shrink-0 snap-start/);
assert.match(responsiveLayout, /lg:gap-4/);
assert.match(responsiveLayout, /<section id="signals"/);
assert.match(responsiveLayout, /<aside\s+id="alpha"/);
assert.match(responsiveLayout, /className="[^"]*mobile-command-summary[^"]*"/);
assert.match(
  page,
  /opportunityEnabled=\{\s*process\.env\.OPPORTUNITY_RADAR_UI_ENABLED === "1"\s*\}/,
);

console.log("ok - homepage mobile signal pager layout");
