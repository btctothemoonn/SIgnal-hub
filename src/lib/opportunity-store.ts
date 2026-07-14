import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import type {
  OpportunityCard,
  OpportunityCandidate,
  OpportunityClaimEvidence,
  OpportunityEvidenceView,
  OpportunityListStatus,
  OpportunityMarket,
  OpportunityMarketFilter,
  OpportunityMarketReaction,
  OpportunityScoreContextAudit,
  OpportunitySort,
  OpportunitySourceItem,
  OpportunityStatus,
} from "./opportunity-types.ts";
import { sanitizeOpportunityOriginalUrl } from "./opportunity-url.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;

type OpportunityClusterInput = Omit<OpportunityCandidate, "evidence"> & {
  ruleScore: number;
  marketReaction?: OpportunityMarketReaction;
  scoreContext?: OpportunityScoreContextAudit;
  scoreComponents?: Record<string, number>;
  scorePenalties?: string[];
};

type OpportunityAnalysis = {
  aiAdjustment: number;
  finalScore: number;
  confidence: string;
  thesis: string;
  reasons: string[];
  risks: string[];
  invalidation: string[];
  claimEvidence: OpportunityClaimEvidence;
  validUntil: string | null;
  status: OpportunityStatus;
};

type OpportunityEvaluationInput = {
  clusterId: number;
  provider: string;
  model: string;
  promptVersion?: number;
  inputHash: string;
  result: unknown;
  status: string;
  errorMessage?: string | null;
  createdAt?: string;
};

type OpportunityListOptions = {
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  limit: number;
  includeDismissed?: boolean;
};

const PRIVATE_PATREON_EXCERPT = "Private Patreon evidence available.";
const MAX_EVIDENCE_EXCERPT_LENGTH = 500;
const UNAVAILABLE_MARKET_REACTION: OpportunityMarketReaction = {
  available: false,
  absoluteMovePercent: null,
};
const EMPTY_CLAIM_EVIDENCE: OpportunityClaimEvidence = {
  thesis: [],
  reasons: [],
  risks: [],
  invalidation: [],
};

function nowIso() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function marketReactionValue(value: unknown): OpportunityMarketReaction {
  if (typeof value !== "object" || value === null) return UNAVAILABLE_MARKET_REACTION;
  const record = value as Record<string, unknown>;
  return record.available === true &&
    typeof record.absoluteMovePercent === "number" &&
    Number.isFinite(record.absoluteMovePercent)
    ? { available: true, absoluteMovePercent: record.absoluteMovePercent }
    : UNAVAILABLE_MARKET_REACTION;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function claimEvidenceValue(value: unknown): OpportunityClaimEvidence {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const nested = (candidate: unknown) =>
    Array.isArray(candidate) ? candidate.map(stringArrayValue) : [];
  return {
    thesis: stringArrayValue(record.thesis),
    reasons: nested(record.reasons),
    risks: nested(record.risks),
    invalidation: nested(record.invalidation),
  };
}

function scoreContextValue(value: unknown): OpportunityScoreContextAudit {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  return {
    evaluatedAt: nullableString(record.evaluatedAt),
    priorityAsset: record.priorityAsset === true,
    marketReaction: marketReactionValue(record.marketReaction),
  };
}

function scoreComponentsValue(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 1));
}

function redactedExcerpt(text: string) {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /(["']?(?:api[_-]?key|secret|token|password|authorization)["']?\s*:\s*)(["'])(?:\\.|(?!\2)[\s\S])*?\2/gi,
      "$1$2[redacted]$2",
    )
    .replace(
      /(\b(?:api[_-]?key|secret|token|password|authorization)\b\s*(?:=|:)\s*)(?!Bearer\s+\[redacted\])(?:["'][^"']*["']|[^\s,;}\]]+)/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|pk|ghp)_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EVIDENCE_EXCERPT_LENGTH);
}

function safeEvidenceExcerpt(evidence: OpportunitySourceItem) {
  if (evidence.sourceType === "patreon") return PRIVATE_PATREON_EXCERPT;
  return redactedExcerpt(evidence.translation || evidence.text);
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

function toEvidenceView(row: DbRow): OpportunityEvidenceView {
  return {
    id: stringValue(row.source_id),
    sourceType: stringValue(row.source_type) as OpportunityEvidenceView["sourceType"],
    sourceName: stringValue(row.source_name),
    publishedAt: stringValue(row.published_at),
    textExcerpt: stringValue(row.text_excerpt),
    originalUrl: stringValue(row.original_url),
  };
}

export function getOpportunityDbPath(env: EnvLike = process.env) {
  return env.OPPORTUNITY_DB?.trim() || getRuntimeDataPath(env, "opportunities.sqlite");
}

export function openOpportunityDb(path = getOpportunityDbPath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  initOpportunityDb(db);
  return db;
}

export function initOpportunityDb(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS opportunity_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT NOT NULL UNIQUE,
      market TEXT NOT NULL,
      event_type TEXT NOT NULL,
      asset_keys_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      rule_score INTEGER NOT NULL DEFAULT 0,
      ai_adjustment INTEGER NOT NULL DEFAULT 0,
      final_score INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'rule-only',
      thesis TEXT NOT NULL DEFAULT '',
      reasons_json TEXT NOT NULL DEFAULT '[]',
      risks_json TEXT NOT NULL DEFAULT '[]',
      invalidation_json TEXT NOT NULL DEFAULT '[]',
      market_reaction_json TEXT NOT NULL DEFAULT '{"available":false,"absoluteMovePercent":null}',
      score_context_json TEXT NOT NULL DEFAULT '{}',
      score_components_json TEXT NOT NULL DEFAULT '{}',
      score_penalties_json TEXT NOT NULL DEFAULT '[]',
      claim_evidence_json TEXT NOT NULL DEFAULT '{"thesis":[],"reasons":[],"risks":[],"invalidation":[]}',
      valid_until TEXT,
      invalidated_at TEXT,
      selected_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      published_at TEXT NOT NULL,
      text_excerpt TEXT NOT NULL,
      original_url TEXT NOT NULL,
      asset_keys_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(cluster_id, source_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS opportunity_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(cluster_id, input_hash)
    );
    CREATE TABLE IF NOT EXISTS opportunity_preferences (
      cluster_id INTEGER PRIMARY KEY,
      followed INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_worker_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opportunity_clusters_score ON opportunity_clusters(final_score DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opportunity_clusters_selected ON opportunity_clusters(selected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opportunity_evidence_cluster ON opportunity_evidence(cluster_id, published_at DESC);
  `);
  const clusterColumns = new Set(
    db.prepare("PRAGMA table_info(opportunity_clusters)").all()
      .map((row) => stringValue(row.name)),
  );
  const ensureClusterColumn = (name: string, definition: string) => {
    if (!clusterColumns.has(name)) db.exec(`ALTER TABLE opportunity_clusters ADD COLUMN ${definition}`);
  };
  ensureClusterColumn("score_context_json", "score_context_json TEXT NOT NULL DEFAULT '{}'");
  ensureClusterColumn("score_components_json", "score_components_json TEXT NOT NULL DEFAULT '{}'");
  ensureClusterColumn("score_penalties_json", "score_penalties_json TEXT NOT NULL DEFAULT '[]'");
  ensureClusterColumn(
    "claim_evidence_json",
    `claim_evidence_json TEXT NOT NULL DEFAULT '{"thesis":[],"reasons":[],"risks":[],"invalidation":[]}'`,
  );
}

export function upsertOpportunityCluster(db: DatabaseSync, cluster: OpportunityClusterInput) {
  const updatedAt = nowIso();
  const ruleScore = clampScore(cluster.ruleScore);
  const marketReaction = cluster.marketReaction ?? UNAVAILABLE_MARKET_REACTION;
  const scoreContext = cluster.scoreContext ?? {
    evaluatedAt: null,
    priorityAsset: false,
    marketReaction,
  };
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO opportunity_clusters (
        canonical_key, market, event_type, asset_keys_json, first_seen_at, last_seen_at,
        rule_score, final_score, market_reaction_json, score_context_json,
        score_components_json, score_penalties_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_key) DO UPDATE SET
        market = excluded.market,
        event_type = excluded.event_type,
        asset_keys_json = excluded.asset_keys_json,
        first_seen_at = MIN(opportunity_clusters.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(opportunity_clusters.last_seen_at, excluded.last_seen_at),
        rule_score = excluded.rule_score,
        final_score = MIN(100, MAX(0, excluded.rule_score + opportunity_clusters.ai_adjustment)),
        market_reaction_json = CASE WHEN ? = 1 THEN excluded.market_reaction_json ELSE opportunity_clusters.market_reaction_json END,
        score_context_json = CASE WHEN ? = 1 THEN excluded.score_context_json ELSE opportunity_clusters.score_context_json END,
        score_components_json = CASE WHEN ? = 1 THEN excluded.score_components_json ELSE opportunity_clusters.score_components_json END,
        score_penalties_json = CASE WHEN ? = 1 THEN excluded.score_penalties_json ELSE opportunity_clusters.score_penalties_json END,
        updated_at = excluded.updated_at
    `).run(
      cluster.canonicalKey,
      cluster.market,
      cluster.eventType,
      JSON.stringify(cluster.assetKeys),
      cluster.firstSeenAt,
      cluster.lastSeenAt,
      ruleScore,
      ruleScore,
      JSON.stringify(marketReaction),
      JSON.stringify(scoreContext),
      JSON.stringify(cluster.scoreComponents ?? {}),
      JSON.stringify(cluster.scorePenalties ?? []),
      updatedAt,
      updatedAt,
      cluster.marketReaction === undefined ? 0 : 1,
      cluster.scoreContext === undefined ? 0 : 1,
      cluster.scoreComponents === undefined ? 0 : 1,
      cluster.scorePenalties === undefined ? 0 : 1,
    );
    const row = db.prepare("SELECT id FROM opportunity_clusters WHERE canonical_key = ?").get(cluster.canonicalKey);
    return numberValue(row?.id);
  });
}

export function findOpportunityClusterIdBySourceIdentity(
  db: DatabaseSync,
  evidence: OpportunitySourceItem[],
) {
  const find = db.prepare(`
    SELECT cluster_id FROM opportunity_evidence
    WHERE source_type = ? AND source_id = ?
    ORDER BY cluster_id ASC
    LIMIT 1
  `);
  let clusterId: number | null = null;
  for (const item of evidence) {
    const row = find.get(item.sourceType, item.id);
    if (!row) continue;
    const matched = numberValue(row.cluster_id);
    if (matched > 0 && (clusterId === null || matched < clusterId)) clusterId = matched;
  }
  return clusterId;
}

export function upsertOpportunityEvidence(db: DatabaseSync, clusterId: number, evidence: OpportunitySourceItem) {
  const excerpt = safeEvidenceExcerpt(evidence);
  const contentHash = createHash("sha256").update(excerpt).digest("hex");
  db.prepare(`
    INSERT INTO opportunity_evidence (
      cluster_id, source_type, source_id, source_name, published_at, text_excerpt,
      original_url, asset_keys_json, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cluster_id, source_type, source_id) DO UPDATE SET
      source_name = excluded.source_name,
      published_at = excluded.published_at,
      text_excerpt = excluded.text_excerpt,
      original_url = excluded.original_url,
      asset_keys_json = excluded.asset_keys_json,
      content_hash = excluded.content_hash
  `).run(
    clusterId,
    evidence.sourceType,
    evidence.id,
    evidence.sourceName,
    evidence.publishedAt,
    excerpt,
    sanitizeOpportunityOriginalUrl(evidence.originalUrl),
    JSON.stringify(evidence.assetKeys),
    contentHash,
  );
}

export function updateOpportunityAnalysis(db: DatabaseSync, clusterId: number, analysis: OpportunityAnalysis, updatedAt = nowIso()) {
  db.prepare(`
    UPDATE opportunity_clusters SET
      ai_adjustment = ?, final_score = ?, confidence = ?, thesis = ?,
      reasons_json = ?, risks_json = ?, invalidation_json = ?, valid_until = ?,
      claim_evidence_json = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    numberValue(analysis.aiAdjustment),
    clampScore(analysis.finalScore),
    analysis.confidence,
    analysis.thesis,
    JSON.stringify(analysis.reasons),
    JSON.stringify(analysis.risks),
    JSON.stringify(analysis.invalidation),
    analysis.validUntil,
    JSON.stringify(analysis.claimEvidence),
    analysis.status,
    updatedAt,
    clusterId,
  );
}

export function saveOpportunityEvaluation(db: DatabaseSync, evaluation: OpportunityEvaluationInput) {
  db.prepare(`
    INSERT INTO opportunity_evaluations (
      cluster_id, provider, model, prompt_version, input_hash, result_json,
      status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cluster_id, input_hash) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      result_json = excluded.result_json,
      status = excluded.status,
      error_message = excluded.error_message
  `).run(
    evaluation.clusterId,
    evaluation.provider,
    evaluation.model,
    evaluation.promptVersion ?? 1,
    evaluation.inputHash,
    JSON.stringify(evaluation.result),
    evaluation.status,
    evaluation.errorMessage ?? null,
    evaluation.createdAt ?? nowIso(),
  );
}

export function getOpportunityEvaluationByInputHash(db: DatabaseSync, clusterId: number, inputHash: string) {
  const row = db.prepare(`
    SELECT id, cluster_id, provider, model, prompt_version, input_hash, result_json,
      status, error_message, created_at
    FROM opportunity_evaluations
    WHERE cluster_id = ? AND input_hash = ?
  `).get(clusterId, inputHash);
  if (!row) return null;
  return {
    id: numberValue(row.id),
    clusterId: numberValue(row.cluster_id),
    provider: stringValue(row.provider),
    model: stringValue(row.model),
    promptVersion: numberValue(row.prompt_version),
    inputHash: stringValue(row.input_hash),
    result: parseJson(row.result_json, null),
    status: stringValue(row.status),
    errorMessage: nullableString(row.error_message),
    createdAt: stringValue(row.created_at),
  };
}

export function setOpportunityPreference(
  db: DatabaseSync,
  clusterId: number,
  preference: { followed?: boolean; dismissed?: boolean },
) {
  const followed = preference.followed === undefined ? null : preference.followed ? 1 : 0;
  const dismissed = preference.dismissed === undefined ? null : preference.dismissed ? 1 : 0;
  db.prepare(`
    INSERT INTO opportunity_preferences(cluster_id, followed, dismissed, updated_at)
    VALUES (?, COALESCE(?, 0), COALESCE(?, 0), ?)
    ON CONFLICT(cluster_id) DO UPDATE SET
      followed = COALESCE(?, opportunity_preferences.followed),
      dismissed = COALESCE(?, opportunity_preferences.dismissed),
      updated_at = excluded.updated_at
  `).run(clusterId, followed, dismissed, nowIso(), followed, dismissed);
}

export function selectUnselectedDailyOpportunities(
  db: DatabaseSync,
  options: { dateKey: string; threshold: number; limit: number; selectedAt: string },
) {
  return withTransaction(db, () => {
    const selectedToday = numberValue(db.prepare(`
      SELECT count(*) AS count FROM opportunity_clusters
      WHERE selected_at IS NOT NULL AND substr(datetime(selected_at, '+8 hours'), 1, 10) = ?
    `).get(options.dateKey)?.count);
    const remaining = Math.max(0, Math.min(10, clampLimit(options.limit)) - selectedToday);
    if (remaining === 0) return [];
    const rows = db.prepare(`
      SELECT id FROM opportunity_clusters
      WHERE selected_at IS NULL AND final_score >= ? AND status != 'expired'
      ORDER BY final_score DESC, updated_at DESC
      LIMIT ?
    `).all(Math.max(75, clampScore(options.threshold)), remaining);
    const update = db.prepare("UPDATE opportunity_clusters SET selected_at = ?, updated_at = ? WHERE id = ?");
    for (const row of rows) update.run(options.selectedAt, options.selectedAt, row.id);
    return rows.map((row) => numberValue(row.id));
  });
}

export function listOpportunities(db: DatabaseSync, options: OpportunityListOptions): OpportunityCard[] {
  const conditions = ["c.selected_at IS NOT NULL"];
  const values: Array<string | number> = [];
  if (options.market !== "all") {
    conditions.push("c.market = ?");
    values.push(options.market);
  }
  if (options.status === "active") conditions.push("c.status != 'expired'");
  if (options.status === "active") conditions.push("c.final_score >= 75");
  if (options.status === "active" && !options.includeDismissed) {
    conditions.push("COALESCE(p.dismissed, 0) = 0");
  }
  const orderBy = options.sort === "latest" ? "c.last_seen_at DESC, c.updated_at DESC" : "c.final_score DESC, c.updated_at DESC";
  const limit = clampLimit(options.limit);
  const rows = db.prepare(`
    SELECT c.*, COALESCE(p.followed, 0) AS followed, COALESCE(p.dismissed, 0) AS dismissed,
      CASE WHEN c.confidence = 'rule-only' THEN 1 ELSE 0 END AS ai_pending
    FROM opportunity_clusters c
    LEFT JOIN opportunity_preferences p ON p.cluster_id = c.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(...values, limit);
  if (rows.length === 0) return [];

  const clusterIds = rows.map((row) => numberValue(row.id));
  const placeholders = clusterIds.map(() => "?").join(", ");
  const evidenceRows = db.prepare(`
    SELECT cluster_id, source_type, source_id, source_name, published_at, text_excerpt, original_url
    FROM opportunity_evidence
    WHERE cluster_id IN (${placeholders})
    ORDER BY published_at DESC, id DESC
  `).all(...clusterIds);
  const evidenceByCluster = new Map<number, OpportunityEvidenceView[]>();
  for (const evidence of evidenceRows) {
    const id = numberValue(evidence.cluster_id);
    const current = evidenceByCluster.get(id) ?? [];
    current.push(toEvidenceView(evidence));
    evidenceByCluster.set(id, current);
  }

  return rows.map((row) => ({
    id: numberValue(row.id),
    market: stringValue(row.market) as OpportunityMarket,
    assetKeys: parseJson<string[]>(row.asset_keys_json, []),
    eventType: stringValue(row.event_type) as OpportunityCard["eventType"],
    status: stringValue(row.status) as OpportunityStatus,
    finalScore: numberValue(row.final_score),
    confidence: stringValue(row.confidence),
    thesis: stringValue(row.thesis),
    reasons: parseJson<string[]>(row.reasons_json, []),
    risks: parseJson<string[]>(row.risks_json, []),
    invalidation: parseJson<string[]>(row.invalidation_json, []),
    firstSeenAt: stringValue(row.first_seen_at),
    lastSeenAt: stringValue(row.last_seen_at),
    validUntil: nullableString(row.valid_until),
    selectedAt: stringValue(row.selected_at),
    followed: numberValue(row.followed) === 1,
    dismissed: numberValue(row.dismissed) === 1,
    aiPending: numberValue(row.ai_pending) === 1,
    marketReaction: marketReactionValue(parseJson(row.market_reaction_json, null)),
    scoreAudit: {
      context: scoreContextValue(parseJson(row.score_context_json, null)),
      components: scoreComponentsValue(parseJson(row.score_components_json, null)),
      penalties: stringArrayValue(parseJson(row.score_penalties_json, [])),
    },
    claimEvidence: claimEvidenceValue(parseJson(row.claim_evidence_json, EMPTY_CLAIM_EVIDENCE)),
    evidence: evidenceByCluster.get(numberValue(row.id)) ?? [],
  }));
}

export function getOpportunityWorkerState(db: DatabaseSync, stateKey: string) {
  const row = db.prepare("SELECT state_value FROM opportunity_worker_state WHERE state_key = ?").get(stateKey);
  return row ? stringValue(row.state_value) : null;
}

export function setOpportunityWorkerState(db: DatabaseSync, stateKey: string, stateValue: string) {
  db.prepare(`
    INSERT INTO opportunity_worker_state(state_key, state_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      state_value = excluded.state_value,
      updated_at = excluded.updated_at
  `).run(stateKey, stateValue, nowIso());
}
