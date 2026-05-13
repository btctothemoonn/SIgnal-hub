import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("./signals-responsive-layout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(component, /useState<SignalMobilePanel>\("feed"\)/);
assert.match(component, /最新推送/);
assert.match(component, /AI 总结/);
assert.match(component, /matchMedia\("\(min-width: 1024px\)"\)/);
assert.match(component, /scrollTo\(\{/);
assert.match(component, /snap-x snap-mandatory/);
assert.match(component, /onScroll=\{handleMobileScroll\}/);
assert.match(component, /aria-pressed=\{activeMobilePanel === panel\.id\}/);
assert.match(component, /lg:grid-cols-\[minmax\(0,1\.58fr\)_minmax\(22rem,0\.82fr\)\]/);
assert.match(page, /import \{ SignalsResponsiveLayout \}/);
assert.match(page, /<SignalsResponsiveLayout/);
assert.doesNotMatch(page, /<UnifiedNewsPanel/);

console.log("ok - signals responsive layout switches mobile panels");
