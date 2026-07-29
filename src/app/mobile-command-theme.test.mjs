import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

assert.match(source, /--background:\s*#f3f6f5;/);
assert.match(source, /--panel:\s*rgba\(255,\s*255,\s*255,\s*0\.88\);/);
assert.match(source, /--accent:\s*#8a651f;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--background:\s*#0c0f0e;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--panel:\s*rgba\(19,\s*23,\s*22,\s*0\.88\);/);
assert.match(source, /html\.dark\s*\{[\s\S]*--accent:\s*#e0be76;/);
assert.match(source, /--workspace-canvas:/);
assert.match(source, /--workspace-rail:/);
assert.match(source, /background-image:\s*none;/);
assert.doesNotMatch(source, /#f7f0e6/);

console.log("ok - mobile command theme tokens");
