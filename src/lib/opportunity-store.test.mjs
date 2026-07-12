import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  getOpportunityEvaluationByInputHash,
  getOpportunityWorkerState,
  initOpportunityDb,
  listOpportunities,
  saveOpportunityEvaluation,
  selectUnselectedDailyOpportunities,
  setOpportunityPreference,
  setOpportunityWorkerState,
  updateOpportunityAnalysis,
  upsertOpportunityCluster,
  upsertOpportunityEvidence,
} from "./opportunity-store.ts";

const db = new DatabaseSync(":memory:");
initOpportunityDb(db);

const clusterId = upsertOpportunityCluster(db, {
  canonicalKey: "us:order:NVDA:2026-07-12T01",
  market: "us",
  eventType: "order",
  assetKeys: ["NVDA"],
  firstSeenAt: "2026-07-12T01:00:00.000Z",
  lastSeenAt: "2026-07-12T01:10:00.000Z",
  ruleScore: 82,
});
assert.equal(
  upsertOpportunityCluster(db, {
    canonicalKey: "us:order:NVDA:2026-07-12T01",
    market: "us",
    eventType: "order",
    assetKeys: ["NVDA"],
    firstSeenAt: "2026-07-12T00:55:00.000Z",
    lastSeenAt: "2026-07-12T01:15:00.000Z",
    ruleScore: 85,
  }),
  clusterId,
);

upsertOpportunityEvidence(db, clusterId, {
  id: "x:1",
  sourceType: "x",
  sourceName: "analyst-a",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "order confirmed",
  translation: null,
  originalUrl: "https://example.com/a",
  assetKeys: ["NVDA"],
});
upsertOpportunityEvidence(db, clusterId, {
  id: "x:1",
  sourceType: "x",
  sourceName: "analyst-a",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "order confirmation updated token=visible-secret",
  translation: null,
  originalUrl: "https://example.com/a",
  assetKeys: ["NVDA"],
});
upsertOpportunityEvidence(db, clusterId, {
  id: "patreon:private-1",
  sourceType: "patreon",
  sourceName: "private-analyst",
  publishedAt: "2026-07-12T01:05:00.000Z",
  text: "private investment thesis SECRET_API_KEY=do-not-store ".repeat(80),
  translation: null,
  originalUrl: "https://patreon.example.com/private-1",
  assetKeys: ["NVDA"],
});

assert.equal(
  Number(db.prepare("select count(*) as count from opportunity_evidence where cluster_id = ?").get(clusterId).count),
  2,
);
const updatedEvidence = db.prepare("select text_excerpt from opportunity_evidence where source_type = 'x'").get();
assert.doesNotMatch(updatedEvidence.text_excerpt, /visible-secret/);
const privateEvidence = db.prepare("select text_excerpt from opportunity_evidence where source_type = 'patreon'").get();
assert.equal(privateEvidence.text_excerpt, "Private Patreon evidence available.");

saveOpportunityEvaluation(db, {
  clusterId,
  inputHash: "hash-1",
  provider: "minimax",
  model: "m",
  status: "generated",
  result: { aiAdjustment: 3 },
});
saveOpportunityEvaluation(db, {
  clusterId,
  inputHash: "hash-1",
  provider: "minimax",
  model: "m",
  status: "generated",
  result: { aiAdjustment: 4 },
});
assert.deepEqual(getOpportunityEvaluationByInputHash(db, clusterId, "hash-1")?.result, { aiAdjustment: 4 });
assert.equal(
  Number(db.prepare("select count(*) as count from opportunity_evaluations where cluster_id = ?").get(clusterId).count),
  1,
);

updateOpportunityAnalysis(db, clusterId, {
  aiAdjustment: 3,
  finalScore: 103,
  confidence: "high",
  thesis: "Demand remains underappreciated.",
  reasons: ["Order confirmed"],
  risks: ["Execution delay"],
  invalidation: ["Order cancelled"],
  validUntil: "2026-07-13T01:00:00.000Z",
  status: "tracking",
}, "2026-07-12T01:20:00.000Z");
setOpportunityPreference(db, clusterId, { followed: true, dismissed: false });

assert.deepEqual(
  selectUnselectedDailyOpportunities(db, {
    dateKey: "2026-07-12",
    threshold: 75,
    limit: 100,
    selectedAt: "2026-07-12T02:00:00.000Z",
  }),
  [clusterId],
);

const rows = listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 1000 });
assert.equal(rows.length, 1);
assert.equal(rows[0].evidence.length, 2);
assert.equal(rows[0].evidence[0].textExcerpt, "Private Patreon evidence available.");
assert.equal(rows[0].followed, true);
assert.equal(rows[0].finalScore, 100);
assert.equal(rows[0].aiPending, false);

setOpportunityPreference(db, clusterId, { followed: true, dismissed: true });
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 10 }).length, 0);
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "history", limit: 10 }).length, 0);
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "history", includeDismissed: true, limit: 10 }).length, 1);

assert.equal(getOpportunityWorkerState(db, "scan-cursor"), null);
setOpportunityWorkerState(db, "scan-cursor", "2026-07-12T01:20:00.000Z");
assert.equal(getOpportunityWorkerState(db, "scan-cursor"), "2026-07-12T01:20:00.000Z");

db.close();
console.log("ok - opportunity store");
