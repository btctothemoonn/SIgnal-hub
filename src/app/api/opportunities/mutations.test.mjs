import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const tempDirectory = mkdtempSync(join(tmpdir(), "opportunity-mutations-"));
const databasePath = join(tempDirectory, "opportunities.sqlite");
const originalDatabasePath = process.env.OPPORTUNITY_DB;
process.env.OPPORTUNITY_DB = databasePath;

try {
  const { openOpportunityDb, setOpportunityPreference, upsertOpportunityCluster } =
    await import("../../../lib/opportunity-store.ts");
  const db = openOpportunityDb();
  const clusterId = upsertOpportunityCluster(db, {
    canonicalKey: "us:order:TEST:2026-07-13T01",
    market: "us",
    eventType: "order",
    assetKeys: ["TEST"],
    firstSeenAt: "2026-07-13T01:00:00.000Z",
    lastSeenAt: "2026-07-13T01:00:00.000Z",
    ruleScore: 80,
  });
  setOpportunityPreference(db, clusterId, { followed: true, dismissed: true });
  db.close();

  const [{ POST: followPost }, { POST: dismissPost }] = await Promise.all([
    import("./[id]/follow/route.ts"),
    import("./[id]/dismiss/route.ts"),
  ]);
  const context = (id) => ({ params: Promise.resolve({ id }) });
  const readPreference = () => {
    const current = openOpportunityDb();
    try {
      return {
        ...current.prepare("SELECT followed, dismissed FROM opportunity_preferences WHERE cluster_id = ?")
          .get(clusterId),
      };
    } finally {
      current.close();
    }
  };

  const invalidId = await followPost(
    new Request("https://hub.example/api/opportunities/0/follow", { method: "POST", body: "{}" }),
    context("0"),
  );
  assert.equal(invalidId.status, 400);
  const missingCluster = await dismissPost(
    new Request("https://hub.example/api/opportunities/9999/dismiss", { method: "POST" }),
    context("9999"),
  );
  assert.equal(missingCluster.status, 404);

  const followResponse = await followPost(
    new Request(`https://hub.example/api/opportunities/${clusterId}/follow`, {
      method: "POST",
      body: JSON.stringify({ followed: false }),
      headers: { "Content-Type": "application/json" },
    }),
    context(String(clusterId)),
  );
  assert.equal(followResponse.status, 200);
  assert.deepEqual(readPreference(), { followed: 0, dismissed: 1 });

  const resetDb = openOpportunityDb();
  setOpportunityPreference(resetDb, clusterId, { followed: true, dismissed: false });
  resetDb.close();
  const dismissResponse = await dismissPost(
    new Request(`https://hub.example/api/opportunities/${clusterId}/dismiss`, { method: "POST" }),
    context(String(clusterId)),
  );
  assert.equal(dismissResponse.status, 200);
  assert.deepEqual(readPreference(), { followed: 1, dismissed: 1 });
} finally {
  if (originalDatabasePath === undefined) delete process.env.OPPORTUNITY_DB;
  else process.env.OPPORTUNITY_DB = originalDatabasePath;
  rmSync(tempDirectory, { force: true, recursive: true });
}

console.log("ok - opportunity preference mutation API behavior");
