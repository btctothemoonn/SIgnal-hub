import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("./signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(
  component,
  /import \{ StocksHynixPremiumCurve \} from "@\/components\/stocks-hynix-premium-curve";/,
);
assert.ok(
  component.indexOf("<StocksHynixPremiumCurve />") >= 0,
  "homepage renders the Binance Hynix premium curve",
);
assert.ok(
  component.indexOf("<StocksHynixPremiumCurve />") <
    component.indexOf("<UnifiedNewsPanel"),
  "homepage premium curve appears above the signal feed",
);
assert.match(component, /useState<SignalMobilePanel>\("feed"\)/);
assert.doesNotMatch(component, /OpportunityRadar|opportunityEnabled|opportunities/);
assert.match(component, /type SignalMobilePanel = "feed" \| "summary"/);
assert.match(component, /const MOBILE_PANEL_INDEX = \{/);
assert.match(component, /feed: 0/);
assert.match(component, /summary: 1/);
assert.match(component, /grid grid-cols-2 gap-1/);
assert.doesNotMatch(component, /grid-cols-3/);
assert.match(component, /推送/);
assert.match(
  component,
  /\[&_\[data-signal-feed-floating-navigation\]\]:hidden/,
);
assert.match(component, /最新推送/);
assert.match(component, /AI 总结/);
assert.match(component, /matchMedia\("\(min-width: 1024px\)"\)/);
assert.match(component, /scrollTo\(\{/);
assert.match(component, /behavior: "smooth"/);
assert.equal(component.match(/scroll-smooth/g)?.length, 1);
assert.match(component, /snap-x snap-mandatory/);
assert.match(component, /onScroll=\{handleMobileScroll\}/);
assert.match(component, /const mobilePagerRef = useRef<HTMLElement \| null>\(null\)/);
assert.match(
  component,
  /const mobileReturnScrollYRef = useRef<number \| null>\(null\)/,
);
assert.match(
  component,
  /const previousMobilePanelRef = useRef<SignalMobilePanel>\("feed"\)/,
);
assert.equal(component.match(/ref=\{mobilePagerRef\}/g)?.length, 1);
assert.match(component, /if \(activeMobilePanel !== "summary"\) \{/);
assert.match(component, /mobileReturnScrollYRef\.current = window\.scrollY/);
assert.match(component, /mobilePagerRef\.current\?\.scrollIntoView\(\{/);
assert.match(component, /behavior: "auto"/);
assert.match(component, /block: "start"/);
assert.match(component, /window\.scrollTo\(\{\s*top: returnScrollY/);
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
assert.match(component, /aria-labelledby=\{MOBILE_TAB_ID\.(feed|summary)\}/);
assert.match(component, /aria-hidden=\{activeMobilePanel !== "feed"\}/);
assert.match(component, /aria-hidden=\{activeMobilePanel !== "summary"\}/);
assert.match(component, /inert=\{activeMobilePanel !== "feed"\}/);
assert.match(component, /inert=\{activeMobilePanel !== "summary"\}/);
assert.match(component, /<aside\s+id="alpha"/);
assert.match(
  component,
  /lg:grid-cols-\[minmax\(0,1\.42fr\)_minmax\(26rem,0\.95fr\)\]/,
);
assert.match(page, /import \{ SignalsResponsiveLayout \}/);
assert.match(page, /<SignalsResponsiveLayout/);
assert.doesNotMatch(page, /OPPORTUNITY_RADAR_UI_ENABLED|opportunityEnabled/);
assert.doesNotMatch(page, /<UnifiedNewsPanel/);

console.log("ok - signals responsive layout switches mobile panels");
