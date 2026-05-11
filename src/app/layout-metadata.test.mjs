import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

assert.match(source, /manifest:\s*"\/manifest\.webmanifest"/);
assert.match(source, /appleWebApp:\s*{/);
assert.match(source, /capable:\s*true/);
assert.match(source, /title:\s*"Signal Hub"/);
assert.match(source, /statusBarStyle:\s*"black-translucent"/);
assert.match(source, /apple:\s*"\/apple-touch-icon\.png"/);
assert.match(source, /shortcut:\s*"\/favicon\.ico"/);

console.log("ok - pwa layout metadata");
