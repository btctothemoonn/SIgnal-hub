import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getMarketAlertsSnapshot } from "./market-alerts-store.ts";
import {
  getMarketAlertWorkerView,
  type MarketAlertHeartbeat,
} from "./market-alerts-health.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import {
  getTelegramPipelineLatestUpdatedAt,
  getTelegramPipelineSnapshot,
} from "./telegram-pipeline-store.ts";
import {
  getXPipelineLatestUpdatedAt,
  getXPipelineSnapshot,
} from "./x-pipeline-store.ts";
import { getSignalHubSystemdServiceLabel } from "./signal-hub-services.ts";
import { getAlphaSummaryPeriod } from "./alpha-summary.ts";
import { getStocksPrewarmIntervalMs } from "./stocks-prewarm.ts";

type EnvLike = Record<string, string | undefined>;
type StocksSnapshotKind = "market" | "financial" | "catalysts";
type AlphaSummaryAudience = "signals" | "stocks";

export type SystemHealthStatus = "ok" | "unknown" | "warning" | "error";

export type SystemHealthItem = {
  id: string;
  label: string;
  status: SystemHealthStatus;
  detail: string;
  updatedAt: string | null;
  stale: boolean;
  meta?: Record<string, string | number | boolean | null>;
};

export type SystemHealthSnapshot = {
  generatedAt: string;
  status: SystemHealthStatus;
  items: SystemHealthItem[];
};

export type SystemdServiceState = {
  name: string;
  label?: string;
  activeState: string;
  detail?: string;
};

type CacheableStocksSnapshot = {
  generatedAt: string;
  source: "live" | "mock";
  provider: string;
  errors: string[];
};

const STOCKS_CACHE_CONFIG: Record<
  StocksSnapshotKind,
  { pathEnv: string; defaultFile: string }
> = {
  market: {
    pathEnv: "STOCKS_MARKET_CACHE_PATH",
    defaultFile: "stocks-market-snapshot.json",
  },
  financial: {
    pathEnv: "STOCKS_FINANCIAL_CACHE_PATH",
    defaultFile: "stocks-financial-snapshot.json",
  },
  catalysts: {
    pathEnv: "STOCKS_CATALYST_CACHE_PATH",
    defaultFile: "stocks-catalysts-snapshot.json",
  },
};

const DEFAULT_STALE_MS = {
  telegram: 15 * 60 * 1000,
  x: 15 * 60 * 1000,
  stocksMarket: 15 * 60 * 1000,
  stocksFinancial: 8 * 60 * 60 * 1000,
  stocksCatalysts: 45 * 60 * 1000,
  summary: 2 * 60 * 60 * 1000,
  tiger: 5 * 60 * 1000,
  marketAlerts: 3 * 60 * 1000,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseTime(value: string | null | undefined) {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isStale(updatedAt: string | null, now: Date, staleMs: number) {
  const updatedAtMs = parseTime(updatedAt);
  return !Number.isFinite(updatedAtMs) || now.getTime() - updatedAtMs > staleMs;
}

function ageLabel(updatedAt: string | null, now: Date) {
  const updatedAtMs = parseTime(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return "no timestamp";
  const minutes = Math.max(0, Math.round((now.getTime() - updatedAtMs) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function systemHealthStatusRank(status: SystemHealthStatus) {
  const rank: Record<SystemHealthStatus, number> = {
    ok: 0,
    unknown: 1,
    warning: 2,
    error: 3,
  };
  return rank[status];
}

export function buildSystemHealthSnapshot({
  generatedAt = new Date().toISOString(),
  items,
}: {
  generatedAt?: string;
  items: SystemHealthItem[];
}): SystemHealthSnapshot {
  const status = items.reduce<SystemHealthStatus>(
    (current, item) =>
      systemHealthStatusRank(item.status) > systemHealthStatusRank(current)
        ? item.status
        : current,
    "ok",
  );
  return { generatedAt, status, items };
}

export function summarizeCachedStocksSnapshot({
  id,
  label,
  kind,
  snapshot,
  now = new Date(),
  staleMs,
}: {
  id: string;
  label: string;
  kind: StocksSnapshotKind;
  snapshot: CacheableStocksSnapshot | null;
  now?: Date;
  staleMs: number;
}): SystemHealthItem {
  if (!snapshot) {
    return {
      id,
      label,
      status: "warning",
      detail: `${kind} cache missing`,
      updatedAt: null,
      stale: true,
      meta: { kind },
    };
  }

  const errors = Array.isArray(snapshot.errors) ? snapshot.errors.filter(Boolean) : [];
  const stale = isStale(snapshot.generatedAt, now, staleMs);
  const status: SystemHealthStatus =
    snapshot.source !== "live" || errors.length > 0 || stale ? "warning" : "ok";
  const parts = [
    `${snapshot.provider}/${snapshot.source}`,
    ageLabel(snapshot.generatedAt, now),
    stale ? "stale" : "",
    errors.length > 0 ? `${errors.length} errors` : "",
  ].filter(Boolean);

  return {
    id,
    label,
    status,
    detail: parts.join(" · "),
    updatedAt: snapshot.generatedAt,
    stale,
    meta: {
      kind,
      provider: snapshot.provider,
      source: snapshot.source,
      errorCount: errors.length,
    },
  };
}

export function summarizeServiceState(state: SystemdServiceState): SystemHealthItem {
  const activeState = state.activeState.trim() || "unknown";
  const status: SystemHealthStatus =
    activeState === "active"
      ? "ok"
      : activeState === "unknown"
        ? "unknown"
        : "error";

  return {
    id: `service-${state.name}`,
    label: state.label ?? getSignalHubSystemdServiceLabel(state.name),
    status,
    detail: [activeState, state.detail ?? ""].filter(Boolean).join(" · "),
    updatedAt: null,
    stale: false,
    meta: { service: state.name, activeState },
  };
}

export function summarizeMarketAlertsHeartbeat({
  id,
  label,
  heartbeat,
  now = new Date(),
  staleMs = DEFAULT_STALE_MS.marketAlerts,
}: {
  id: string;
  label: string;
  heartbeat: MarketAlertHeartbeat | null;
  now?: Date;
  staleMs?: number;
}): SystemHealthItem {
  if (!heartbeat) {
    return {
      id,
      label,
      status: "warning",
      detail: "worker heartbeat missing",
      updatedAt: null,
      stale: true,
    };
  }

  const view = getMarketAlertWorkerView(
    heartbeat,
    now.getTime(),
  );
  const fallbackStale = isStale(heartbeat.updatedAt, now, staleMs);
  const stale = view.stale || fallbackStale;
  const status: SystemHealthStatus =
    view.tone === "danger" ? "error" : view.online && !stale ? "ok" : "warning";
  return {
    id,
    label,
    status,
    detail: [
      view.detail || heartbeat.status,
      ageLabel(heartbeat.updatedAt, now),
      stale ? "stale" : "",
      view.lastError ? `last error: ${view.lastError}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    updatedAt: heartbeat.updatedAt,
    stale,
    meta: {
      worker: heartbeat.worker,
      workerStatus: heartbeat.status,
    },
  };
}

function healthErrorItem(id: string, label: string, error: unknown): SystemHealthItem {
  return {
    id,
    label,
    status: "error",
    detail: errorMessage(error),
    updatedAt: null,
    stale: true,
  };
}

function telegramHealthItem(now: Date): SystemHealthItem {
  try {
    const snapshot = getTelegramPipelineSnapshot(0);
    const updatedAt =
      getTelegramPipelineLatestUpdatedAt() ||
      snapshot.refresh?.finishedAt ||
      snapshot.refresh?.cacheFetchedAt ||
      null;
    const stale = isStale(updatedAt, now, DEFAULT_STALE_MS.telegram);
    const hasError = snapshot.status === "error" || snapshot.errors.length > 0;
    const status: SystemHealthStatus = hasError
      ? "error"
      : stale || !snapshot.isConnected
        ? "warning"
        : "ok";
    return {
      id: "telegram",
      label: "Telegram 采集",
      status,
      detail:
        snapshot.errors[0] ||
        `${snapshot.channels.length} channels · ${snapshot.status} · ${ageLabel(updatedAt, now)}`,
      updatedAt,
      stale,
      meta: {
        provider: snapshot.provider,
        mode: snapshot.mode,
        channelCount: snapshot.channels.length,
        connected: snapshot.isConnected,
      },
    };
  } catch (error) {
    return healthErrorItem("telegram", "Telegram 采集", error);
  }
}

function xHealthItem(now: Date): SystemHealthItem {
  try {
    const snapshot = getXPipelineSnapshot(0);
    const updatedAt = getXPipelineLatestUpdatedAt();
    const stale = isStale(updatedAt, now, DEFAULT_STALE_MS.x);
    const hasError = snapshot.status === "error" || snapshot.errors.length > 0;
    const status: SystemHealthStatus = hasError
      ? "error"
      : stale || !snapshot.isConnected
        ? "warning"
        : "ok";
    return {
      id: "x",
      label: "X 采集",
      status,
      detail:
        snapshot.errors[0] ||
        `${snapshot.watchAccounts.length} accounts · ${snapshot.status} · ${ageLabel(updatedAt, now)}`,
      updatedAt,
      stale,
      meta: {
        provider: snapshot.provider,
        accountCount: snapshot.watchAccounts.length,
        connected: snapshot.isConnected,
        pointsUsed: snapshot.usage?.pointsUsed ?? null,
      },
    };
  } catch (error) {
    return healthErrorItem("x", "X 采集", error);
  }
}

export function stocksHealthStaleMs(kind: StocksSnapshotKind, env: EnvLike) {
  const baseline = kind === "market" ? DEFAULT_STALE_MS.stocksMarket
    : kind === "financial" ? DEFAULT_STALE_MS.stocksFinancial : DEFAULT_STALE_MS.stocksCatalysts;
  return Math.max(baseline, getStocksPrewarmIntervalMs(kind, env) * 1.25);
}

async function stocksHealthItems(env: EnvLike, now: Date) {
  const market = readStocksCacheSnapshot("market", env);
  const financial = readStocksCacheSnapshot("financial", env);
  const catalysts = readStocksCacheSnapshot("catalysts", env);

  return [
    summarizeCachedStocksSnapshot({
      id: "stocks-market",
      label: "Stocks 行情",
      kind: "market",
      snapshot: market,
      now,
      staleMs: stocksHealthStaleMs("market", env),
    }),
    summarizeCachedStocksSnapshot({
      id: "stocks-financial",
      label: "Stocks 财报",
      kind: "financial",
      snapshot: financial,
      now,
      staleMs: stocksHealthStaleMs("financial", env),
    }),
    summarizeCachedStocksSnapshot({
      id: "stocks-catalysts",
      label: "Stocks 新闻/研报",
      kind: "catalysts",
      snapshot: catalysts,
      now,
      staleMs: stocksHealthStaleMs("catalysts", env),
    }),
  ];
}

function currentSummaryRows(dbPath: string, keys: string[]) {
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return db
      .prepare(
        `
        select period_key, model, item_count, status, error, generated_at, updated_at
        from alpha_summary_cache
        where period_key in (${keys.map(() => "?").join(",")})
      `,
      )
      .all(...keys) as Record<string, unknown>[];
  } finally {
    db?.close();
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function alphaSummaryDbPath(env: EnvLike, audience: AlphaSummaryAudience) {
  if (audience === "stocks") {
    return (
      env.STOCKS_SUMMARY_DB?.trim() ||
      getRuntimeDataPath(env, "stocks-summary.sqlite")
    );
  }
  return (
    env.SIGNAL_SUMMARY_DB?.trim() ||
    env.ALPHA_SUMMARY_DB?.trim() ||
    getRuntimeDataPath(env, "signal-summary.sqlite")
  );
}

export function summaryHealthItem({
  audience,
  label,
  env,
  now,
}: {
  audience: AlphaSummaryAudience;
  label: string;
  env: EnvLike;
  now: Date;
}): SystemHealthItem {
  const scopes = ["12h", "today", "3d", "7d"] as const;
  const periods = scopes.map((scope) => getAlphaSummaryPeriod({ scope, audience, now, env }));
  let rows: Record<string, unknown>[];
  try {
    rows = currentSummaryRows(alphaSummaryDbPath(env, audience), periods.map((period) => period.key));
  } catch (error) {
    return healthErrorItem(`summary-${audience}`, label, error);
  }
  const checks = periods.map((period) => {
    const row = rows.find((entry) => entry.period_key === period.key);
    const updatedAt = stringValue(row?.updated_at) || stringValue(row?.generated_at) || null;
    const stale = isStale(updatedAt, now, DEFAULT_STALE_MS.summary);
    const rowStatus = stringValue(row?.status) || "missing";
    const status: SystemHealthStatus = rowStatus === "error" ? "error"
      : !row || stale || !["generated", "empty"].includes(rowStatus) ? "warning" : "ok";
    return { row, updatedAt, stale, status, detail: [period.scope, rowStatus,
      ageLabel(updatedAt, now), stale ? "stale" : "", stringValue(row?.error)].filter(Boolean).join(": ") };
  });
  const worst = checks.reduce((current, check) =>
    systemHealthStatusRank(check.status) > systemHealthStatusRank(current.status) ? check : current);
  return {
    id: `summary-${audience}`,
    label,
    status: worst.status,
    detail: checks.map((check) => check.detail).join(" · "),
    updatedAt: worst.updatedAt,
    stale: checks.some((check) => check.stale),
    meta: {
      audience,
      model: stringValue(worst.row?.model),
      itemCount: checks.reduce((sum, check) => sum + numberValue(check.row?.item_count), 0),
      healthyScopes: checks.filter((check) => check.status === "ok").length,
      requiredScopes: scopes.length,
    },
  };
}

function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function stocksCachePath(kind: StocksSnapshotKind, env: EnvLike) {
  const config = STOCKS_CACHE_CONFIG[kind];
  return env[config.pathEnv]?.trim() || getRuntimeDataPath(env, config.defaultFile);
}

function readStocksCacheSnapshot(
  kind: StocksSnapshotKind,
  env: EnvLike,
): CacheableStocksSnapshot | null {
  const parsed = readJsonFile(stocksCachePath(kind, env));
  const record = recordValue(parsed);
  const generatedAt = stringValue(record.generatedAt);
  const source = stringValue(record.source);
  const provider = stringValue(record.provider);
  if (!generatedAt || !provider || (source !== "live" && source !== "mock")) {
    return null;
  }
  return {
    generatedAt,
    source,
    provider,
    errors: Array.isArray(record.errors)
      ? record.errors.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tigerHealthItem(env: EnvLike, now: Date): SystemHealthItem {
  const snapshotPath = getRuntimeDataPath(env, "tiger-holdings-snapshot.json");
  const fallbackPath = join(process.cwd(), ".signal-hub", "tiger-holdings-snapshot.json");
  const parsed = readJsonFile(snapshotPath) ?? readJsonFile(fallbackPath);
  const root = recordValue(parsed);
  const data = recordValue(root.data);
  const snapshot = recordValue(data.snapshot);
  const updatedAt =
    stringValue(snapshot.updatedAt) || stringValue(root.savedAt) || null;
  if (!parsed || !updatedAt) {
    return {
      id: "tiger-holdings",
      label: "老虎持仓",
      status: "warning",
      detail: "holding cache missing",
      updatedAt: null,
      stale: true,
    };
  }

  const positions = Array.isArray(snapshot.positions) ? snapshot.positions.length : 0;
  const stale = isStale(updatedAt, now, DEFAULT_STALE_MS.tiger);
  return {
    id: "tiger-holdings",
    label: "老虎持仓",
    status: stale ? "warning" : "ok",
    detail: `${positions} positions · ${ageLabel(updatedAt, now)}${stale ? " · stale" : ""}`,
    updatedAt,
    stale,
    meta: { positions },
  };
}

export async function getSystemHealthSnapshot({
  env = process.env,
  now = new Date(),
  serviceStates = [],
}: {
  env?: EnvLike;
  now?: Date;
  serviceStates?: SystemdServiceState[];
} = {}): Promise<SystemHealthSnapshot> {
  const stocksItems = await stocksHealthItems(env, now);
  let marketAlertItems: SystemHealthItem[];
  try {
    const marketAlerts = getMarketAlertsSnapshot({
      limit: 1,
      now: now.toISOString(),
    });
    marketAlertItems = [
      summarizeMarketAlertsHeartbeat({
        id: "market-volatility-ws",
        label: "暴涨暴跌实时流",
        heartbeat: marketAlerts.health.volatilityWs,
        now,
      }),
      summarizeMarketAlertsHeartbeat({
        id: "market-volatility-rest",
        label: "暴涨暴跌 REST",
        heartbeat: marketAlerts.health.volatilityRest,
        now,
      }),
      summarizeMarketAlertsHeartbeat({
        id: "market-squeeze",
        label: "轧空监控",
        heartbeat: marketAlerts.health.squeeze,
        now,
      }),
    ];
  } catch (error) {
    marketAlertItems = [healthErrorItem("market-alerts", "异动监控", error)];
  }
  const items: SystemHealthItem[] = [
    telegramHealthItem(now),
    xHealthItem(now),
    ...stocksItems,
    summaryHealthItem({ audience: "signals", label: "AI 总结(信号)", env, now }),
    summaryHealthItem({ audience: "stocks", label: "AI 总结(Stocks)", env, now }),
    tigerHealthItem(env, now),
    ...marketAlertItems,
    ...serviceStates.map(summarizeServiceState),
  ];

  return buildSystemHealthSnapshot({
    generatedAt: now.toISOString(),
    items,
  });
}
