import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

assert.match(source, /--background:\s*#101312;/);
assert.match(source, /--panel:\s*rgba\(24,\s*29,\s*28,\s*0\.82\);/);
assert.match(source, /--accent:\s*#d7b56d;/);
assert.match(source, /background-image:\s*none;/);
assert.doesNotMatch(source, /#f7f0e6/);

console.log("ok - mobile command theme tokens");
