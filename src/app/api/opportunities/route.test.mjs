import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const refresh = readFileSync(new URL("./refresh/route.ts", import.meta.url), "utf8");

assert.match(list, /listOpportunities/);
assert.match(list, /getOpportunitySnapshot/);
assert.match(list, /market/);
assert.match(list, /sort/);
assert.match(list, /status/);
assert.match(list, /limit/);
assert.match(list, /Math\.min\(100,/);
assert.match(list, /Math\.max\(1,/);
assert.match(list, /Cache-Control.*no-store/);
assert.match(refresh, /getOpportunitySnapshot/);
assert.match(refresh, /Cache-Control.*no-store/);
assert.doesNotMatch(refresh, /runOpportunityCycle|evaluateOpportunityBatch|opportunity-worker|opportunity-ai/);

console.log("ok - opportunity list and refresh API contracts");
