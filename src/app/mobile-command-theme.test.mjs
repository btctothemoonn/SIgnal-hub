import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

assert.match(source, /--background:\s*#f3f8f6;/);
assert.match(source, /--panel:\s*#ffffff;/);
assert.match(source, /--accent:\s*#6c5ce7;/);
assert.match(source, /--success:\s*#14b8a6;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--background:\s*#111817;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--panel:\s*#17211f;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--success:\s*#2dd4bf;/);
assert.match(source, /--workspace-canvas:/);
assert.match(source, /--workspace-rail:/);
assert.match(source, /linear-gradient\(180deg,\s*#f8fcfa 0%,\s*#f3f8f6 44%,\s*#edf4f1 100%\)/);
assert.doesNotMatch(source, /radial-gradient/);
assert.doesNotMatch(source, /#f7f0e6/);

console.log("ok - mobile command theme tokens");
