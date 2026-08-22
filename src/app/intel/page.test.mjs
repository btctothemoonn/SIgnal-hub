import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="intel"/);
assert.match(source, /subtitle="AI \+ 币圈投资情报站"/);
assert.match(source, /import \{ SignalsResponsiveLayout \}/);
assert.match(source, /getTelegramPipelineSnapshot\(\)/);
assert.match(source, /getXPipelineSnapshot\(0\)/);
assert.match(source, /prepareTelegramSnapshotForClient/);
assert.match(source, /<SignalsResponsiveLayout/);
assert.doesNotMatch(source, /redirect\("/);

console.log("ok - intel page renders the AI crypto intelligence station");
