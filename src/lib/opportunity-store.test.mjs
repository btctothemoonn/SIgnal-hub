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
  marketReaction: { available: true, absoluteMovePercent: 1.25 },
  scoreContext: {
    evaluatedAt: "2026-07-12T01:15:00.000Z",
    priorityAsset: true,
    marketReaction: { available: true, absoluteMovePercent: 1.25 },
  },
  scoreComponents: { sourceQuality: 20, reaction: 10 },
  scorePenalties: ["stale-source"],
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
upsertOpportunityEvidence(db, clusterId, {
  id: "news:secret-forms",
  sourceType: "news",
  sourceName: "wire",
  publishedAt: "2026-07-12T01:02:00.000Z",
  text: 'API payload {"apiKey":"json-secret-value"} token=equals-secret-value Authorization: Bearer bearer-secret-value',
  translation: null,
  originalUrl: "https://example.com/secrets",
  assetKeys: ["NVDA"],
});

assert.equal(
  Number(db.prepare("select count(*) as count from opportunity_evidence where cluster_id = ?").get(clusterId).count),
  3,
);
const updatedEvidence = db.prepare("select text_excerpt from opportunity_evidence where source_type = 'x'").get();
assert.doesNotMatch(updatedEvidence.text_excerpt, /visible-secret/);
const redactedEvidence = db.prepare("select text_excerpt from opportunity_evidence where source_id = 'news:secret-forms'").get();
assert.equal(
  redactedEvidence.text_excerpt,
  'API payload {"apiKey":"[redacted]"} token=[redacted] Authorization: Bearer [redacted]',
);
for (const secret of ["json-secret-value", "equals-secret-value", "bearer-secret-value"]) {
  assert.doesNotMatch(redactedEvidence.text_excerpt, new RegExp(secret));
}
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
  claimEvidence: {
    thesis: ["x:1"],
    reasons: [["x:1"]],
    risks: [["news:secret-forms"]],
    invalidation: [["x:1"]],
  },
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
const lowScoreClusterId = upsertOpportunityCluster(db, {
  canonicalKey: "us:order:AMD:2026-07-12T01",
  market: "us",
  eventType: "order",
  assetKeys: ["AMD"],
  firstSeenAt: "2026-07-12T01:20:00.000Z",
  lastSeenAt: "2026-07-12T01:20:00.000Z",
  ruleScore: 74,
});
assert.deepEqual(
  selectUnselectedDailyOpportunities(db, {
    dateKey: "2026-07-12",
    threshold: 0,
    limit: 10,
    selectedAt: "2026-07-12T02:10:00.000Z",
  }),
  [],
);
assert.equal(
  db.prepare("select selected_at from opportunity_clusters where id = ?").get(lowScoreClusterId).selected_at,
  null,
);

const rows = listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 1000 });
assert.equal(rows.length, 1);
assert.equal(rows[0].evidence.length, 3);
assert.equal(rows[0].evidence[0].textExcerpt, "Private Patreon evidence available.");
assert.equal(rows[0].followed, true);
assert.equal(rows[0].finalScore, 100);
assert.equal(rows[0].aiPending, false);
assert.deepEqual(rows[0].marketReaction, {
  available: true,
  absoluteMovePercent: 1.25,
});
assert.deepEqual(rows[0].scoreAudit, {
  context: {
    evaluatedAt: "2026-07-12T01:15:00.000Z",
    priorityAsset: true,
    marketReaction: { available: true, absoluteMovePercent: 1.25 },
  },
  components: { sourceQuality: 20, reaction: 10 },
  penalties: ["stale-source"],
});
assert.deepEqual(rows[0].claimEvidence, {
  thesis: ["x:1"],
  reasons: [["x:1"]],
  risks: [["news:secret-forms"]],
  invalidation: [["x:1"]],
});

updateOpportunityAnalysis(db, clusterId, {
  aiAdjustment: -11,
  finalScore: 74,
  confidence: "medium",
  thesis: "Demand remains underappreciated.",
  reasons: ["Order confirmed"],
  risks: ["Execution delay"],
  invalidation: ["Order cancelled"],
  claimEvidence: rows[0].claimEvidence,
  validUntil: null,
  status: "tracking",
}, "2026-07-12T02:05:00.000Z");
assert.equal(
  listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 10 }).length,
  0,
);
assert.equal(
  listOpportunities(db, { market: "all", sort: "score", status: "history", limit: 10 }).length,
  1,
);
updateOpportunityAnalysis(db, clusterId, {
  aiAdjustment: 15,
  finalScore: 100,
  confidence: "high",
  thesis: "Demand remains underappreciated.",
  reasons: ["Order confirmed"],
  risks: ["Execution delay"],
  invalidation: ["Order cancelled"],
  claimEvidence: rows[0].claimEvidence,
  validUntil: null,
  status: "tracking",
}, "2026-07-12T02:06:00.000Z");

setOpportunityPreference(db, clusterId, { followed: true, dismissed: true });
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 10 }).length, 0);
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "history", limit: 10 }).length, 1);
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "history", includeDismissed: true, limit: 10 }).length, 1);

setOpportunityPreference(db, clusterId, { followed: false });
assert.deepEqual(
  { ...db.prepare("SELECT followed, dismissed FROM opportunity_preferences WHERE cluster_id = ?").get(clusterId) },
  { followed: 0, dismissed: 1 },
);
setOpportunityPreference(db, lowScoreClusterId, { followed: true });
assert.deepEqual(
  { ...db.prepare("SELECT followed, dismissed FROM opportunity_preferences WHERE cluster_id = ?").get(lowScoreClusterId) },
  { followed: 1, dismissed: 0 },
);

assert.equal(getOpportunityWorkerState(db, "scan-cursor"), null);
setOpportunityWorkerState(db, "scan-cursor", "2026-07-12T01:20:00.000Z");
assert.equal(getOpportunityWorkerState(db, "scan-cursor"), "2026-07-12T01:20:00.000Z");

db.close();
console.log("ok - opportunity store");
