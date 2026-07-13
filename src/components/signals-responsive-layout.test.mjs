import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("./signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(component, /useState<SignalMobilePanel>\("feed"\)/);
assert.match(component, /import \{ OpportunityRadar \}/);
assert.match(component, /opportunityEnabled: boolean/);
assert.match(component, /const MOBILE_PANEL_INDEX = \{/);
assert.match(component, /feed: 0/);
assert.match(component, /opportunities: 1/);
assert.match(component, /summary: 2/);
assert.match(component, /if \(isDesktop && !opportunityEnabled\)/);
assert.match(component, /if \(!opportunityEnabled\)/);
assert.match(component, /grid grid-cols-2 gap-1/);
assert.match(component, /grid-cols-3/);
assert.match(component, /推送/);
assert.match(component, /机会/);
assert.match(component, /<OpportunityRadar \/>/);
assert.match(component, /useState<SignalDesktopPanel>\("feed"\)/);
assert.match(component, /activeDesktopPanel === "opportunities"/);
assert.match(
  component,
  /\[&_\[data-signal-feed-floating-navigation\]\]:hidden/,
);
assert.match(component, /最新推送/);
assert.match(component, /AI 总结/);
assert.match(component, /matchMedia\("\(min-width: 1024px\)"\)/);
assert.match(component, /scrollTo\(\{/);
assert.match(component, /behavior: opportunityEnabled \? "auto" : "smooth"/);
assert.equal(component.match(/scroll-smooth/g)?.length, 1);
assert.match(component, /snap-x snap-mandatory/);
assert.match(component, /onScroll=\{handleMobileScroll\}/);
assert.match(component, /aria-pressed=\{activeMobilePanel === panel\.id\}/);
assert.match(component, /role="tablist"/);
assert.match(component, /role="tab"/);
assert.match(component, /aria-selected=\{activeMobilePanel === panel\.id\}/);
assert.match(component, /aria-controls=\{MOBILE_PANEL_ID\[panel\.id\]\}/);
assert.match(component, /tabIndex=\{activeMobilePanel === panel\.id \? 0 : -1\}/);
assert.match(component, /onKeyDown=\{\(event\) => handleMobileTabKeyDown\(event, panel\.id\)\}/);
assert.match(component, /event\.key === "ArrowLeft"/);
assert.match(component, /event\.key === "ArrowRight"/);
assert.match(component, /event\.key === "Home"/);
assert.match(component, /event\.key === "End"/);
assert.match(component, /role="tabpanel"/);
assert.match(component, /aria-labelledby=\{MOBILE_TAB_ID\.(feed|opportunities|summary)\}/);
assert.match(component, /aria-hidden=\{activeMobilePanel !== "feed"\}/);
assert.match(component, /aria-hidden=\{activeMobilePanel !== "opportunities"\}/);
assert.match(component, /aria-hidden=\{activeMobilePanel !== "summary"\}/);
assert.match(component, /inert=\{activeMobilePanel !== "feed"\}/);
assert.match(component, /inert=\{activeMobilePanel !== "opportunities"\}/);
assert.match(component, /inert=\{activeMobilePanel !== "summary"\}/);
assert.match(component, /<aside\s+id="alpha"/);
assert.match(
  component,
  /lg:grid-cols-\[minmax\(0,1\.42fr\)_minmax\(26rem,0\.95fr\)\]/,
);
assert.match(page, /import \{ SignalsResponsiveLayout \}/);
assert.match(page, /<SignalsResponsiveLayout/);
assert.match(
  page,
  /opportunityEnabled=\{\s*process\.env\.OPPORTUNITY_RADAR_UI_ENABLED === "1"\s*\}/,
);
assert.doesNotMatch(page, /<UnifiedNewsPanel/);

console.log("ok - signals responsive layout switches mobile panels");
