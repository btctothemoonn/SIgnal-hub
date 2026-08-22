import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="intel"/);
assert.match(source, /subtitle="AI \+ 币圈投资情报站"/);
assert.match(source, /import \{ DailyBriefPanel \}/);
assert.match(source, /getLatestDailyInvestmentBrief/);
assert.match(source, /<DailyBriefPanel/);
assert.doesNotMatch(source, /SignalsResponsiveLayout/);
assert.doesNotMatch(source, /getTelegramPipelineSnapshot/);
assert.doesNotMatch(source, /getXPipelineSnapshot/);
assert.doesNotMatch(source, /prepareTelegramSnapshotForClient/);
assert.doesNotMatch(source, /redirect\("/);

console.log("ok - intel page renders daily investment brief");
