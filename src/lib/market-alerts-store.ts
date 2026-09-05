import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import {
  rankTriggeredMarkets,
  shouldSendSqueezeAlert,
  transitionVolatilityState,
} from "./market-alerts-core.ts";
import type {
  MarketAlertType,
  VolatilitySide,
  VolatilitySignalState,
} from "./market-alerts-core.ts";
import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";
import type {
  MarketOpportunityDecision,
  MarketOpportunityMetrics,
} from "./market-opportunity-core.ts";
import type { MarketOpportunityCandidateState } from "./market-opportunity-selection.ts";

type DbValue = string | number | null;
type DbRow = Record<string, unknown>;

export type MarketAlertEventInput = {
  id?: string;
  type: MarketAlertType;
  symbol: string;
  side: VolatilitySide | null;
  level: number;
  stage: string;
  trigger: string;
  source: "ws" | "rest" | "squeeze";
  price: number;
  changePct: number | null;
  volumeRatio: number | null;
  score: number | null;
  metrics: Record<string, unknown>;
  reasons: string[];
  occurredAt: string;
  createdAt?: string;
  deliveryStatus?: "site" | "sent" | "failed" | "uncertain";
  telegramMessageId?: number | null;
};

export type MarketTickerInput = {
  symbol: string;
  price: number;
  pct24h: number;
  quoteVolume: number;
  updatedAt?: string;
};

export type MarketValuationInput = {
  symbol: string;
  marketCapUsd: number | null;
  fdvUsd: number | null;
};

export type MarketOpportunitySeed = {
  symbol: string;
  price: number;
  pct24h: number | null;
  quoteVolume: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  latestEventAt: string;
  maxLevel: number;
  maxAbsChangePct: number;
  maxVolumeRatio: number;
  active: boolean;
  alertCounts: {
    pump: number;
    crash: number;
    squeeze: number;
    total: number;
  };
  squeezeMetrics: Record<string, unknown> | null;
  preliminaryScore: number;
};

export type StoredOpportunityEnrichment = {
  symbol: string;
  metrics: MarketOpportunityMetrics;
  fetchedAt: string;
  stale: boolean;
  error: string | null;
  updatedAt: string;
};

export type MarketOpportunityAiItem = {
  symbol: string;
  summary: string;
  rationale: string;
  confirmation: string;
  invalidation: string;
  risk: string;
  validFor: string;
};

export type OpportunityAiPolicy = {
  allowed: boolean;
  reason: "allowed" | "unchanged" | "cooldown" | "hourly-cap";
  retryAt: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeChartSourceKey(value: string) {
  const sourceKey = value.trim();
  if (!/^\d{13}_\d{13}_[a-f0-9]{12}$/.test(sourceKey)) {
    throw new Error("Invalid market alert chart source key");
  }
  return sourceKey;
}

function normalizeChartSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  if (!/^[\p{L}\p{N}]{2,30}$/u.test(symbol)) {
    throw new Error("Invalid market alert chart symbol");
  }
  return symbol;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function run(statement: StatementSync, ...values: DbValue[]) {
  return statement.run(...values);
}

function rowToVolatilityState(row: DbRow | undefined): VolatilitySignalState | null {
  if (!row || numberValue(row.level) <= 0) return null;
  return {
    level: numberValue(row.level),
    firstAt: numberValue(row.first_at),
    lastSeenAt: numberValue(row.last_seen_at),
    strength: numberValue(row.strength),
  };
}

function rowToEvent(row: DbRow) {
  const chartUpdatedAt = stringValue(row.chart_updated_at) || null;
  const chartSourceKey = stringValue(row.chart_source_key) || null;
  const chartInterval = stringValue(row.chart_interval) || null;
  const chartQuery = chartUpdatedAt && chartSourceKey
    ? `v=${encodeURIComponent(chartSourceKey)}` +
      `&i=${encodeURIComponent(chartInterval || "unknown")}` +
      `&u=${encodeURIComponent(chartUpdatedAt)}`
    : null;
  return {
    id: stringValue(row.id),
    type: stringValue(row.type) as MarketAlertType,
    symbol: stringValue(row.symbol),
    side: (stringValue(row.side) || null) as VolatilitySide | null,
    level: numberValue(row.level),
    stage: stringValue(row.stage),
    trigger: stringValue(row.trigger),
    source: stringValue(row.source),
    price: numberValue(row.price),
    marketCapUsd: nullableNumber(row.market_cap_usd),
    fdvUsd: nullableNumber(row.fdv_usd),
    valuationUpdatedAt: stringValue(row.valuation_updated_at) || null,
    changePct: nullableNumber(row.change_pct),
    volumeRatio: nullableNumber(row.volume_ratio),
    score: nullableNumber(row.score),
    metrics: parseJson<Record<string, unknown>>(row.metrics_json, {}),
    reasons: parseJson<string[]>(row.reasons_json, []),
    deliveryStatus: stringValue(row.delivery_status),
    telegramMessageId: nullableNumber(row.telegram_message_id),
    chartUrl:
      chartQuery
        ? `/api/market-alerts/charts/${encodeURIComponent(stringValue(row.symbol))}?${chartQuery}`
        : null,
    chartInterval,
    chartUpdatedAt,
    occurredAt: stringValue(row.occurred_at),
    createdAt: stringValue(row.created_at),
  };
}

function rowToHeartbeat(row: DbRow | undefined) {
  if (!row) return null;
  return {
    worker: stringValue(row.worker),
    status: stringValue(row.status),
    detail: stringValue(row.detail),
    meta: parseJson<Record<string, unknown>>(row.meta_json, {}),
    updatedAt: stringValue(row.updated_at),
    lastError: stringValue(row.last_error) || null,
    lastErrorAt: stringValue(row.last_error_at) || null,
  };
}

function rowToOpportunityEnrichment(
  row: DbRow | undefined,
): StoredOpportunityEnrichment | null {
  if (!row) return null;
  const metrics = parseJson<MarketOpportunityMetrics | null>(row.metrics_json, null);
  if (!metrics) return null;
  return {
    symbol: stringValue(row.symbol),
    metrics,
    fetchedAt: stringValue(row.fetched_at),
    stale: numberValue(row.stale) === 1,
    error: stringValue(row.error) || null,
    updatedAt: stringValue(row.updated_at),
  };
}

function rowToOpportunityCandidate(row: DbRow) {
  return parseJson<MarketOpportunityCandidateState | null>(row.state_json, null);
}

function defaultDbPath() {
  return process.env.MARKET_ALERTS_DB?.trim() ||
    getRuntimeDataPath(process.env, "market-alerts", "alerts.sqlite");
}

export function openMarketAlertsStore(dbPath = defaultDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout=10000;");
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_volatility_state (
      key TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      strength REAL NOT NULL DEFAULT 0,
      recovery_since INTEGER NOT NULL DEFAULT 0,
      pending_owner TEXT,
      pending_until INTEGER NOT NULL DEFAULT 0,
      pending_next_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_squeeze_active (
      symbol TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 0,
      recovery_count INTEGER NOT NULL DEFAULT 0,
      last_alert_at INTEGER NOT NULL DEFAULT 0,
      last_score INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_squeeze_delivery_guard (
      symbol TEXT NOT NULL,
      level INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      detail TEXT,
      PRIMARY KEY (symbol, level)
    );
    CREATE TABLE IF NOT EXISTS market_alert_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT,
      level INTEGER NOT NULL,
      stage TEXT NOT NULL,
      trigger TEXT NOT NULL,
      source TEXT NOT NULL,
      price REAL NOT NULL,
      change_pct REAL,
      volume_ratio REAL,
      score REAL,
      metrics_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'site',
      telegram_message_id INTEGER,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_alert_events_time
      ON market_alert_events (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_alert_events_filter
      ON market_alert_events (type, symbol, level, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS market_alert_heartbeat (
      worker TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT,
      last_error_at TEXT
    );
    CREATE TABLE IF NOT EXISTS market_alert_tickers (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      pct_24h REAL NOT NULL,
      quote_volume REAL NOT NULL,
      market_cap_usd REAL,
      fdv_usd REAL,
      valuation_updated_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_alert_tickers_updated
      ON market_alert_tickers (updated_at DESC);
    CREATE TABLE IF NOT EXISTS market_alert_charts (
      symbol TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      interval TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_key TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_alert_charts_updated
      ON market_alert_charts (updated_at DESC);
    CREATE TABLE IF NOT EXISTS market_alert_chart_retry (
      symbol TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_alert_binance_rate_limit (
      id INTEGER PRIMARY KEY CHECK (id=1),
      next_request_at INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO market_alert_binance_rate_limit
      (id, next_request_at, blocked_until, updated_at)
      VALUES (1, 0, 0, '1970-01-01T00:00:00.000Z');
    CREATE TABLE IF NOT EXISTS market_opportunity_candidates (
      symbol TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_opportunity_enrichment (
      symbol TEXT PRIMARY KEY,
      metrics_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_opportunity_selection (
      rank INTEGER PRIMARY KEY CHECK(rank BETWEEN 1 AND 5),
      symbol TEXT NOT NULL UNIQUE,
      decision_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      selected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_opportunity_meta (
      id INTEGER PRIMARY KEY CHECK(id=1),
      fingerprint TEXT,
      last_scan_at TEXT,
      last_success_at TEXT,
      ai_fingerprint TEXT,
      ai_json TEXT,
      ai_provider TEXT,
      ai_generated_at TEXT,
      ai_error TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO market_opportunity_meta (id, updated_at)
      VALUES (1, '1970-01-01T00:00:00.000Z');
    CREATE TABLE IF NOT EXISTS market_opportunity_ai_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_opportunity_ai_runs_time
      ON market_opportunity_ai_runs (created_at DESC);
    CREATE TABLE IF NOT EXISTS market_opportunity_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_opportunity_diagnostics_time
      ON market_opportunity_diagnostics (created_at DESC);
  `);

  const heartbeatColumns = new Set(
    (db.prepare("PRAGMA table_info(market_alert_heartbeat)").all() as DbRow[]).map(
      (row) => stringValue(row.name),
    ),
  );
  if (!heartbeatColumns.has("last_error")) {
    db.exec("ALTER TABLE market_alert_heartbeat ADD COLUMN last_error TEXT;");
  }
  if (!heartbeatColumns.has("last_error_at")) {
    db.exec("ALTER TABLE market_alert_heartbeat ADD COLUMN last_error_at TEXT;");
  }
  const chartColumns = new Set(
    (db.prepare("PRAGMA table_info(market_alert_charts)").all() as DbRow[]).map(
      (row) => stringValue(row.name),
    ),
  );
  if (!chartColumns.has("source_key")) {
    db.exec("ALTER TABLE market_alert_charts ADD COLUMN source_key TEXT NOT NULL DEFAULT '';");
  }
  const tickerColumns = new Set(
    (db.prepare("PRAGMA table_info(market_alert_tickers)").all() as DbRow[]).map(
      (row) => stringValue(row.name),
    ),
  );
  if (!tickerColumns.has("market_cap_usd")) {
    db.exec("ALTER TABLE market_alert_tickers ADD COLUMN market_cap_usd REAL;");
  }
  if (!tickerColumns.has("fdv_usd")) {
    db.exec("ALTER TABLE market_alert_tickers ADD COLUMN fdv_usd REAL;");
  }
  if (!tickerColumns.has("valuation_updated_at")) {
    db.exec("ALTER TABLE market_alert_tickers ADD COLUMN valuation_updated_at TEXT;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_alert_revision (
      id INTEGER PRIMARY KEY CHECK (id=1),
      revision INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO market_alert_revision (id, revision) VALUES (1, 0);
  `);
  const revisionTables = [
    "market_volatility_state",
    "market_squeeze_active",
    "market_alert_events",
    "market_alert_heartbeat",
    "market_alert_tickers",
    "market_alert_charts",
    "market_opportunity_candidates",
    "market_opportunity_enrichment",
    "market_opportunity_selection",
    "market_opportunity_meta",
    "market_opportunity_ai_runs",
    "market_opportunity_diagnostics",
  ];
  for (const table of revisionTables) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS market_alert_revision_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table}
        BEGIN
          UPDATE market_alert_revision SET revision=revision+1 WHERE id=1;
        END;
      `);
    }
  }

  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  function withBusyRetry<T>(operation: () => T): T {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return operation();
      } catch (error) {
        lastError = error;
        const signature = `${(error as { code?: string })?.code ?? ""} ${String(error)}`;
        if (!/SQLITE_BUSY|database is locked/i.test(signature)) throw error;
        Atomics.wait(waitBuffer, 0, 0, 25 * (attempt + 1));
      }
    }
    throw lastError;
  }

  function transaction<T>(operation: () => T): T {
    return withBusyRetry(() => {
      db.exec("BEGIN IMMEDIATE;");
      try {
        const result = operation();
        db.exec("COMMIT;");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // The original database error is more useful than a rollback error.
        }
        throw error;
      }
    });
  }

  const volatilityGet = db.prepare("SELECT * FROM market_volatility_state WHERE key=?");
  const volatilityReserve = db.prepare(`
    INSERT INTO market_volatility_state (
      key, level, first_at, last_seen_at, strength, recovery_since,
      pending_owner, pending_until, pending_next_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      pending_owner=excluded.pending_owner,
      pending_until=excluded.pending_until,
      pending_next_json=excluded.pending_next_json,
      recovery_since=0,
      updated_at=excluded.updated_at
  `);
  const volatilityCommit = db.prepare(`
    UPDATE market_volatility_state SET
      level=?, first_at=?, last_seen_at=?, strength=?, recovery_since=0,
      pending_owner=NULL, pending_until=0, pending_next_json=NULL, updated_at=?
    WHERE key=? AND pending_owner=?
  `);
  const volatilityClearPending = db.prepare(`
    UPDATE market_volatility_state SET
      pending_owner=NULL, pending_until=0, pending_next_json=NULL, updated_at=?
    WHERE key=? AND pending_owner=?
  `);
  const volatilityDeleteEmpty = db.prepare(`
    DELETE FROM market_volatility_state
    WHERE key=? AND level=0 AND pending_owner IS NULL
  `);
  const volatilityDelete = db.prepare("DELETE FROM market_volatility_state WHERE key=?");
  const volatilityStartRecovery = db.prepare(`
    UPDATE market_volatility_state SET recovery_since=?, updated_at=?
    WHERE key=? AND recovery_since=0
  `);
  const volatilityResetRecovery = db.prepare(`
    UPDATE market_volatility_state SET recovery_since=0, updated_at=?
    WHERE key=? AND recovery_since<>0
  `);
  const volatilityObserve = db.prepare(`
    UPDATE market_volatility_state SET
      last_seen_at=?, strength=?, recovery_since=0, updated_at=?
    WHERE key=? AND level>0
  `);

  const squeezeActiveGet = db.prepare("SELECT * FROM market_squeeze_active WHERE symbol=?");
  const squeezeGuardBlocking = db.prepare(`
    SELECT 1 FROM market_squeeze_delivery_guard
    WHERE symbol=? AND status IN ('sending','uncertain') LIMIT 1
  `);
  const squeezeGuardDeleteStaleSending = db.prepare(`
    DELETE FROM market_squeeze_delivery_guard
    WHERE symbol=? AND status='sending' AND created_at<=?
  `);
  const squeezeGuardInsert = db.prepare(`
    INSERT INTO market_squeeze_delivery_guard (symbol, level, status, created_at)
    VALUES (?, ?, 'sending', ?)
  `);
  const squeezeEnsureActive = db.prepare(`
    INSERT INTO market_squeeze_active (
      symbol, level, recovery_count, last_alert_at, last_score, updated_at
    ) VALUES (?, 0, 0, ?, 0, ?)
    ON CONFLICT(symbol) DO NOTHING
  `);
  const squeezeMarkUncertain = db.prepare(`
    UPDATE market_squeeze_delivery_guard SET status='uncertain', detail=?
    WHERE symbol=? AND level=? AND status='sending'
  `);
  const squeezeCommitGuard = db.prepare(`
    UPDATE market_squeeze_delivery_guard SET status='sent', detail=NULL
    WHERE symbol=? AND level=?
  `);
  const squeezeReleaseGuard = db.prepare(`
    DELETE FROM market_squeeze_delivery_guard
    WHERE symbol=? AND level=? AND status='sending'
  `);
  const squeezeDeleteEmptyActive = db.prepare(`
    DELETE FROM market_squeeze_active
    WHERE symbol=? AND level=0
      AND NOT EXISTS (
        SELECT 1 FROM market_squeeze_delivery_guard WHERE symbol=?
      )
  `);
  const squeezeCommitActive = db.prepare(`
    INSERT INTO market_squeeze_active (
      symbol, level, recovery_count, last_alert_at, last_score, updated_at
    ) VALUES (?, ?, 0, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      level=excluded.level,
      recovery_count=0,
      last_alert_at=excluded.last_alert_at,
      last_score=excluded.last_score,
      updated_at=excluded.updated_at
  `);
  const squeezeDeleteActive = db.prepare("DELETE FROM market_squeeze_active WHERE symbol=?");
  const squeezeDeleteGuards = db.prepare(
    "DELETE FROM market_squeeze_delivery_guard WHERE symbol=?",
  );
  const squeezeUpdateRecovery = db.prepare(`
    UPDATE market_squeeze_active SET recovery_count=?, updated_at=? WHERE symbol=?
  `);

  const eventInsert = db.prepare(`
    INSERT OR IGNORE INTO market_alert_events (
      id, type, symbol, side, level, stage, trigger, source, price,
      change_pct, volume_ratio, score, metrics_json, reasons_json,
      delivery_status, telegram_message_id, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const heartbeatUpsert = db.prepare(`
    INSERT INTO market_alert_heartbeat (
      worker, status, detail, meta_json, updated_at, last_error, last_error_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(worker) DO UPDATE SET
      status=excluded.status,
      detail=excluded.detail,
      meta_json=excluded.meta_json,
      updated_at=excluded.updated_at,
      last_error=CASE
        WHEN excluded.last_error IS NOT NULL AND excluded.last_error<>'' THEN excluded.last_error
        ELSE market_alert_heartbeat.last_error
      END,
      last_error_at=CASE
        WHEN excluded.last_error IS NOT NULL AND excluded.last_error<>'' THEN excluded.last_error_at
        ELSE market_alert_heartbeat.last_error_at
      END
  `);
  const eventDeliveryUpdate = db.prepare(`
    UPDATE market_alert_events
    SET delivery_status=?, telegram_message_id=?
    WHERE id=?
  `);
  const tickerUpsert = db.prepare(`
    INSERT INTO market_alert_tickers (symbol, price, pct_24h, quote_volume, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      price=excluded.price,
      pct_24h=excluded.pct_24h,
      quote_volume=excluded.quote_volume,
      updated_at=excluded.updated_at
  `);
  const marketValuationUpdate = db.prepare(`
    UPDATE market_alert_tickers
    SET market_cap_usd=?, fdv_usd=?, valuation_updated_at=?
    WHERE symbol=?
  `);
  const chartUpsert = db.prepare(`
    INSERT INTO market_alert_charts (symbol, event_id, interval, updated_at, source_key)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      event_id=excluded.event_id,
      interval=excluded.interval,
      updated_at=excluded.updated_at,
      source_key=excluded.source_key
    WHERE excluded.source_key > market_alert_charts.source_key
      OR (
        excluded.source_key = market_alert_charts.source_key
        AND excluded.event_id = market_alert_charts.event_id
        AND excluded.interval = '15m'
        AND market_alert_charts.interval <> '15m'
      )
  `);
  const chartGet = db.prepare(`
    SELECT symbol, event_id, interval, updated_at, source_key
    FROM market_alert_charts WHERE symbol=?
  `);
  const chartDelete = db.prepare(`
    DELETE FROM market_alert_charts WHERE symbol=? AND source_key=?
  `);
  const chartRetryGet = db.prepare(`
    SELECT attempts FROM market_alert_chart_retry WHERE symbol=?
  `);
  const chartRetryUpsert = db.prepare(`
    INSERT INTO market_alert_chart_retry (symbol, attempts, next_attempt_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      attempts=excluded.attempts,
      next_attempt_at=excluded.next_attempt_at,
      updated_at=excluded.updated_at
  `);
  const chartRetryDelete = db.prepare(`
    DELETE FROM market_alert_chart_retry WHERE symbol=?
  `);
  const binanceRateLimitGet = db.prepare(`
    SELECT next_request_at, blocked_until
    FROM market_alert_binance_rate_limit WHERE id=1
  `);
  const binanceRateLimitUpdate = db.prepare(`
    UPDATE market_alert_binance_rate_limit
    SET next_request_at=?, blocked_until=?, updated_at=? WHERE id=1
  `);
  const opportunityEnrichmentGet = db.prepare(`
    SELECT * FROM market_opportunity_enrichment WHERE symbol=?
  `);
  const opportunityEnrichmentUpsert = db.prepare(`
    INSERT INTO market_opportunity_enrichment (
      symbol, metrics_json, fetched_at, stale, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      metrics_json=excluded.metrics_json,
      fetched_at=excluded.fetched_at,
      stale=excluded.stale,
      error=excluded.error,
      updated_at=excluded.updated_at
  `);
  const opportunityCandidateDeleteAll = db.prepare(
    "DELETE FROM market_opportunity_candidates",
  );
  const opportunityCandidateInsert = db.prepare(`
    INSERT INTO market_opportunity_candidates (symbol, state_json, updated_at)
    VALUES (?, ?, ?)
  `);
  const opportunitySelectionDeleteAll = db.prepare(
    "DELETE FROM market_opportunity_selection",
  );
  const opportunitySelectionInsert = db.prepare(`
    INSERT INTO market_opportunity_selection (
      rank, symbol, decision_json, fingerprint, selected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const opportunitySelectionUpdate = db.prepare(`
    UPDATE market_opportunity_selection
    SET decision_json=?, fingerprint=?, updated_at=?
    WHERE rank=? AND symbol=?
  `);
  const opportunityMetaGet = db.prepare(
    "SELECT * FROM market_opportunity_meta WHERE id=1",
  );
  const opportunityMetaSelectionUpdate = db.prepare(`
    UPDATE market_opportunity_meta SET
      fingerprint=?,
      last_scan_at=?,
      last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,
      updated_at=?
    WHERE id=1
  `);
  const opportunityAiAttemptInsert = db.prepare(`
    INSERT INTO market_opportunity_ai_runs (fingerprint, status, created_at)
    VALUES (?, 'attempted', ?)
  `);
  const opportunityAiRunsCount = db.prepare(`
    SELECT COUNT(*) AS value FROM market_opportunity_ai_runs WHERE created_at>=?
  `);
  const opportunityAiLatestRun = db.prepare(`
    SELECT created_at FROM market_opportunity_ai_runs
    ORDER BY created_at DESC LIMIT 1
  `);
  const opportunityAiResultUpdate = db.prepare(`
    UPDATE market_opportunity_meta SET
      ai_fingerprint=?, ai_json=?, ai_provider=?, ai_generated_at=?, ai_error=?, updated_at=?
    WHERE id=1 AND fingerprint=?
  `);
  const opportunityDiagnosticInsert = db.prepare(`
    INSERT INTO market_opportunity_diagnostics (symbol, detail_json, created_at)
    VALUES (?, ?, ?)
  `);
  const opportunityDiagnosticPrune = db.prepare(`
    DELETE FROM market_opportunity_diagnostics WHERE created_at<?
  `);

  function reserveVolatilityAlert(input: {
    key: string;
    strength: number;
    nowMs?: number;
    owner?: string;
    pendingTtlMs?: number;
  }) {
    const nowMs = input.nowMs ?? Date.now();
    const owner = input.owner ?? String(process.pid);
    const pendingTtlMs = input.pendingTtlMs ?? 5 * 60 * 1000;
    return transaction(() => {
      const row = volatilityGet.get(input.key) as DbRow | undefined;
      if (row?.pending_owner && numberValue(row.pending_until) > nowMs) {
        return { send: false, next: rowToVolatilityState(row), pending: true };
      }
      const previous = rowToVolatilityState(row);
      const decision = transitionVolatilityState(previous, {
        triggered: true,
        strength: input.strength,
        recovered: false,
        now: nowMs,
      });
      if (!decision.send) {
        if (decision.next && numberValue(row?.level) > 0) {
          run(
            volatilityObserve,
            decision.next.lastSeenAt,
            decision.next.strength,
            new Date(nowMs).toISOString(),
            input.key,
          );
        } else {
          run(volatilityResetRecovery, new Date(nowMs).toISOString(), input.key);
        }
        if (row?.pending_owner) {
          run(
            volatilityClearPending,
            new Date(nowMs).toISOString(),
            input.key,
            stringValue(row.pending_owner),
          );
          run(volatilityDeleteEmpty, input.key);
        }
        return decision;
      }
      const next = decision.next!;
      run(
        volatilityReserve,
        input.key,
        numberValue(row?.level),
        numberValue(row?.first_at),
        numberValue(row?.last_seen_at),
        numberValue(row?.strength),
        owner,
        nowMs + pendingTtlMs,
        JSON.stringify(next),
        new Date(nowMs).toISOString(),
      );
      return { ...decision, owner };
    });
  }

  function commitVolatilityAlert(
    key: string,
    owner: string,
    next: VolatilitySignalState | null,
  ) {
    if (!next) return false;
    const result = transaction(() =>
      run(
        volatilityCommit,
        next.level,
        next.firstAt,
        next.lastSeenAt,
        next.strength,
        new Date(next.lastSeenAt).toISOString(),
        key,
        owner,
      ),
    );
    return Number(result.changes) > 0;
  }

  function commitVolatilityAlertUncertain(
    key: string,
    owner: string,
    next: VolatilitySignalState | null,
    eventId: string,
  ) {
    if (!next) return false;
    return transaction(() => {
      const result = run(
        volatilityCommit,
        next.level,
        next.firstAt,
        next.lastSeenAt,
        next.strength,
        new Date(next.lastSeenAt).toISOString(),
        key,
        owner,
      );
      if (Number(result.changes) <= 0) return false;
      run(eventDeliveryUpdate, "uncertain", null, eventId);
      return true;
    });
  }

  function releaseVolatilityAlert(key: string, owner: string) {
    return transaction(() => {
      run(volatilityClearPending, nowIso(), key, owner);
      run(volatilityDeleteEmpty, key);
      return true;
    });
  }

  function recoverVolatilityAlert(
    key: string,
    nowMs = Date.now(),
    recoveryHoldMs = 15 * 60 * 1000,
  ) {
    return transaction(() => {
      const row = volatilityGet.get(key) as DbRow | undefined;
      if (!row) return false;
      if (row.pending_owner && numberValue(row.pending_until) > nowMs) return false;
      const recoverySince = numberValue(row.recovery_since);
      if (recoveryHoldMs > 0 && recoverySince <= 0) {
        run(volatilityStartRecovery, nowMs, new Date(nowMs).toISOString(), key);
        return false;
      }
      if (recoveryHoldMs > 0 && nowMs - recoverySince < recoveryHoldMs) return false;
      return Number(run(volatilityDelete, key).changes) > 0;
    });
  }

  function resetVolatilityRecovery(key: string, nowMs = Date.now()) {
    const result = withBusyRetry(() =>
      run(volatilityResetRecovery, new Date(nowMs).toISOString(), key),
    );
    return Number(result.changes) > 0;
  }

  function beginSqueezeDelivery(
    symbol: string,
    level: number,
    nowMs = Date.now(),
    pendingTtlMs = 5 * 60 * 1000,
  ) {
    return transaction(() => {
      run(squeezeGuardDeleteStaleSending, symbol, nowMs - pendingTtlMs);
      const active = squeezeActiveGet.get(symbol) as DbRow | undefined;
      if (!shouldSendSqueezeAlert(numberValue(active?.level), level)) return false;
      if (squeezeGuardBlocking.get(symbol)) return false;
      try {
        run(squeezeGuardInsert, symbol, level, nowMs);
      } catch (error) {
        if (/SQLITE_CONSTRAINT/i.test(String(error))) return false;
        throw error;
      }
      run(squeezeEnsureActive, symbol, nowMs, new Date(nowMs).toISOString());
      return true;
    });
  }

  function markSqueezeDeliveryUncertain(symbol: string, level: number, detail: string) {
    run(squeezeMarkUncertain, String(detail).slice(0, 500), symbol, level);
  }

  function commitSqueezeDeliveryUncertain(
    symbol: string,
    level: number,
    eventId: string,
    detail: string,
  ) {
    return transaction(() => {
      const result = run(
        squeezeMarkUncertain,
        String(detail).slice(0, 500),
        symbol,
        level,
      );
      if (Number(result.changes) <= 0) return false;
      run(eventDeliveryUpdate, "uncertain", null, eventId);
      return true;
    });
  }

  function commitSqueezeDeliverySuccess(
    symbol: string,
    level: number,
    score: number,
    nowMs = Date.now(),
  ) {
    transaction(() => {
      run(squeezeCommitGuard, symbol, level);
      run(
        squeezeCommitActive,
        symbol,
        level,
        nowMs,
        score,
        new Date(nowMs).toISOString(),
      );
    });
  }

  function releaseSqueezeDelivery(symbol: string, level: number) {
    return transaction(() => {
      const result = run(squeezeReleaseGuard, symbol, level);
      run(squeezeDeleteEmptyActive, symbol, symbol);
      return Number(result.changes) > 0;
    });
  }

  function clearSqueezeState(symbol: string) {
    transaction(() => {
      run(squeezeDeleteActive, symbol);
      run(squeezeDeleteGuards, symbol);
    });
  }

  function updateSqueezeRecovery(symbol: string, recovered: boolean) {
    return transaction(() => {
      const row = squeezeActiveGet.get(symbol) as DbRow | undefined;
      if (!row) return false;
      const count = recovered ? numberValue(row.recovery_count) + 1 : 0;
      if (count >= 3) {
        run(squeezeDeleteActive, symbol);
        run(squeezeDeleteGuards, symbol);
        return true;
      }
      run(squeezeUpdateRecovery, count, nowIso(), symbol);
      return false;
    });
  }

  function getTrackedSqueezeSignals() {
    return (db
      .prepare(`
        SELECT symbol, level, recovery_count, last_alert_at, last_score
        FROM market_squeeze_active ORDER BY last_alert_at DESC, symbol ASC
      `)
      .all() as DbRow[]).map((row) => ({
      symbol: stringValue(row.symbol),
      level: numberValue(row.level),
      recoveryCount: numberValue(row.recovery_count),
      lastAlertAt: numberValue(row.last_alert_at),
      lastScore: numberValue(row.last_score),
    }));
  }

  function insertMarketAlertEvent(input: MarketAlertEventInput) {
    const createdAt = input.createdAt ?? nowIso();
    const id = input.id ??
      `${input.type}:${input.side ?? "NA"}:${input.symbol}:${Date.parse(input.occurredAt)}:${randomUUID()}`;
    run(
      eventInsert,
      id,
      input.type,
      input.symbol,
      input.side,
      input.level,
      input.stage,
      input.trigger,
      input.source,
      input.price,
      input.changePct,
      input.volumeRatio,
      input.score,
      JSON.stringify(input.metrics),
      JSON.stringify(input.reasons),
      input.deliveryStatus ?? "site",
      input.telegramMessageId ?? null,
      input.occurredAt,
      createdAt,
    );
    const row = db.prepare("SELECT * FROM market_alert_events WHERE id=?").get(id) as DbRow;
    return rowToEvent(row);
  }

  function updateMarketAlertDelivery(
    id: string,
    status: "site" | "sent" | "failed" | "uncertain",
    telegramMessageId: number | null = null,
  ) {
    const result = withBusyRetry(() =>
      run(eventDeliveryUpdate, status, telegramMessageId, id),
    );
    return Number(result.changes) > 0;
  }

  function setMarketAlertsHeartbeat(input: {
    worker: string;
    status: string;
    detail: string;
    meta?: Record<string, unknown>;
    lastError?: string | null;
    now?: string;
  }) {
    const updatedAt = input.now ?? nowIso();
    const isError = input.status === "error";
    const lastError = input.lastError?.trim() || (isError ? input.detail : null);
    run(
      heartbeatUpsert,
      input.worker,
      input.status,
      input.detail,
      JSON.stringify(input.meta ?? {}),
      updatedAt,
      lastError,
      lastError ? updatedAt : null,
    );
  }

  function getRecentlyTriggeredSymbols(since: string) {
    return (
      db
        .prepare(`
          SELECT DISTINCT symbol FROM market_alert_events
          WHERE occurred_at>=? AND type IN ('volatility','short_squeeze')
          ORDER BY symbol ASC
        `)
        .all(since) as DbRow[]
    ).map((row) => stringValue(row.symbol));
  }

  function upsertMarketTickers(tickers: MarketTickerInput[]) {
    transaction(() => {
      for (const ticker of tickers) {
        run(
          tickerUpsert,
          ticker.symbol,
          ticker.price,
          ticker.pct24h,
          ticker.quoteVolume,
          ticker.updatedAt ?? nowIso(),
        );
      }
    });
  }

  function getMarketValuationRefreshCandidates(input: {
    triggeredSince: string;
    staleBefore: string;
    limit?: number;
  }) {
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 50)));
    return (
      db
        .prepare(`
          SELECT ticker.symbol, ticker.price
          FROM market_alert_tickers ticker
          WHERE EXISTS (
            SELECT 1 FROM market_alert_events event
            WHERE event.symbol=ticker.symbol
              AND event.occurred_at>=?
              AND event.type IN ('volatility','short_squeeze')
          )
            AND (
              ticker.valuation_updated_at IS NULL
              OR ticker.valuation_updated_at<?
            )
          ORDER BY COALESCE(ticker.valuation_updated_at, '') ASC, ticker.symbol ASC
          LIMIT ?
        `)
        .all(input.triggeredSince, input.staleBefore, limit) as DbRow[]
    ).map((row) => ({
      symbol: stringValue(row.symbol),
      price: numberValue(row.price),
    }));
  }

  function upsertMarketValuations(
    valuations: MarketValuationInput[],
    updatedAt = nowIso(),
  ) {
    transaction(() => {
      for (const valuation of valuations) {
        run(
          marketValuationUpdate,
          valuation.marketCapUsd,
          valuation.fdvUsd,
          updatedAt,
          valuation.symbol,
        );
      }
    });
  }

  function upsertMarketAlertChart(input: {
    symbol: string;
    eventId: string;
    interval: string;
    updatedAt?: string;
    sourceKey: string;
  }) {
    const symbol = normalizeChartSymbol(input.symbol);
    const updatedAt = input.updatedAt ?? nowIso();
    const sourceKey = normalizeChartSourceKey(input.sourceKey);
    return transaction(() => {
      const previous = chartGet.get(symbol) as DbRow | undefined;
      const result = run(
        chartUpsert,
        symbol,
        input.eventId,
        input.interval,
        updatedAt,
        sourceKey,
      );
      const current = chartGet.get(symbol) as DbRow | undefined;
      const accepted =
        Number(result.changes) > 0 ||
        (stringValue(current?.event_id) === input.eventId &&
          stringValue(current?.source_key) === sourceKey &&
          stringValue(current?.interval) === input.interval);
      const previousSourceKey = stringValue(previous?.source_key) || null;
      return {
        symbol,
        eventId: input.eventId,
        interval: input.interval,
        updatedAt,
        sourceKey,
        accepted,
        replacedSourceKey:
          accepted && previousSourceKey && previousSourceKey !== sourceKey
            ? previousSourceKey
            : null,
      };
    });
  }

  function getMarketAlertChart(symbolInput: string) {
    let symbol: string;
    try {
      symbol = normalizeChartSymbol(symbolInput);
    } catch {
      return null;
    }
    const row = chartGet.get(symbol) as DbRow | undefined;
    if (!row) return null;
    return {
      symbol: stringValue(row.symbol),
      eventId: stringValue(row.event_id),
      interval: stringValue(row.interval),
      updatedAt: stringValue(row.updated_at),
      sourceKey: stringValue(row.source_key),
    };
  }

  function deleteMarketAlertChart(symbolInput: string, sourceKeyInput: string) {
    let symbol: string;
    let sourceKey: string;
    try {
      symbol = normalizeChartSymbol(symbolInput);
      sourceKey = normalizeChartSourceKey(sourceKeyInput);
    } catch {
      return false;
    }
    return transaction(() => Number(run(chartDelete, symbol, sourceKey).changes) > 0);
  }

  function markMarketAlertChartRetry(symbolInput: string, nowMs = Date.now()) {
    const symbol = normalizeChartSymbol(symbolInput);
    return transaction(() => {
      const previous = chartRetryGet.get(symbol) as DbRow | undefined;
      const attempts = Math.min(16, numberValue(previous?.attempts) + 1);
      const retryMs = Math.min(6 * 60 * 60 * 1_000, 60_000 * 2 ** (attempts - 1));
      run(
        chartRetryUpsert,
        symbol,
        attempts,
        nowMs + retryMs,
        new Date(nowMs).toISOString(),
      );
      return { attempts, nextAttemptAt: nowMs + retryMs };
    });
  }

  function clearMarketAlertChartRetry(symbolInput: string) {
    const symbol = normalizeChartSymbol(symbolInput);
    return transaction(() => Number(run(chartRetryDelete, symbol).changes) > 0);
  }

  function getMarketAlertChartBackfillEvents(input: {
    since: string;
    symbols: string[];
    limit?: number;
    nowMs?: number;
  }) {
    const symbols = [...new Set(input.symbols.flatMap((value) => {
      try {
        return [normalizeChartSymbol(value)];
      } catch {
        return [];
      }
    }))];
    const limit = Math.min(50, Math.max(0, Math.floor(input.limit ?? 4)));
    if (!symbols.length || !limit) return [];
    const placeholders = symbols.map(() => "?").join(",");
    return (
      db.prepare(`
        SELECT ranked.*
        FROM (
          SELECT e.*,
            ROW_NUMBER() OVER (
              PARTITION BY e.symbol
              ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
            ) AS chart_rank
          FROM market_alert_events e
          WHERE e.occurred_at>=? AND e.symbol IN (${placeholders})
        ) ranked
        LEFT JOIN market_alert_charts c ON c.symbol=ranked.symbol
        LEFT JOIN market_alert_chart_retry retry ON retry.symbol=ranked.symbol
        WHERE ranked.chart_rank=1
          AND (c.symbol IS NULL OR c.interval<>'15m')
          AND COALESCE(retry.next_attempt_at, 0)<=?
        ORDER BY COALESCE(retry.updated_at, '') ASC,
          ranked.occurred_at DESC, ranked.created_at DESC
        LIMIT ?
      `).all(input.since, ...symbols, input.nowMs ?? Date.now(), limit) as DbRow[]
    ).map((row) => rowToEvent(row));
  }

  function reserveBinanceRequestSlot(input: {
    nowMs: number;
    spacingMs: number;
  }) {
    return transaction(() => {
      const row = binanceRateLimitGet.get() as DbRow | undefined;
      const readyAt = Math.max(
        input.nowMs,
        numberValue(row?.next_request_at),
        numberValue(row?.blocked_until),
      );
      run(
        binanceRateLimitUpdate,
        readyAt + Math.max(0, Math.floor(input.spacingMs)),
        numberValue(row?.blocked_until),
        new Date(input.nowMs).toISOString(),
      );
      return readyAt - input.nowMs;
    });
  }

  function deferBinanceRequests(untilMs: number) {
    return transaction(() => {
      const row = binanceRateLimitGet.get() as DbRow | undefined;
      run(
        binanceRateLimitUpdate,
        numberValue(row?.next_request_at),
        Math.max(numberValue(row?.blocked_until), untilMs),
        new Date().toISOString(),
      );
    });
  }

  function getBinanceRequestDelay(nowMs: number) {
    const row = binanceRateLimitGet.get() as DbRow | undefined;
    return Math.max(0, numberValue(row?.blocked_until) - nowMs);
  }

  function getOpportunitySeedData(input: {
    since: string;
    limit?: number;
  }): MarketOpportunitySeed[] {
    const rows = db.prepare(`
      SELECT
        e.type, e.symbol, e.side, e.level, e.price, e.change_pct,
        e.volume_ratio, e.metrics_json, e.occurred_at,
        t.price AS ticker_price, t.pct_24h, t.quote_volume,
        t.market_cap_usd, t.fdv_usd
      FROM market_alert_events e
      LEFT JOIN market_alert_tickers t ON t.symbol=e.symbol
      WHERE e.occurred_at>=?
        AND e.type IN ('volatility','short_squeeze')
      ORDER BY e.occurred_at DESC
      LIMIT 2000
    `).all(input.since) as DbRow[];
    const activeSymbols = new Set<string>();
    for (const row of db.prepare(
      "SELECT key FROM market_volatility_state WHERE level>0",
    ).all() as DbRow[]) {
      activeSymbols.add(stringValue(row.key).split(":").at(-1) ?? "");
    }
    for (const row of db.prepare(
      "SELECT symbol FROM market_squeeze_active WHERE level>0",
    ).all() as DbRow[]) {
      activeSymbols.add(stringValue(row.symbol));
    }

    const grouped = new Map<string, MarketOpportunitySeed>();
    for (const row of rows) {
      const symbol = stringValue(row.symbol).toUpperCase();
      if (!symbol) continue;
      const current = grouped.get(symbol) ?? {
        symbol,
        price: nullableNumber(row.ticker_price) ?? numberValue(row.price),
        pct24h: nullableNumber(row.pct_24h),
        quoteVolume: nullableNumber(row.quote_volume),
        marketCapUsd: nullableNumber(row.market_cap_usd),
        fdvUsd: nullableNumber(row.fdv_usd),
        latestEventAt: stringValue(row.occurred_at),
        maxLevel: 0,
        maxAbsChangePct: 0,
        maxVolumeRatio: 0,
        active: activeSymbols.has(symbol),
        alertCounts: { pump: 0, crash: 0, squeeze: 0, total: 0 },
        squeezeMetrics: null,
        preliminaryScore: 0,
      };
      const type = stringValue(row.type);
      if (type === "short_squeeze") {
        current.alertCounts.squeeze += 1;
        if (!current.squeezeMetrics) {
          current.squeezeMetrics = parseJson<Record<string, unknown>>(
            row.metrics_json,
            {},
          );
        }
      } else if (stringValue(row.side) === "SHORT") {
        current.alertCounts.crash += 1;
      } else {
        current.alertCounts.pump += 1;
      }
      current.alertCounts.total += 1;
      current.maxLevel = Math.max(current.maxLevel, numberValue(row.level));
      current.maxAbsChangePct = Math.max(
        current.maxAbsChangePct,
        Math.abs(numberValue(row.change_pct)),
      );
      current.maxVolumeRatio = Math.max(
        current.maxVolumeRatio,
        numberValue(row.volume_ratio),
      );
      grouped.set(symbol, current);
    }

    return [...grouped.values()]
      .map((seed) => ({
        ...seed,
        preliminaryScore:
          seed.maxLevel * 10 +
          seed.alertCounts.total * 5 +
          seed.alertCounts.squeeze * 10 +
          Math.min(25, seed.maxAbsChangePct) +
          Math.min(15, seed.maxVolumeRatio * 2) +
          (seed.active ? 8 : 0),
      }))
      .sort(
        (left, right) =>
          right.preliminaryScore - left.preliminaryScore ||
          right.latestEventAt.localeCompare(left.latestEventAt) ||
          left.symbol.localeCompare(right.symbol),
      )
      .slice(
        0,
        Math.min(
          MARKET_OPPORTUNITY_RULES.enrichmentLimit,
          Math.max(1, input.limit ?? MARKET_OPPORTUNITY_RULES.enrichmentLimit),
        ),
      );
  }

  function getOpportunityEnrichment(symbolInput: string) {
    const symbol = symbolInput.trim().toUpperCase();
    return rowToOpportunityEnrichment(
      opportunityEnrichmentGet.get(symbol) as DbRow | undefined,
    );
  }

  function upsertOpportunityEnrichment(input: {
    symbol: string;
    metrics: MarketOpportunityMetrics;
    fetchedAt: string;
    stale: boolean;
    error: string | null;
  }) {
    const symbol = input.symbol.trim().toUpperCase();
    run(
      opportunityEnrichmentUpsert,
      symbol,
      JSON.stringify(input.metrics),
      input.fetchedAt,
      input.stale ? 1 : 0,
      input.error,
      input.fetchedAt,
    );
    return getOpportunityEnrichment(symbol);
  }

  function getOpportunityCandidateStates() {
    return (db.prepare(`
      SELECT state_json FROM market_opportunity_candidates ORDER BY symbol
    `).all() as DbRow[])
      .map(rowToOpportunityCandidate)
      .filter((state): state is MarketOpportunityCandidateState => state !== null);
  }

  function replaceOpportunityCandidateStates(
    states: MarketOpportunityCandidateState[],
  ) {
    return transaction(() => {
      run(opportunityCandidateDeleteAll);
      for (const state of states) {
        run(
          opportunityCandidateInsert,
          state.symbol.trim().toUpperCase(),
          JSON.stringify(state),
          state.updatedAt,
        );
      }
      return states.length;
    });
  }

  function saveOpportunitySelection(input: {
    selected: MarketOpportunityDecision[];
    fingerprint: string;
    scannedAt: string;
    successful: boolean;
  }) {
    const selected = input.selected.slice(0, MARKET_OPPORTUNITY_RULES.outputLimit);
    return transaction(() => {
      const meta = opportunityMetaGet.get() as DbRow | undefined;
      const currentRows = db.prepare(`
        SELECT rank, symbol, selected_at FROM market_opportunity_selection ORDER BY rank
      `).all() as DbRow[];
      const sameMembers =
        currentRows.length === selected.length &&
        currentRows.every(
          (row, index) =>
            numberValue(row.rank) === index + 1 &&
            stringValue(row.symbol) === selected[index]?.symbol.toUpperCase(),
        );
      const changed =
        stringValue(meta?.fingerprint) !== input.fingerprint || !sameMembers;

      if (changed) {
        run(opportunitySelectionDeleteAll);
        selected.forEach((decision, index) => {
          run(
            opportunitySelectionInsert,
            index + 1,
            decision.symbol.toUpperCase(),
            JSON.stringify(decision),
            input.fingerprint,
            input.scannedAt,
            input.scannedAt,
          );
        });
      } else {
        selected.forEach((decision, index) => {
          run(
            opportunitySelectionUpdate,
            JSON.stringify(decision),
            input.fingerprint,
            input.scannedAt,
            index + 1,
            decision.symbol.toUpperCase(),
          );
        });
      }
      run(
        opportunityMetaSelectionUpdate,
        input.fingerprint,
        input.scannedAt,
        input.successful ? 1 : 0,
        input.scannedAt,
        input.scannedAt,
      );
      return { changed, count: selected.length };
    });
  }

  function getOpportunityAiPolicy(input: {
    fingerprint: string;
    nowMs?: number;
  }): OpportunityAiPolicy {
    const nowMs = input.nowMs ?? Date.now();
    const meta = opportunityMetaGet.get() as DbRow | undefined;
    if (
      stringValue(meta?.ai_fingerprint) === input.fingerprint &&
      stringValue(meta?.ai_json)
    ) {
      return { allowed: false, reason: "unchanged", retryAt: null };
    }
    const hourStart = new Date(nowMs - 60 * 60_000).toISOString();
    const hourlyCount = numberValue(
      (opportunityAiRunsCount.get(hourStart) as DbRow | undefined)?.value,
    );
    if (hourlyCount >= MARKET_OPPORTUNITY_RULES.aiHourlyLimit) {
      const retryAt = new Date(nowMs + 10 * 60_000).toISOString();
      return { allowed: false, reason: "hourly-cap", retryAt };
    }
    const latestRun = opportunityAiLatestRun.get() as DbRow | undefined;
    const latestRunMs = Date.parse(stringValue(latestRun?.created_at));
    if (
      Number.isFinite(latestRunMs) &&
      nowMs - latestRunMs < MARKET_OPPORTUNITY_RULES.aiCooldownMs
    ) {
      return {
        allowed: false,
        reason: "cooldown",
        retryAt: new Date(
          latestRunMs + MARKET_OPPORTUNITY_RULES.aiCooldownMs,
        ).toISOString(),
      };
    }
    return { allowed: true, reason: "allowed", retryAt: null };
  }

  function recordOpportunityAiAttempt(input: {
    fingerprint: string;
    createdAt?: string;
  }) {
    const createdAt = input.createdAt ?? nowIso();
    return run(opportunityAiAttemptInsert, input.fingerprint, createdAt).changes > 0;
  }

  function saveOpportunityAiResult(input: {
    fingerprint: string;
    items: MarketOpportunityAiItem[] | null;
    provider: string | null;
    generatedAt: string;
    error: string | null;
  }) {
    return run(
      opportunityAiResultUpdate,
      input.fingerprint,
      input.items ? JSON.stringify(input.items) : null,
      input.provider,
      input.generatedAt,
      input.error,
      input.generatedAt,
      input.fingerprint,
    ).changes > 0;
  }

  function recordOpportunityDiagnostic(input: {
    symbol?: string | null;
    detail: Record<string, unknown>;
    createdAt?: string;
  }) {
    const createdAt = input.createdAt ?? nowIso();
    return run(
      opportunityDiagnosticInsert,
      input.symbol?.trim().toUpperCase() || null,
      JSON.stringify(input.detail),
      createdAt,
    ).changes > 0;
  }

  function pruneOpportunityDiagnostics(before: string) {
    return Number(run(opportunityDiagnosticPrune, before).changes);
  }

  function getMarketAlertsSnapshot(options: {
    limit?: number;
    page?: number;
    type?: MarketAlertType | null;
    symbol?: string | null;
    level?: number | null;
    from?: string | null;
    to?: string | null;
    now?: string;
    tickerMaxAgeMs?: number;
  } = {}) {
    const limit = Math.min(200, Math.max(1, options.limit ?? 80));
    const page = Math.max(1, options.page ?? 1);
    const where: string[] = [];
    const values: DbValue[] = [];
    if (options.type) {
      where.push("e.type=?");
      values.push(options.type);
    }
    if (options.symbol) {
      where.push("e.symbol=?");
      values.push(options.symbol.toUpperCase());
    }
    if (options.level) {
      where.push("e.level=?");
      values.push(options.level);
    }
    if (options.from) {
      where.push("e.occurred_at>=?");
      values.push(options.from);
    }
    if (options.to) {
      where.push("e.occurred_at<=?");
      values.push(options.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const events = db
      .prepare(`
        SELECT e.*, c.interval AS chart_interval,
          c.updated_at AS chart_updated_at, c.source_key AS chart_source_key,
          t.market_cap_usd, t.fdv_usd, t.valuation_updated_at
        FROM market_alert_events e
        LEFT JOIN market_alert_charts c ON c.symbol=e.symbol
        LEFT JOIN market_alert_tickers t ON t.symbol=e.symbol
        ${whereSql}
        ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ? OFFSET ?
      `)
      .all(...values, limit, (page - 1) * limit)
      .map((row) => rowToEvent(row as DbRow));
    const total = numberValue(
      (db.prepare(`SELECT COUNT(*) AS value FROM market_alert_events e ${whereSql}`).get(
        ...values,
      ) as DbRow).value,
    );
    const volatilityActive = db
      .prepare("SELECT * FROM market_volatility_state WHERE level>0 ORDER BY last_seen_at DESC")
      .all()
      .map((row) => ({
        kind: "volatility" as const,
        key: stringValue((row as DbRow).key),
        symbol: stringValue((row as DbRow).key).split(":").at(-1) ?? "",
        side: stringValue((row as DbRow).key).startsWith("SHORT:") ? "SHORT" : "LONG",
        level: numberValue((row as DbRow).level),
        strength: numberValue((row as DbRow).strength),
        updatedAt: new Date(numberValue((row as DbRow).last_seen_at)).toISOString(),
      }));
    const squeezeActive = db
      .prepare("SELECT * FROM market_squeeze_active WHERE level>0 ORDER BY last_alert_at DESC")
      .all()
      .map((row) => ({
        kind: "short_squeeze" as const,
        key: `SQUEEZE:${stringValue((row as DbRow).symbol)}`,
        symbol: stringValue((row as DbRow).symbol),
        side: "LONG",
        level: numberValue((row as DbRow).level),
        score: numberValue((row as DbRow).last_score),
        updatedAt: stringValue((row as DbRow).updated_at),
      }));
    const heartbeatRows = db.prepare("SELECT * FROM market_alert_heartbeat").all() as DbRow[];
    const heartbeatByWorker = new Map(
      heartbeatRows.map((row) => [stringValue(row.worker), rowToHeartbeat(row)]),
    );
    const rankingSince = new Date(
      Date.parse(options.now ?? nowIso()) - 24 * 60 * 60 * 1000,
    ).toISOString();
    const rankingEvents = db
      .prepare(`
        SELECT type, symbol, side, occurred_at FROM market_alert_events
        WHERE occurred_at>=? ORDER BY occurred_at DESC
      `)
      .all(rankingSince)
      .map((row) => ({
        type: stringValue((row as DbRow).type) as MarketAlertType,
        symbol: stringValue((row as DbRow).symbol),
        side: (stringValue((row as DbRow).side) || null) as VolatilitySide | null,
        occurredAt: stringValue((row as DbRow).occurred_at),
      }));
    const tickers = db
      .prepare("SELECT * FROM market_alert_tickers")
      .all()
      .map((row) => ({
        symbol: stringValue((row as DbRow).symbol),
        price: numberValue((row as DbRow).price),
        pct24h: numberValue((row as DbRow).pct_24h),
        quoteVolume: numberValue((row as DbRow).quote_volume),
        marketCapUsd: nullableNumber((row as DbRow).market_cap_usd),
        fdvUsd: nullableNumber((row as DbRow).fdv_usd),
        updatedAt: stringValue((row as DbRow).updated_at),
      }));
    const opportunityMetaRow = opportunityMetaGet.get() as DbRow | undefined;
    const opportunityFingerprint = stringValue(opportunityMetaRow?.fingerprint) || null;
    const opportunityAiFingerprint =
      stringValue(opportunityMetaRow?.ai_fingerprint) || null;
    const opportunityAiItems =
      opportunityFingerprint && opportunityAiFingerprint === opportunityFingerprint
        ? parseJson<MarketOpportunityAiItem[]>(opportunityMetaRow?.ai_json, [])
        : [];
    const aiBySymbol = new Map(
      opportunityAiItems.map((item) => [item.symbol.toUpperCase(), item]),
    );
    const opportunities = (db.prepare(`
      SELECT * FROM market_opportunity_selection ORDER BY rank
    `).all() as DbRow[])
      .map((row) => {
        const decision = parseJson<MarketOpportunityDecision | null>(
          row.decision_json,
          null,
        );
        if (!decision) return null;
        return {
          ...decision,
          rank: numberValue(row.rank),
          selectedAt: stringValue(row.selected_at),
          updatedAt: stringValue(row.updated_at),
          ai: aiBySymbol.get(decision.symbol.toUpperCase()) ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const opportunityLastSuccessAt =
      stringValue(opportunityMetaRow?.last_success_at) || null;
    const opportunityLastSuccessMs = Date.parse(opportunityLastSuccessAt ?? "");
    const snapshotNowMs = Date.parse(options.now ?? nowIso());
    const opportunityStale =
      opportunities.length > 0 &&
      (!Number.isFinite(opportunityLastSuccessMs) ||
        !Number.isFinite(snapshotNowMs) ||
        snapshotNowMs - opportunityLastSuccessMs > 3 * 60_000);
    const latestUpdatedAt = stringValue(
      (db.prepare(`
        SELECT MAX(value) AS value FROM (
          SELECT MAX(created_at) AS value FROM market_alert_events
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_heartbeat
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_tickers
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_charts
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_enrichment
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_selection
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_meta
        )
      `).get() as DbRow).value,
    );
    return {
      generatedAt: options.now ?? nowIso(),
      latestUpdatedAt,
      events,
      total,
      page,
      limit,
      activeSignals: [...volatilityActive, ...squeezeActive],
      opportunities,
      opportunityMeta: {
        fingerprint: opportunityFingerprint,
        lastScanAt: stringValue(opportunityMetaRow?.last_scan_at) || null,
        lastSuccessAt: opportunityLastSuccessAt,
        stale: opportunityStale,
        aiProvider: stringValue(opportunityMetaRow?.ai_provider) || null,
        aiGeneratedAt: stringValue(opportunityMetaRow?.ai_generated_at) || null,
        aiError: stringValue(opportunityMetaRow?.ai_error) || null,
      },
      marketRanking: rankTriggeredMarkets({
        events: rankingEvents,
        tickers,
        since: rankingSince,
        now: options.now ?? nowIso(),
        maxTickerAgeMs: options.tickerMaxAgeMs ?? 15 * 60 * 1000,
        limit: 20,
      }),
      health: {
        volatilityWs: heartbeatByWorker.get("volatility-ws") ?? null,
        volatilityRest: heartbeatByWorker.get("volatility-rest") ?? null,
        squeeze: heartbeatByWorker.get("squeeze") ?? null,
        opportunity: heartbeatByWorker.get("opportunity") ?? null,
      },
    };
  }

  function getMarketAlertsLatestUpdatedAt() {
    return stringValue(
      (db.prepare(`
        SELECT MAX(value) AS value FROM (
          SELECT MAX(created_at) AS value FROM market_alert_events
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_heartbeat
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_tickers
          UNION ALL SELECT MAX(updated_at) AS value FROM market_alert_charts
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_enrichment
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_selection
          UNION ALL SELECT MAX(updated_at) AS value FROM market_opportunity_meta
        )
      `).get() as DbRow).value,
    );
  }

  function getMarketAlertsRevision() {
    return numberValue(
      (db.prepare("SELECT revision AS value FROM market_alert_revision WHERE id=1").get() as DbRow)
        .value,
    );
  }

  return {
    reserveVolatilityAlert,
    commitVolatilityAlert,
    commitVolatilityAlertUncertain,
    releaseVolatilityAlert,
    recoverVolatilityAlert,
    resetVolatilityRecovery,
    beginSqueezeDelivery,
    markSqueezeDeliveryUncertain,
    commitSqueezeDeliveryUncertain,
    commitSqueezeDeliverySuccess,
    releaseSqueezeDelivery,
    clearSqueezeState,
    updateSqueezeRecovery,
    getTrackedSqueezeSignals,
    insertMarketAlertEvent,
    updateMarketAlertDelivery,
    setMarketAlertsHeartbeat,
    upsertMarketTickers,
    getMarketValuationRefreshCandidates,
    upsertMarketValuations,
    upsertMarketAlertChart,
    getMarketAlertChart,
    deleteMarketAlertChart,
    markMarketAlertChartRetry,
    clearMarketAlertChartRetry,
    getMarketAlertChartBackfillEvents,
    reserveBinanceRequestSlot,
    deferBinanceRequests,
    getBinanceRequestDelay,
    getRecentlyTriggeredSymbols,
    getOpportunitySeedData,
    getOpportunityEnrichment,
    upsertOpportunityEnrichment,
    getOpportunityCandidateStates,
    replaceOpportunityCandidateStates,
    saveOpportunitySelection,
    getOpportunityAiPolicy,
    recordOpportunityAiAttempt,
    saveOpportunityAiResult,
    recordOpportunityDiagnostic,
    pruneOpportunityDiagnostics,
    getMarketAlertsSnapshot,
    getMarketAlertsLatestUpdatedAt,
    getMarketAlertsRevision,
    close() {
      db.close();
    },
  };
}

export function getMarketAlertsSnapshot(
  options?: Parameters<ReturnType<typeof openMarketAlertsStore>["getMarketAlertsSnapshot"]>[0],
) {
  const store = openMarketAlertsStore();
  try {
    return store.getMarketAlertsSnapshot(options);
  } finally {
    store.close();
  }
}

export function getMarketAlertsLatestUpdatedAt() {
  const store = openMarketAlertsStore();
  try {
    return store.getMarketAlertsLatestUpdatedAt();
  } finally {
    store.close();
  }
}

export function getMarketAlertsRevision() {
  const store = openMarketAlertsStore();
  try {
    return store.getMarketAlertsRevision();
  } finally {
    store.close();
  }
}
