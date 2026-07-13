import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const follow = readFileSync(new URL("./[id]/follow/route.ts", import.meta.url), "utf8");
const dismiss = readFileSync(new URL("./[id]/dismiss/route.ts", import.meta.url), "utf8");

for (const source of [follow, dismiss]) {
  assert.match(source, /Number\.isSafeInteger/);
  assert.match(source, /clusterId > 0/);
  assert.match(source, /status: 400/);
  assert.match(source, /status: 404/);
  assert.match(source, /SELECT 1 FROM opportunity_clusters WHERE id = \?/);
  assert.match(source, /setOpportunityPreference/);
  assert.match(source, /Cache-Control.*no-store/);
  assert.doesNotMatch(source, /verifyAdminSessionToken|ADMIN_SESSION_COOKIE/);
}

assert.match(follow, /followed: body\.followed/);
assert.match(dismiss, /dismissed: true/);

console.log("ok - opportunity preference mutation API contracts");
