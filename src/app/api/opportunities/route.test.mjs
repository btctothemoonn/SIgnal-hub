import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const tempDirectory = mkdtempSync(join(tmpdir(), "opportunity-api-"));
const databasePath = join(tempDirectory, "opportunities.sqlite");
const originalDatabasePath = process.env.OPPORTUNITY_DB;
process.env.OPPORTUNITY_DB = databasePath;

try {
  const { openOpportunityDb, setOpportunityPreference, upsertOpportunityCluster } =
    await import("../../../lib/opportunity-store.ts");
  const db = openOpportunityDb();
  let dismissedId = 0;
  for (let index = 0; index < 101; index += 1) {
    const id = upsertOpportunityCluster(db, {
      canonicalKey: `us:order:TEST-${index}:2026-07-13T01`,
      market: "us",
      eventType: "order",
      assetKeys: [`TEST-${index}`],
      firstSeenAt: "2026-07-13T01:00:00.000Z",
      lastSeenAt: "2026-07-13T01:00:00.000Z",
      ruleScore: 80,
    });
    db.prepare("UPDATE opportunity_clusters SET selected_at = ? WHERE id = ?")
      .run("2026-07-13T02:00:00.000Z", id);
    if (index === 100) dismissedId = id;
  }
  setOpportunityPreference(db, dismissedId, { dismissed: true });
  db.close();

  const { NextRequest } = await import("next/server.js");
  const { GET } = await import("./route.ts");
  const request = (query = "") => new NextRequest(`https://hub.example/api/opportunities${query}`);

  const history = await GET(request("?status=history&limit=100"));
  assert.equal(history.status, 200);
  assert.equal((await history.json()).items.some((item) => item.id === dismissedId), true);

  for (const query of ["", "?limit=not-a-number", "?limit=0"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items.length, 10);
  }
  const negativeLimit = await GET(request("?limit=-2"));
  assert.equal(negativeLimit.status, 200);
  assert.equal((await negativeLimit.json()).items.length, 1);
  const cappedLimit = await GET(request("?limit=999"));
  assert.equal(cappedLimit.status, 200);
  assert.equal((await cappedLimit.json()).items.length, 100);

  process.env.OPPORTUNITY_DB = tempDirectory;
  const failedOpen = await GET(request());
  assert.equal(failedOpen.status, 500);
  assert.deepEqual(await failedOpen.json(), {
    error: "Unable to load opportunities",
    success: false,
  });
} finally {
  if (originalDatabasePath === undefined) delete process.env.OPPORTUNITY_DB;
  else process.env.OPPORTUNITY_DB = originalDatabasePath;
  rmSync(tempDirectory, { force: true, recursive: true });
}

console.log("ok - opportunity list and refresh API behavior");
