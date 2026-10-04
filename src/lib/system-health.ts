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
import { getSignalHubSystemdServiceLabel, isSignalHubServiceEnabled } from "./signal-hub-services.ts";
import { getWebPushConfig } from "./web-push-config.ts";
import type { WorkerHealth } from "./web-push-store.ts";
import { getAlphaSummaryPeriod, getAlphaSummaryRefreshIntervalMs } from "./alpha-summary.ts";
import { getAlphaSummaryPrewarmIntervalMs } from "./alpha-summary-prewarm.ts";
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

type XOwnedCoverageHealthInput = {
  enabled: boolean;
  accounts: {
    username: string;
    route: string;
    lastSuccessfulCheckAt: string | null;
    status: string;
    stale?: boolean;
    replyCoverageComplete?: boolean | null;
    subscriberContentExcluded?: number;
  }[];
};

export function summarizeXOwnedReaderCoverage({
  snapshot, now = new Date(),
}: {
  snapshot: XOwnedCoverageHealthInput;
  now?: Date;
}): SystemHealthItem | null {
  if (!snapshot.enabled) return null;
  const assigned = snapshot.accounts.filter(account => account.route === "owned-reader");
  const staleCount = assigned.filter(account => account.stale || isStale(account.lastSuccessfulCheckAt, now, 10 * 60_000)).length;
  const failedCount = assigned.filter(account => ["error", "paused", "failed"].includes(account.status)).length;
  const incompleteCount = assigned.filter(account => account.status === "incomplete").length;
  const replyIncomplete = assigned.filter(account => account.replyCoverageComplete !== true).length;
  const subscriberContentExcluded = assigned.reduce((sum, account) => sum + Math.max(0, account.subscriberContentExcluded || 0), 0);
  const successfulTimes = assigned.map(account => account.lastSuccessfulCheckAt).filter((value): value is string => Boolean(value));
  const oldest = successfulTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const detail = failedCount ? `自有补采异常或暂停：${failedCount}/${assigned.length} 位`
    : !assigned.length ? "自有补采已启用，尚未分配博主"
    : staleCount ? `自有补采检查逾期或尚未完成：${staleCount}/${assigned.length} 位`
    : incompleteCount ? `自有补采检查不完整：${incompleteCount}/${assigned.length} 位`
    : `自有补采试运行：${assigned.length} 位公开主帖与引用检查正常`;
  return {
    id: "x-owned-reader", label: "X VPS 采集",
    status: failedCount ? "error" : staleCount || incompleteCount || subscriberContentExcluded || !assigned.length ? "warning" : "ok",
    detail: detail + (replyIncomplete ? ` · ${replyIncomplete} 位回复覆盖待确认` : "") + (subscriberContentExcluded ? ` · ${subscriberContentExcluded} 条付费订阅正文未覆盖` : ""),
    updatedAt: successfulTimes.length === assigned.length ? oldest : null,
    stale: staleCount > 0,
    meta: { trial: true, accountCount: assigned.length, staleCount, failedCount, incompleteCount, replyIncomplete, subscriberContentExcluded },
  };
}

async function ownedReaderHealthItem(env: EnvLike, now: Date) {
  if (!isSignalHubServiceEnabled("signal-hub-x-owned-reader", env)) return null;
  try {
    const [{ loadRuntimeConfig }, { getXPipelineConfiguredAccounts }, { getXAccountCoverageSnapshot }] = await Promise.all([
      import("./runtime-config.ts"), import("./x-pipeline-accounts.ts"), import("./x-owned-reader-state.ts"),
    ]);
    const accounts = getXPipelineConfiguredAccounts(await loadRuntimeConfig(), env as NodeJS.ProcessEnv);
    const snapshot = getXAccountCoverageSnapshot(accounts.map(account => account.username), undefined, env, now.getTime());
    return summarizeXOwnedReaderCoverage({ snapshot, now });
  } catch {
    return { id: "x-owned-reader", label: "X VPS 采集", status: "error" as const, detail: "无法读取 VPS 采集状态", updatedAt: null, stale: true };
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
    const staleMs = Math.max(DEFAULT_STALE_MS.summary,
      getAlphaSummaryRefreshIntervalMs(env, period.scope) + getAlphaSummaryPrewarmIntervalMs(env));
    const stale = isStale(updatedAt, now, staleMs);
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

export function webPushHealthItem(env: EnvLike = process.env, now = new Date()): SystemHealthItem {
  const config = getWebPushConfig(env);
  const base = { id: "web-push", label: "重要通知", updatedAt: null, stale: false };
  if (!config.enabled) return { ...base, status: "ok", detail: "未启用", meta: { enabled: false } };
  if (!config.configured) return { ...base, status: "error", detail: "通知服务配置不完整", meta: { enabled: true, errorCode: config.errorCode } };
  const path = getRuntimeDataPath(env, "web-push.sqlite");
  if (!existsSync(path)) return { ...base, status: "warning", stale: true, detail: "等待通知进程心跳" };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare("SELECT health_json FROM push_worker_health WHERE id=1").get() as { health_json: string } | undefined;
    const health = row ? JSON.parse(row.health_json) as WorkerHealth : null;
    if (!health) return { ...base, status: "warning", stale: true, detail: "等待通知进程心跳" };
    const time = Date.parse(health.updatedAt); const stale = !Number.isFinite(time) || now.getTime() - time > 30000 || time > now.getTime() + 1000;
    const meta: Record<string, string | number | boolean | null> = { enabled: true };
    for (const key of ['pending', 'sending', 'retry', 'sent', 'expired']) if (Number.isFinite(health.counts[key])) meta[key] = health.counts[key];
    const errorCode = health.errorCode && /^push_[a-z_]+$/.test(health.errorCode) ? health.errorCode : null;
    if (errorCode) meta.errorCode = errorCode;
    return { ...base, updatedAt: health.updatedAt, stale, status: health.status === 'error' ? 'error' : stale || health.status !== 'live' ? 'warning' : 'ok', detail: health.status === 'error' ? '通知发送异常，请检查服务器配置' : stale ? '通知进程心跳已过期' : health.status === 'live' ? '通知进程运行中' : '等待通知进程就绪', meta };
  } catch { return { ...base, status: "error", detail: "无法读取通知进程状态" }; }
  finally { db?.close(); }
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
  const ownedReader = await ownedReaderHealthItem(env, now);
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
    ...(ownedReader ? [ownedReader] : []),
    ...stocksItems,
    summaryHealthItem({ audience: "signals", label: "AI 总结(信号)", env, now }),
    summaryHealthItem({ audience: "stocks", label: "AI 总结(Stocks)", env, now }),
    tigerHealthItem(env, now),
    ...marketAlertItems,
    webPushHealthItem(env, now),
    ...serviceStates.filter(service => isSignalHubServiceEnabled(service.name, env)).map(summarizeServiceState),
  ];

  return buildSystemHealthSnapshot({
    generatedAt: now.toISOString(),
    items,
  });
}
