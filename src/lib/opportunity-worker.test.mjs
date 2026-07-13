import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
import { normalizeCatalystOpportunityItems } from "./opportunity-sources.ts";

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
      claimEvidence: {
        thesis: [candidate.evidence[0].id],
        reasons: [[candidate.evidence[1]?.id ?? candidate.evidence[0].id]],
        risks: [[candidate.evidence[0].id]],
        invalidation: [[candidate.evidence[1]?.id ?? candidate.evidence[0].id]],
      },
    })),
    providerTelemetry: {
      minimax: { attempts: 1, successes: 1, failures: 0, fallbacks: 0 },
      deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
    },
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
assert.doesNotMatch(
  readFileSync(new URL("./opportunity-worker.ts", import.meta.url), "utf8"),
  /absoluteMovePercent:\s*marketReaction\.absoluteMovePercent\s*\?\?\s*0/,
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
  assert.equal(first.evaluatedThisCycle, 1);
  assert.equal(first.selectedToday, 1);
  assert.equal(first.provider, "minimax");
  assert.equal(second.evaluatedCount, 1);
  assert.equal(second.evaluatedThisCycle, 0);
  assert.deepEqual(second.providerTelemetry, {
    minimax: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
    deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
  });

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
  assert.deepEqual(rows[0].marketReaction, {
    available: true,
    absoluteMovePercent: 1,
  });
  assert.equal(rows[0].scoreAudit.context.priorityAsset, true);
  assert.deepEqual(rows[0].scoreAudit.components, {
    sourceQuality: 20,
    specificity: 15,
    catalyst: 20,
    corroboration: 8,
    freshness: 10,
    priority: 10,
    reaction: 10,
  });
  assert.deepEqual(rows[0].claimEvidence.reasons, [["telegram:2"]]);
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
  const sourceNow = new Date("2026-07-12T02:00:00.000Z");
  const original = normalizeCatalystOpportunityItems({
    catalysts: {
      NVDA: [{
        title: "Original no-link catalyst title",
        summary: "NVDA contract demand is improving",
        date: "2026-07-11T00:00:00.000Z",
        type: "industry-event",
        source: "Google News",
      }],
    },
  }, { now: sourceNow });
  const edited = normalizeCatalystOpportunityItems({
    catalysts: {
      NVDA: [{
        title: "Revised no-link catalyst title",
        summary: "Editorial revisions changed this catalyst summary",
        date: "2026-07-11T00:00:00.000Z",
        type: "industry-event",
        source: "Google News",
      }],
    },
  }, { now: sourceNow });
  assert.equal(edited[0].id, original[0].id);
  await runOpportunityCycle(cycleOptions(db, original, async ({ inputs }) => successResult(inputs), sourceNow));
  await runOpportunityCycle(cycleOptions(
    db,
    edited,
    async ({ inputs }) => successResult(inputs),
    new Date("2026-07-12T03:00:00.000Z"),
  ));
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters").get().count),
    1,
  );
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_evidence").get().count),
    1,
  );
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  const original = highScoreFixtures();
  const edited = original.map((item) => ({
    ...item,
    text: `${item.assetKeys[0]} revised filing confirms the same large Q3 accelerator purchase`,
  }));
  await runOpportunityCycle(cycleOptions(db, original, async ({ inputs }) => successResult(inputs)));
  await runOpportunityCycle(cycleOptions(
    db,
    edited,
    async ({ inputs }) => successResult(inputs),
    new Date("2026-07-12T03:00:00.000Z"),
  ));

  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters").get().count),
    1,
  );
  assert.equal(
    Number(db.prepare("select count(*) as count from opportunity_clusters where selected_at is not null").get().count),
    1,
  );
  assert.equal(listOpportunities(db, {
    market: "all",
    sort: "score",
    status: "active",
    limit: 10,
  }).length, 1);
  assert.match(
    db.prepare("select text_excerpt from opportunity_evidence where source_type = 'x' and source_id = 'x:1'").get().text_excerpt,
    /revised filing/,
  );
  db.close();
}

for (const secondCycleFixtures of [highScoreFixtures(), []]) {
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  let aiCalls = 0;
  const fixtures = highScoreFixtures();
  const evaluateBatch = async ({ inputs }) => {
    aiCalls += 1;
    const result = successResult(inputs);
    result.evaluations[0].validUntil = "2026-07-12T02:30:00.000Z";
    return result;
  };

  await runOpportunityCycle(cycleOptions(db, fixtures, evaluateBatch));
  assert.equal(
    listOpportunities(db, {
      market: "all",
      sort: "score",
      status: "active",
      limit: 10,
    }).length,
    1,
  );

  await runOpportunityCycle(
    cycleOptions(
      db,
      secondCycleFixtures,
      evaluateBatch,
      new Date("2026-07-12T03:00:00.000Z"),
    ),
  );
  assert.equal(aiCalls, 1);
  assert.equal(
    db.prepare("select status from opportunity_clusters").get().status,
    "expired",
  );
  assert.equal(
    listOpportunities(db, {
      market: "all",
      sort: "score",
      status: "active",
      limit: 10,
    }).length,
    0,
  );
  db.close();
}

{
  const db = new DatabaseSync(":memory:");
  initOpportunityDb(db);
  db.exec(`
    CREATE TRIGGER reject_daily_selection
    BEFORE UPDATE OF selected_at ON opportunity_clusters
    WHEN NEW.selected_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'late selection failure');
    END;
  `);
  await assert.rejects(
    runOpportunityCycle(
      cycleOptions(db, highScoreFixtures(), async ({ inputs }) => successResult(inputs)),
    ),
    /late selection failure/,
  );
  const failedState = JSON.parse(getOpportunityWorkerState(db, "last_cycle"));
  assert.equal(failedState.lastError, "Error");
  assert.equal(failedState.providerTelemetry.minimax.attempts, 1);
  assert.equal(failedState.providerTelemetry.minimax.successes, 1);
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
  const evaluatedKeysByCycle = [];
  const evaluateBatch = async ({ inputs }) => {
    evaluatedKeysByCycle.push(
      inputs.map(({ candidate }) => candidate.canonicalKey),
    );
    return successResult(inputs);
  };
  await runOpportunityCycle(
    cycleOptions(db, fixtures, evaluateBatch),
  );
  await runOpportunityCycle(
    cycleOptions(
      db,
      fixtures,
      evaluateBatch,
      new Date("2026-07-12T03:00:00.000Z"),
    ),
  );
  assert.deepEqual(evaluatedKeysByCycle.map((keys) => keys.length), [20, 1]);
  const evaluatedKeys = evaluatedKeysByCycle.flat();
  assert.equal(new Set(evaluatedKeys).size, 21);
  assert.deepEqual(evaluatedKeys, [...evaluatedKeys].sort());
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
