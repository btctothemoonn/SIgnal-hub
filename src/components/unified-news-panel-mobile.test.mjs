import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./unified-news-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-mobile-command-feed/);
assert.match(source, /Signal Flow/);
assert.match(source, /rounded-lg border border-line\/70 bg-panel\/95/);
assert.match(source, /bg-background\/70/);
assert.match(source, /active:scale-\[0\.995\]/);
assert.match(source, /border-l-2 border-l-accent\/45/);
assert.match(source, /data-telegram-fault-alert/);

console.log("ok - unified news mobile command surface");
