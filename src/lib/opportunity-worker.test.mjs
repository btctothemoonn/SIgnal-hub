import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildOpportunityInputHash } from "./opportunity-ai.ts";
import {
  getOpportunityWorkerState,
  initOpportunityDb,
  listOpportunities,
} from "./opportunity-store.ts";
import {
  getOpportunityWorkerIntervalMs,
  runOpportunityCycle,
} from "./opportunity-worker.ts";

const NOW = new Date("2026-07-12T02:00:00.000Z");

function sourceItem(overrides = {}) {
  return {
    id: "x:1",
    sourceType: "x",
    sourceName: "analyst-a",
    market: "us",
    assetKeys: ["NVDA"],
    eventType: "order",
    publishedAt: "2026-07-12T01:00:00.000Z",
    text: "$NVDA confirms a Q3 AI order",
    translation: null,
    originalUrl: "https://example.com/x/1",
    ...overrides,
  };
}

function highScoreFixtures() {
  return [
    sourceItem(),
    sourceItem({
      id: "telegram:2",
      sourceType: "telegram",
      sourceName: "channel-b",
      publishedAt: "2026-07-12T01:10:00.000Z",
      text: "NVDA confirms the Q3 AI order",
      originalUrl: "https://example.com/tg/2",
    }),
  ];
}

function successResult(inputs, aiAdjustment = 3) {
  return {
    provider: { id: "minimax", model: "m" },
    inputHash: buildOpportunityInputHash(inputs),
    ruleOnly: false,
    evaluations: inputs.map(({ candidate }) => ({
      canonicalKey: candidate.canonicalKey,
      aiAdjustment,
      thesis: "Order confirmed",
      reasons: ["Independent sources agree"],
      risks: ["Execution delay"],
      invalidation: ["Order cancelled"],
      validUntil: null,
      confidence: "high",
      evidenceIds: candidate.evidence.map((evidence) => evidence.id),
    })),
  };
}

function cycleOptions(db, fixtures, evaluateBatch, now = NOW) {
  return {
    db,
    now,
    loadItems: async () => fixtures,
    loadPriorityAssets: async () => new Set(["NVDA"]),
    loadMarketReaction: async () => ({
      available: true,
      absoluteMovePercent: 1,
    }),
    evaluateBatch,
  };
}

assert.equal(getOpportunityWorkerIntervalMs({}), 60 * 60 * 1_000);
assert.equal(
  getOpportunityWorkerIntervalMs({ OPPORTUNITY_WORKER_INTERVAL_MS: "7200000" }),
  7_200_000,
);
assert.equal(
  getOpportunityWorkerIntervalMs({ OPPORTUNITY_WORKER_INTERVAL_MS: "invalid" }),
  60 * 60 * 1_000,
);

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  let aiCalls = 0;
  let capturedInputs = null;
  const evaluateBatch = async ({ inputs }) => {
    aiCalls += 1;
    capturedInputs = inputs;
    return successResult(inputs, 15);
  };

  const first = await runOpportunityCycle(
    cycleOptions(db, highScoreFixtures(), evaluateBatch),
  );
  const second = await runOpportunityCycle(
    cycleOptions(
      db,
      highScoreFixtures(),
      evaluateBatch,
      new Date("2026-07-12T03:00:00.000Z"),
    ),
  );

  assert.equal(aiCalls, 1);
  assert.equal(capturedInputs.length, 1);
  assert.deepEqual(Object.keys(capturedInputs[0]).sort(), ["candidate", "ruleScore"]);
  assert.ok(capturedInputs[0].ruleScore >= 60);
  assert.equal(first.candidateCount, 1);
  assert.equal(first.evaluatedCount, 1);
  assert.equal(first.selectedToday, 1);
  assert.equal(first.provider, "minimax");
  assert.equal(second.evaluatedCount, 0);

  const rows = listOpportunities(db, {
    market: "all",
    sort: "score",
    status: "active",
    limit: 10,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].finalScore, 100);
  assert.equal(rows[0].thesis, "Order confirmed");
  assert.equal(rows[0].aiPending, false);
  assert.equal(
    db.prepare("select status from opportunity_evaluations").get().status,
    "generated",
  );
  assert.deepEqual(JSON.parse(getOpportunityWorkerState(db, "last_cycle")), second);
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  const fixtures = highScoreFixtures();
  let aiCalls = 0;
  const failingBatch = async () => {
    aiCalls += 1;
    return {
      evaluations: [],
      provider: null,
      inputHash: null,
      ruleOnly: true,
    };
  };

  const failed = await runOpportunityCycle(
    cycleOptions(db, fixtures, failingBatch),
  );
  const failedRow = listOpportunities(db, {
    market: "all",
    sort: "score",
    status: "active",
    limit: 10,
  })[0];
  assert.equal(failedRow.confidence, "rule-only");
  assert.equal(failedRow.thesis, "AI 待补充");
  assert.equal(failedRow.aiPending, true);
  assert.equal(failed.provider, null);
  assert.equal(failed.evaluatedCount, 0);
  assert.equal(failed.lastError, "OpportunityAiUnavailable");
  assert.equal(
    db.prepare("select status from opportunity_evaluations").get().status,
    "error",
  );

  await runOpportunityCycle(
    cycleOptions(
      db,
      fixtures,
      async ({ inputs }) => {
        aiCalls += 1;
        return successResult(inputs);
      },
      new Date("2026-07-12T03:00:00.000Z"),
    ),
  );
  assert.equal(aiCalls, 2);
  assert.equal(
    db.prepare("select status from opportunity_evaluations").get().status,
    "generated",
  );
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  let calls = 0;
  const fixtures = highScoreFixtures();
  await runOpportunityCycle(
    cycleOptions(db, fixtures, async ({ inputs }) => {
      calls += 1;
      return successResult(inputs, 4);
    }),
  );

  await runOpportunityCycle(
    {
      ...cycleOptions(
        db,
        fixtures,
        async () => {
          calls += 1;
          throw new Error("provider failed");
        },
        new Date("2026-07-12T03:00:00.000Z"),
      ),
      loadPriorityAssets: async () => new Set(),
    },
  );
  const row = listOpportunities(db, {
    market: "all",
    sort: "score",
    status: "active",
    limit: 10,
  })[0];
  assert.equal(calls, 2);
  assert.equal(row.thesis, "Order confirmed");
  assert.equal(row.confidence, "high");
  assert.equal(row.aiPending, false);
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  const fixtures = Array.from({ length: 21 }, (_, index) =>
    highScoreFixtures().map((item, sourceIndex) => ({
      ...item,
      id: `${item.sourceType}:${index}:${sourceIndex}`,
      assetKeys: [`ASSET${index}`],
      text: `ASSET${index} confirms a Q3 AI order`,
      originalUrl: `https://example.com/${index}/${sourceIndex}`,
    })),
  ).flat();
  let inputCount = 0;
  await runOpportunityCycle(
    cycleOptions(db, fixtures, async ({ inputs }) => {
      inputCount = inputs.length;
      return successResult(inputs);
    }),
  );
  assert.equal(inputCount, 20);
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters").get().count),
    21,
  );
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters where selected_at is not null").get().count),
    10,
  );
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  let aiCalls = 0;
  const lowScore = sourceItem({
    assetKeys: [],
    eventType: "other",
    publishedAt: "2026-07-10T01:00:00.000Z",
    text: "general market comment",
  });
  await runOpportunityCycle({
    ...cycleOptions(db, [lowScore], async () => {
      aiCalls += 1;
      return { evaluations: [], provider: null, inputHash: null, ruleOnly: true };
    }),
    loadPriorityAssets: async () => new Set(),
    loadMarketReaction: async () => ({
      available: true,
      absoluteMovePercent: 10,
    }),
  });
  assert.equal(aiCalls, 0);
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters").get().count),
    1,
  );
  const stored = db
    .prepare("select ai_adjustment, confidence, thesis from opportunity_clusters")
    .get();
  assert.equal(stored.ai_adjustment, 0);
  assert.equal(stored.confidence, "rule-only");
  assert.equal(stored.thesis, "AI 待补充");
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  db.exec(`
    CREATE TRIGGER reject_opportunity_evidence
    BEFORE INSERT ON opportunity_evidence
    BEGIN
      SELECT RAISE(ABORT, 'evidence rejected');
    END;
  `);
  await assert.rejects(
    runOpportunityCycle(
      cycleOptions(db, highScoreFixtures(), async ({ inputs }) =>
        successResult(inputs),
      ),
    ),
    /evidence rejected/,
  );
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters").get().count),
    0,
  );
  const state = JSON.parse(getOpportunityWorkerState(db, "last_cycle"));
  assert.equal(state.lastSuccessAt, null);
  assert.equal(state.lastError, "Error");
  assert.doesNotMatch(JSON.stringify(state), /evidence rejected/);
  db.close();
}

console.log("ok - opportunity worker cycle and recovery");
