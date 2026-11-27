import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

assert.match(source, /--background:\s*#f5f6f8;/);
assert.match(source, /--panel:\s*#ffffff;/);
assert.match(source, /--accent:\s*#b6813c;/);
assert.match(source, /--success:\s*#159a73;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--background:\s*#0f1115;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--panel:\s*#17191f;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--accent:\s*#d6a85b;/);
assert.match(source, /html\.dark\s*\{[\s\S]*--success:\s*#49c68d;/);
assert.match(source, /--workspace-canvas:/);
assert.match(source, /--workspace-rail:/);
assert.match(source, /linear-gradient\(180deg,\s*#fafbfc 0%,\s*#f5f6f8 44%,\s*#eef1f4 100%\)/);
assert.doesNotMatch(source, /radial-gradient/);
assert.doesNotMatch(source, /#f7f0e6|#111817|#131c1a/);

console.log("ok - mobile command theme tokens");
