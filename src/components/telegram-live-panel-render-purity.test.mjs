import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./telegram-live-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /useRef\(0\)/);
assert.doesNotMatch(source, /useRef\(Date\.now\(\)\)/);
console.log("ok - Telegram refresh clock initializes after render");
