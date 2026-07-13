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
  const {
    openOpportunityDb,
    setOpportunityPreference,
    updateOpportunityAnalysis,
    upsertOpportunityCluster,
    upsertOpportunityEvidence,
  } =
    await import("../../../lib/opportunity-store.ts");
  const db = openOpportunityDb();
  let dismissedId = 0;
  let rescoredId = 0;
  let auditId = 0;
  for (let index = 0; index < 102; index += 1) {
    const id = upsertOpportunityCluster(db, {
      canonicalKey: `us:order:TEST-${index}:2026-07-13T01`,
      market: "us",
      eventType: "order",
      assetKeys: [`TEST-${index}`],
      firstSeenAt: "2026-07-13T01:00:00.000Z",
      lastSeenAt: "2026-07-13T01:00:00.000Z",
      ruleScore: 80,
      ...(index === 0 ? {
        marketReaction: { available: true, absoluteMovePercent: 2.5 },
        scoreContext: {
          evaluatedAt: "2026-07-13T01:30:00.000Z",
          priorityAsset: false,
          marketReaction: { available: true, absoluteMovePercent: 2.5 },
        },
        scoreComponents: { sourceQuality: 20, reaction: 10 },
        scorePenalties: [],
      } : {}),
    });
    db.prepare("UPDATE opportunity_clusters SET selected_at = ? WHERE id = ?")
      .run("2026-07-13T02:00:00.000Z", id);
    if (index === 0) auditId = id;
    if (index === 100) rescoredId = id;
    if (index === 101) dismissedId = id;
  }
  upsertOpportunityEvidence(db, auditId, {
    id: "news:audit-1",
    sourceType: "news",
    sourceName: "wire",
    publishedAt: "2026-07-13T01:00:00.000Z",
    text: "public order confirmation",
    translation: null,
    originalUrl: "https://example.com/audit-1",
    assetKeys: ["TEST-0"],
  });
  updateOpportunityAnalysis(db, auditId, {
    aiAdjustment: 2,
    finalScore: 82,
    confidence: "high",
    thesis: "Order momentum is improving.",
    reasons: ["The order was confirmed."],
    risks: ["Delivery could slip."],
    invalidation: ["The order is cancelled."],
    claimEvidence: {
      thesis: ["news:audit-1"],
      reasons: [["news:audit-1"]],
      risks: [["news:audit-1"]],
      invalidation: [["news:audit-1"]],
    },
    validUntil: null,
    status: "tracking",
  });
  updateOpportunityAnalysis(db, rescoredId, {
    aiAdjustment: -6,
    finalScore: 74,
    confidence: "medium",
    thesis: "No longer above the display threshold.",
    reasons: [],
    risks: [],
    invalidation: [],
    claimEvidence: { thesis: [], reasons: [], risks: [], invalidation: [] },
    validUntil: null,
    status: "tracking",
  });
  setOpportunityPreference(db, dismissedId, { dismissed: true });
  db.close();

  const { NextRequest } = await import("next/server.js");
  const { GET } = await import("./route.ts");
  const request = (query = "") => new NextRequest(`https://hub.example/api/opportunities${query}`);

  const history = await GET(request("?status=history&limit=100"));
  assert.equal(history.status, 200);
  const historyItems = (await history.json()).items;
  assert.equal(historyItems.some((item) => item.id === dismissedId), true);
  const latestHistory = await GET(request("?status=history&sort=latest&limit=100"));
  const latestHistoryItems = (await latestHistory.json()).items;
  assert.equal(latestHistoryItems.some((item) => item.id === rescoredId), true);

  const auditItem = latestHistoryItems.find((item) => item.id === auditId);
  assert.deepEqual(auditItem.marketReaction, {
    available: true,
    absoluteMovePercent: 2.5,
  });
  assert.deepEqual(auditItem.scoreAudit.components, {
    sourceQuality: 20,
    reaction: 10,
  });
  assert.deepEqual(auditItem.claimEvidence.reasons, [["news:audit-1"]]);
  assert.equal(auditItem.evidence[0].originalUrl, "https://example.com/audit-1");

  for (const query of ["", "?limit=not-a-number", "?limit=0"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 200);
    const items = (await response.json()).items;
    assert.equal(items.length, 10);
    assert.equal(items.some((item) => item.id === rescoredId), false);
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
