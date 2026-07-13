import { DatabaseSync } from "node:sqlite";
import {
  OPPORTUNITY_PROMPT_VERSION,
  buildOpportunityInputHash,
  evaluateOpportunityBatch,
  type OpportunityAiBatchResult,
  type OpportunityAiEvaluation,
  type OpportunityAiInput,
} from "./opportunity-ai.ts";
import {
  clusterOpportunityItems,
  deriveOpportunityStatus,
  formatOpportunityDateKey,
  scoreOpportunityCandidate,
} from "./opportunity-rules.ts";
import {
  loadOpportunityMarketReaction,
  loadOpportunityPriorityAssetKeys,
  loadOpportunitySourceItems,
} from "./opportunity-sources.ts";
import {
  getOpportunityEvaluationByInputHash,
  openOpportunityDb,
  saveOpportunityEvaluation,
  selectUnselectedDailyOpportunities,
  setOpportunityWorkerState,
  updateOpportunityAnalysis,
  upsertOpportunityEvidence,
} from "./opportunity-store.ts";
import type {
  OpportunityCandidate,
  OpportunityScore,
  OpportunitySourceItem,
} from "./opportunity-types.ts";

type EnvLike = Record<string, string | undefined>;
type MaybePromise<T> = T | Promise<T>;

type ScoredOpportunity = {
  candidate: OpportunityCandidate;
  score: OpportunityScore;
};

type PersistedOpportunity = ScoredOpportunity & {
  clusterId: number;
};

type PendingOpportunity = PersistedOpportunity & {
  input: OpportunityAiInput;
  inputHash: string;
};

type OpportunityProvider = {
  id: string;
  model: string;
};

type OpportunityBatchResultLike = {
  evaluations: OpportunityAiEvaluation[];
  provider: OpportunityProvider | null;
  inputHash: string | null;
  ruleOnly: boolean;
};

export type OpportunityCycleResult = {
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  candidateCount: number;
  evaluatedCount: number;
  selectedToday: number;
  provider: string | null;
  model: string | null;
  durationMs: number;
};

export type OpportunityCycleOptions = {
  db?: DatabaseSync;
  now?: Date;
  loadItems?: () => MaybePromise<OpportunitySourceItem[]>;
  loadPriorityAssets?: () => MaybePromise<Set<string>>;
  loadMarketReaction?: (
    assetKeys: string[],
  ) => MaybePromise<{ available: boolean; absoluteMovePercent: number | null }>;
  evaluateBatch?: (options: {
    inputs: OpportunityAiInput[];
  }) => MaybePromise<OpportunityAiBatchResult | OpportunityBatchResultLike>;
};

const DEFAULT_WORKER_INTERVAL_MS = 60 * 60 * 1_000;
const AI_THRESHOLD = 60;
const AI_BATCH_LIMIT = 20;
const DAILY_SELECTION_THRESHOLD = 75;
const DAILY_SELECTION_LIMIT = 10;
const RULE_ONLY_THESIS = "AI 待补充";

function errorClass(error: unknown) {
  return error instanceof Error && error.name ? error.name : "Error";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function independentSourceCount(candidate: OpportunityCandidate) {
  return new Set(
    candidate.evidence.map((item) => `${item.sourceType}:${item.sourceName}`),
  ).size;
}

function withTransaction<T>(db: DatabaseSync, operation: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function upsertRuleCluster(
  db: DatabaseSync,
  candidate: OpportunityCandidate,
  ruleScore: number,
  updatedAt: string,
) {
  db.prepare(`
    INSERT INTO opportunity_clusters (
      canonical_key, market, event_type, asset_keys_json, first_seen_at,
      last_seen_at, rule_score, final_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      market = excluded.market,
      event_type = excluded.event_type,
      asset_keys_json = excluded.asset_keys_json,
      first_seen_at = MIN(opportunity_clusters.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(opportunity_clusters.last_seen_at, excluded.last_seen_at),
      rule_score = excluded.rule_score,
      final_score = MIN(100, MAX(0, excluded.rule_score + opportunity_clusters.ai_adjustment)),
      updated_at = excluded.updated_at
  `).run(
    candidate.canonicalKey,
    candidate.market,
    candidate.eventType,
    JSON.stringify(candidate.assetKeys),
    candidate.firstSeenAt,
    candidate.lastSeenAt,
    clampScore(ruleScore),
    clampScore(ruleScore),
    updatedAt,
    updatedAt,
  );
  const row = db
    .prepare("SELECT id FROM opportunity_clusters WHERE canonical_key = ?")
    .get(candidate.canonicalKey);
  return numberValue(row?.id);
}

function persistOpportunityRuleCandidates(
  db: DatabaseSync,
  scored: ScoredOpportunity[],
  updatedAt: string,
) {
  return withTransaction(db, () =>
    scored.map(({ candidate, score }) => {
      const clusterId = upsertRuleCluster(
        db,
        candidate,
        score.ruleScore,
        updatedAt,
      );
      for (const evidence of candidate.evidence) {
        upsertOpportunityEvidence(db, clusterId, evidence);
      }
      return { clusterId, candidate, score };
    }),
  );
}

function hasGeneratedEvaluation(db: DatabaseSync, clusterId: number) {
  return Boolean(
    db
      .prepare(`
        SELECT 1 FROM opportunity_evaluations
        WHERE cluster_id = ? AND status = 'generated'
        LIMIT 1
      `)
      .get(clusterId),
  );
}

function applyRuleOnlyAnalysis(
  db: DatabaseSync,
  entry: PersistedOpportunity,
  updatedAt: string,
) {
  if (hasGeneratedEvaluation(db, entry.clusterId)) return;
  const finalScore = clampScore(entry.score.ruleScore);
  updateOpportunityAnalysis(
    db,
    entry.clusterId,
    {
      aiAdjustment: 0,
      finalScore,
      confidence: "rule-only",
      thesis: RULE_ONLY_THESIS,
      reasons: [],
      risks: [],
      invalidation: [],
      validUntil: null,
      status: deriveOpportunityStatus(
        {
          independentSourceCount: independentSourceCount(entry.candidate),
          finalScore,
          confidence: "rule-only",
        },
        new Date(updatedAt),
      ),
    },
    updatedAt,
  );
}

function saveFailedEvaluation(
  db: DatabaseSync,
  entry: PendingOpportunity,
  failureClass: string,
  updatedAt: string,
) {
  saveOpportunityEvaluation(db, {
    clusterId: entry.clusterId,
    inputHash: entry.inputHash,
    provider: "none",
    model: "none",
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    result: null,
    status: "error",
    errorMessage: failureClass,
    createdAt: updatedAt,
  });
  applyRuleOnlyAnalysis(db, entry, updatedAt);
}

function validateEvaluationMap(
  pending: PendingOpportunity[],
  result: OpportunityBatchResultLike,
) {
  const expectedKeys = new Set(
    pending.map((entry) => entry.candidate.canonicalKey),
  );
  const evaluations = new Map<string, OpportunityAiEvaluation>();
  for (const evaluation of result.evaluations) {
    if (
      !expectedKeys.has(evaluation.canonicalKey) ||
      evaluations.has(evaluation.canonicalKey)
    ) {
      throw new Error("Opportunity AI returned an unknown or duplicate key");
    }
    evaluations.set(evaluation.canonicalKey, evaluation);
  }
  if (evaluations.size !== pending.length) {
    throw new Error("Opportunity AI omitted a candidate");
  }
  return evaluations;
}

function applyOpportunityEvaluations(
  db: DatabaseSync,
  pending: PendingOpportunity[],
  result: OpportunityBatchResultLike | null,
  failureClass: string | null,
  updatedAt: string,
) {
  let evaluations: Map<string, OpportunityAiEvaluation> | null = null;
  if (!failureClass && result && !result.ruleOnly && result.provider) {
    try {
      evaluations = validateEvaluationMap(pending, result);
    } catch (error) {
      failureClass = errorClass(error);
    }
  } else if (!failureClass) {
    failureClass = "OpportunityAiUnavailable";
  }

  withTransaction(db, () => {
    for (const entry of pending) {
      const evaluation = evaluations?.get(entry.candidate.canonicalKey);
      if (!evaluation || !result?.provider) {
        saveFailedEvaluation(
          db,
          entry,
          failureClass ?? "OpportunityAiUnavailable",
          updatedAt,
        );
        continue;
      }

      const finalScore = clampScore(
        entry.score.ruleScore + evaluation.aiAdjustment,
      );
      saveOpportunityEvaluation(db, {
        clusterId: entry.clusterId,
        inputHash: entry.inputHash,
        provider: result.provider.id,
        model: result.provider.model,
        promptVersion: OPPORTUNITY_PROMPT_VERSION,
        result: evaluation,
        status: "generated",
        errorMessage: null,
        createdAt: updatedAt,
      });
      updateOpportunityAnalysis(
        db,
        entry.clusterId,
        {
          aiAdjustment: evaluation.aiAdjustment,
          finalScore,
          confidence: evaluation.confidence,
          thesis: evaluation.thesis,
          reasons: evaluation.reasons,
          risks: evaluation.risks,
          invalidation: evaluation.invalidation,
          validUntil: evaluation.validUntil,
          status: deriveOpportunityStatus(
            {
              validUntil: evaluation.validUntil,
              independentSourceCount: independentSourceCount(entry.candidate),
              finalScore,
              confidence: evaluation.confidence,
            },
            new Date(updatedAt),
          ),
        },
        updatedAt,
      );
    }
  });

  return failureClass;
}

function selectedTodayCount(db: DatabaseSync, dateKey: string) {
  const row = db
    .prepare(`
      SELECT count(*) AS count FROM opportunity_clusters
      WHERE selected_at IS NOT NULL
        AND substr(datetime(selected_at, '+8 hours'), 1, 10) = ?
    `)
    .get(dateKey);
  return numberValue(row?.count);
}

function previousCycleState(db: DatabaseSync) {
  const row = db
    .prepare(`
      SELECT state_value FROM opportunity_worker_state WHERE state_key = 'last_cycle'
    `)
    .get();
  if (typeof row?.state_value !== "string") return null;
  try {
    return JSON.parse(row.state_value) as Partial<OpportunityCycleResult>;
  } catch {
    return null;
  }
}

function writeCycleState(db: DatabaseSync, result: OpportunityCycleResult) {
  setOpportunityWorkerState(db, "last_cycle", JSON.stringify(result));
}

export function getOpportunityWorkerIntervalMs(env: EnvLike = process.env) {
  const parsed = Number(env.OPPORTUNITY_WORKER_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_WORKER_INTERVAL_MS;
}

export async function runOpportunityCycle(
  options: OpportunityCycleOptions = {},
): Promise<OpportunityCycleResult> {
  const db = options.db ?? openOpportunityDb();
  const ownsDb = !options.db;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const startedAt = Date.now();
  const loadItems = options.loadItems ?? loadOpportunitySourceItems;
  const loadPriorityAssets =
    options.loadPriorityAssets ?? loadOpportunityPriorityAssetKeys;
  const loadMarketReaction =
    options.loadMarketReaction ?? loadOpportunityMarketReaction;
  const evaluateBatch = options.evaluateBatch ?? evaluateOpportunityBatch;

  try {
    const [items, priorityAssetKeys] = await Promise.all([
      loadItems(),
      loadPriorityAssets(),
    ]);
    const candidates = clusterOpportunityItems(items);
    const scored: ScoredOpportunity[] = await Promise.all(
      candidates.map(async (candidate) => {
        const marketReaction = await loadMarketReaction(candidate.assetKeys);
        return {
          candidate,
          score: scoreOpportunityCandidate(candidate, {
            priorityAssetKeys,
            marketReaction: {
              ...marketReaction,
              absoluteMovePercent: marketReaction.absoluteMovePercent ?? 0,
            },
            now,
          }),
        };
      }),
    );
    const persisted = persistOpportunityRuleCandidates(db, scored, nowIso);
    withTransaction(db, () => {
      for (const entry of persisted) {
        applyRuleOnlyAnalysis(db, entry, nowIso);
      }
    });
    const eligibleKeys = new Set(
      scored
        .filter((entry) => entry.score.ruleScore >= AI_THRESHOLD)
        .slice(0, AI_BATCH_LIMIT)
        .map((entry) => entry.candidate.canonicalKey),
    );
    const pending: PendingOpportunity[] = persisted.flatMap((entry) => {
      if (!eligibleKeys.has(entry.candidate.canonicalKey)) return [];
      const input = {
        candidate: entry.candidate,
        ruleScore: entry.score.ruleScore,
      };
      const inputHash = buildOpportunityInputHash(
        [input],
        OPPORTUNITY_PROMPT_VERSION,
      );
      const existing = getOpportunityEvaluationByInputHash(
        db,
        entry.clusterId,
        inputHash,
      );
      return existing?.status === "generated"
        ? []
        : [{ ...entry, input, inputHash }];
    });

    let aiResult: OpportunityBatchResultLike | null = null;
    let aiFailureClass: string | null = null;
    if (pending.length > 0) {
      try {
        aiResult = await evaluateBatch({
          inputs: pending.map((entry) => entry.input),
        });
      } catch (error) {
        aiFailureClass = errorClass(error);
      }
      aiFailureClass = applyOpportunityEvaluations(
        db,
        pending,
        aiResult,
        aiFailureClass,
        nowIso,
      );
    }

    const dateKey = formatOpportunityDateKey(now, "Asia/Shanghai");
    selectUnselectedDailyOpportunities(db, {
      dateKey,
      threshold: DAILY_SELECTION_THRESHOLD,
      limit: DAILY_SELECTION_LIMIT,
      selectedAt: nowIso,
    });
    const result: OpportunityCycleResult = {
      lastRunAt: nowIso,
      lastSuccessAt: nowIso,
      lastError: aiFailureClass,
      candidateCount: scored.length,
      evaluatedCount:
        aiResult && !aiResult.ruleOnly && !aiFailureClass
          ? aiResult.evaluations.length
          : 0,
      selectedToday: selectedTodayCount(db, dateKey),
      provider:
        aiResult && !aiResult.ruleOnly && !aiFailureClass
          ? aiResult.provider?.id ?? null
          : null,
      model:
        aiResult && !aiResult.ruleOnly && !aiFailureClass
          ? aiResult.provider?.model ?? null
          : null,
      durationMs: Date.now() - startedAt,
    };
    writeCycleState(db, result);
    return result;
  } catch (error) {
    const previous = previousCycleState(db);
    const failedState: OpportunityCycleResult = {
      lastRunAt: nowIso,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastError: errorClass(error),
      candidateCount: previous?.candidateCount ?? 0,
      evaluatedCount: previous?.evaluatedCount ?? 0,
      selectedToday: previous?.selectedToday ?? 0,
      provider: previous?.provider ?? null,
      model: previous?.model ?? null,
      durationMs: Date.now() - startedAt,
    };
    try {
      writeCycleState(db, failedState);
    } catch {
      // Preserve the cycle failure when the database cannot record health state.
    }
    throw error;
  } finally {
    if (ownsDb) db.close();
  }
}
