import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("src/app/holding/page.tsx", "utf-8");
const appShellSource = readFileSync("src/components/app-shell.tsx", "utf-8");
const loaderSource = readFileSync(
  "src/components/holding-panel-loader.tsx",
  "utf-8",
);

assert.match(pageSource, /HoldingPanelLoader/);
assert.doesNotMatch(pageSource, /@\/components\/holding-panel["']/);
assert.match(loaderSource, /dynamic\(/);
assert.match(loaderSource, /ssr:\s*false/);
assert.match(appShellSource, /router\.prefetch\(item\.href\)/);
assert.match(appShellSource, /item\.key === "holding"/);
assert.match(appShellSource, /import\("@\/components\/holding-panel"\)/);

console.log("ok - holding navigation loads panel asynchronously");
