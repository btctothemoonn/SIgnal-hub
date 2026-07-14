import { DatabaseSync } from "node:sqlite";
import {
  OPPORTUNITY_PROMPT_VERSION,
  buildOpportunityInputHash,
  evaluateOpportunityBatch,
  type OpportunityAiBatchResult,
  type OpportunityAiEvaluation,
  type OpportunityAiInput,
  type OpportunityProviderTelemetry,
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
  findOpportunityClusterIdBySourceIdentity,
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
  OpportunityMarketReaction,
  OpportunityScore,
  OpportunityScoreContextAudit,
  OpportunitySourceItem,
} from "./opportunity-types.ts";

type EnvLike = Record<string, string | undefined>;
type MaybePromise<T> = T | Promise<T>;

type ScoredOpportunity = {
  candidate: OpportunityCandidate;
  score: OpportunityScore;
  marketReaction: OpportunityMarketReaction;
  scoreContext: OpportunityScoreContextAudit;
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
  providerTelemetry?: OpportunityProviderTelemetry;
};

export type OpportunityCycleResult = {
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  candidateCount: number;
  evaluatedCount: number;
  evaluatedThisCycle: number;
  selectedToday: number;
  provider: string | null;
  model: string | null;
  providerTelemetry: OpportunityProviderTelemetry;
  durationMs: number;
};

export type OpportunityCycleOptions = {
  db?: DatabaseSync;
  now?: Date;
  loadItems?: () => MaybePromise<OpportunitySourceItem[]>;
  loadPriorityAssets?: () => MaybePromise<Set<string>>;
  loadMarketReaction?: (
    assetKeys: string[],
  ) => MaybePromise<OpportunityMarketReaction>;
  evaluateBatch?: (options: {
    inputs: OpportunityAiInput[];
  }) => MaybePromise<OpportunityAiBatchResult | OpportunityBatchResultLike>;
};

const DEFAULT_WORKER_INTERVAL_MS = 60 * 60 * 1_000;
const AI_THRESHOLD = 60;
const AI_BATCH_LIMIT = 20;
const DAILY_SELECTION_THRESHOLD = 75;
const DAILY_SELECTION_LIMIT = 10;
const MAX_PROVIDER_COUNTER = 100;
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

function emptyProviderTelemetry(): OpportunityProviderTelemetry {
  return {
    minimax: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
    deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
  };
}

function boundedProviderCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_PROVIDER_COUNTER, Math.max(0, Math.floor(value)))
    : 0;
}

function providerTelemetryValue(value: unknown): OpportunityProviderTelemetry {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const counters = (provider: "minimax" | "deepseek") => {
    const candidate = typeof record[provider] === "object" && record[provider] !== null
      ? record[provider] as Record<string, unknown>
      : {};
    return {
      attempts: boundedProviderCount(candidate.attempts),
      successes: boundedProviderCount(candidate.successes),
      failures: boundedProviderCount(candidate.failures),
      fallbacks: boundedProviderCount(candidate.fallbacks),
    };
  };
  return { minimax: counters("minimax"), deepseek: counters("deepseek") };
}

type OpportunityCycleError = Error & {
  opportunityProviderTelemetry?: OpportunityProviderTelemetry;
};

export function getOpportunityProviderTelemetryFromError(error: unknown) {
  return error instanceof Error
    ? providerTelemetryValue((error as OpportunityCycleError).opportunityProviderTelemetry)
    : emptyProviderTelemetry();
}

function attachProviderTelemetry(
  error: unknown,
  providerTelemetry: OpportunityProviderTelemetry,
) {
  const cycleError = error instanceof Error
    ? error as OpportunityCycleError
    : new Error(String(error));
  try {
    Object.defineProperty(cycleError, "opportunityProviderTelemetry", {
      value: providerTelemetry,
      configurable: true,
    });
  } catch {
    // Keep the original error when it cannot be annotated for structured logs.
  }
  return cycleError;
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
  entry: ScoredOpportunity,
  updatedAt: string,
) {
  const { candidate, marketReaction, score, scoreContext } = entry;
  const ruleScore = clampScore(score.ruleScore);
  const sourceClusterId = findOpportunityClusterIdBySourceIdentity(
    db,
    candidate.evidence,
  );
  if (sourceClusterId !== null) {
    db.prepare(`
      UPDATE opportunity_clusters SET
        market = ?, event_type = ?, asset_keys_json = ?,
        first_seen_at = MIN(first_seen_at, ?),
        last_seen_at = MAX(last_seen_at, ?),
        rule_score = ?,
        final_score = MIN(100, MAX(0, ? + ai_adjustment)),
        market_reaction_json = ?, score_context_json = ?,
        score_components_json = ?, score_penalties_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      candidate.market,
      candidate.eventType,
      JSON.stringify(candidate.assetKeys),
      candidate.firstSeenAt,
      candidate.lastSeenAt,
      ruleScore,
      ruleScore,
      JSON.stringify(marketReaction),
      JSON.stringify(scoreContext),
      JSON.stringify(score.components),
      JSON.stringify(score.penalties),
      updatedAt,
      sourceClusterId,
    );
    return sourceClusterId;
  }
  db.prepare(`
    INSERT INTO opportunity_clusters (
      canonical_key, market, event_type, asset_keys_json, first_seen_at,
      last_seen_at, rule_score, final_score, market_reaction_json,
      score_context_json, score_components_json, score_penalties_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      market = excluded.market,
      event_type = excluded.event_type,
      asset_keys_json = excluded.asset_keys_json,
      first_seen_at = MIN(opportunity_clusters.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(opportunity_clusters.last_seen_at, excluded.last_seen_at),
      rule_score = excluded.rule_score,
      final_score = MIN(100, MAX(0, excluded.rule_score + opportunity_clusters.ai_adjustment)),
      market_reaction_json = excluded.market_reaction_json,
      score_context_json = excluded.score_context_json,
      score_components_json = excluded.score_components_json,
      score_penalties_json = excluded.score_penalties_json,
      updated_at = excluded.updated_at
  `).run(
    candidate.canonicalKey,
    candidate.market,
    candidate.eventType,
    JSON.stringify(candidate.assetKeys),
    candidate.firstSeenAt,
    candidate.lastSeenAt,
    ruleScore,
    ruleScore,
    JSON.stringify(marketReaction),
    JSON.stringify(scoreContext),
    JSON.stringify(score.components),
    JSON.stringify(score.penalties),
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
    scored.map((entry) => {
      const { candidate } = entry;
      const clusterId = upsertRuleCluster(
        db,
        entry,
        updatedAt,
      );
      for (const evidence of candidate.evidence) {
        upsertOpportunityEvidence(db, clusterId, evidence);
      }
      return { ...entry, clusterId };
    }),
  );
}

function hasGeneratedEvaluation(
  db: DatabaseSync,
  clusterId: number,
  inputHash: string,
) {
  return (
    getOpportunityEvaluationByInputHash(db, clusterId, inputHash)?.status ===
    "generated"
  );
}

function applyRuleOnlyAnalysis(
  db: DatabaseSync,
  entry: PendingOpportunity,
  updatedAt: string,
) {
  if (hasGeneratedEvaluation(db, entry.clusterId, entry.inputHash)) return;
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
      claimEvidence: { thesis: [], reasons: [], risks: [], invalidation: [] },
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
          claimEvidence: evaluation.claimEvidence,
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

function currentEvaluationCoverageCount(
  db: DatabaseSync,
  currentEntries: PendingOpportunity[],
) {
  return currentEntries.filter((entry) =>
    hasGeneratedEvaluation(db, entry.clusterId, entry.inputHash),
  ).length;
}

function refreshPersistedOpportunityStatuses(
  db: DatabaseSync,
  now: Date,
  updatedAt: string,
) {
  const rows = db.prepare(`
    SELECT
      c.id,
      c.status,
      c.valid_until,
      c.invalidated_at,
      c.final_score,
      c.confidence,
      COUNT(DISTINCT e.source_type || char(31) || e.source_name)
        AS independent_source_count
    FROM opportunity_clusters c
    LEFT JOIN opportunity_evidence e ON e.cluster_id = c.id
    WHERE c.status != 'expired'
    GROUP BY c.id
  `).all();
  const update = db.prepare(`
    UPDATE opportunity_clusters
    SET status = ?, updated_at = ?
    WHERE id = ? AND status != ?
  `);

  withTransaction(db, () => {
    for (const row of rows) {
      const status = deriveOpportunityStatus(
        {
          validUntil:
            typeof row.valid_until === "string" ? row.valid_until : null,
          invalidatedAt:
            typeof row.invalidated_at === "string"
              ? row.invalidated_at
              : null,
          independentSourceCount: numberValue(row.independent_source_count),
          finalScore: numberValue(row.final_score),
          confidence:
            typeof row.confidence === "string" ? row.confidence : "",
        },
        now,
      );
      update.run(status, updatedAt, row.id, status);
    }
  });
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
  let providerTelemetry = emptyProviderTelemetry();

  try {
    const [items, priorityAssetKeys] = await Promise.all([
      loadItems(),
      loadPriorityAssets(),
    ]);
    const candidates = clusterOpportunityItems(items);
    const scored: ScoredOpportunity[] = await Promise.all(
      candidates.map(async (candidate) => {
        const marketReaction = await loadMarketReaction(candidate.assetKeys);
        const scoreContext: OpportunityScoreContextAudit = {
          evaluatedAt: nowIso,
          priorityAsset: candidate.assetKeys.some((key) =>
            priorityAssetKeys.has(key)),
          marketReaction,
        };
        return {
          candidate,
          marketReaction,
          scoreContext,
          score: scoreOpportunityCandidate(candidate, {
            priorityAssetKeys,
            marketReaction,
            now,
          }),
        };
      }),
    );
    const persisted = persistOpportunityRuleCandidates(db, scored, nowIso);
    const currentEntries: PendingOpportunity[] = persisted.map((entry) => {
      const input = {
        candidate: entry.candidate,
        ruleScore: entry.score.ruleScore,
      };
      return {
        ...entry,
        input,
        inputHash: buildOpportunityInputHash(
          [input],
          OPPORTUNITY_PROMPT_VERSION,
        ),
      };
    });
    withTransaction(db, () => {
      for (const entry of currentEntries) {
        applyRuleOnlyAnalysis(db, entry, nowIso);
      }
    });
    const pending: PendingOpportunity[] = currentEntries
      .filter((entry) => entry.score.ruleScore >= AI_THRESHOLD)
      .filter((entry) =>
        getOpportunityEvaluationByInputHash(
          db,
          entry.clusterId,
          entry.inputHash,
        )?.status !== "generated",
      )
      .sort(
        (left, right) => {
          const scoreDifference =
            right.score.ruleScore - left.score.ruleScore;
          if (scoreDifference !== 0) return scoreDifference;
          if (left.candidate.canonicalKey < right.candidate.canonicalKey) {
            return -1;
          }
          return left.candidate.canonicalKey > right.candidate.canonicalKey
            ? 1
            : 0;
        },
      )
      .slice(0, AI_BATCH_LIMIT);

    let aiResult: OpportunityBatchResultLike | null = null;
    let aiFailureClass: string | null = null;
    if (pending.length > 0) {
      try {
        aiResult = await evaluateBatch({
          inputs: pending.map((entry) => entry.input),
        });
        providerTelemetry = providerTelemetryValue(aiResult.providerTelemetry);
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

    refreshPersistedOpportunityStatuses(db, now, nowIso);
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
      evaluatedCount: currentEvaluationCoverageCount(db, currentEntries),
      evaluatedThisCycle:
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
      providerTelemetry,
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
      evaluatedThisCycle: 0,
      selectedToday: previous?.selectedToday ?? 0,
      provider: previous?.provider ?? null,
      model: previous?.model ?? null,
      providerTelemetry,
      durationMs: Date.now() - startedAt,
    };
    try {
      writeCycleState(db, failedState);
    } catch {
      // Preserve the cycle failure when the database cannot record health state.
    }
    throw attachProviderTelemetry(error, providerTelemetry);
  } finally {
    if (ownsDb) db.close();
  }
}
