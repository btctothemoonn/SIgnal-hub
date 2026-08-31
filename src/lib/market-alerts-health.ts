export type MarketAlertHeartbeat = {
  worker: string;
  status: string;
  detail: string;
  meta: Record<string, unknown>;
  updatedAt: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
} | null;

const WORKER_STALE_AFTER_MS: Record<string, number> = {
  "volatility-ws": 90_000,
  "volatility-rest": 3 * 60_000,
  squeeze: 3 * 60_000,
};

export function getMarketAlertWorkerView(
  heartbeat: MarketAlertHeartbeat,
  nowMs = Date.now(),
) {
  if (!heartbeat) {
    return {
      online: false,
      label: "等待",
      tone: "warning" as const,
      stale: true,
      detail: "尚未收到心跳",
      lastError: null,
      lastErrorAt: null,
    };
  }

  const updatedAtMs = Date.parse(heartbeat.updatedAt);
  const staleAfterMs = WORKER_STALE_AFTER_MS[heartbeat.worker] ?? 3 * 60_000;
  const stale =
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(nowMs) ||
    nowMs - updatedAtMs > staleAfterMs;

  if (heartbeat.status === "error") {
    return {
      online: false,
      label: "错误",
      tone: "danger" as const,
      stale,
      detail: heartbeat.detail,
      lastError: heartbeat.lastError ?? heartbeat.detail,
      lastErrorAt: heartbeat.lastErrorAt ?? heartbeat.updatedAt,
    };
  }
  if (stale) {
    return {
      online: false,
      label: "心跳过期",
      tone: "warning" as const,
      stale: true,
      detail: heartbeat.detail,
      lastError: heartbeat.lastError ?? null,
      lastErrorAt: heartbeat.lastErrorAt ?? null,
    };
  }

  const online = heartbeat.status === "live";
  return {
    online,
    label: online ? "在线" : heartbeat.status || "启动中",
    tone: online ? ("success" as const) : ("warning" as const),
    stale: false,
    detail: heartbeat.detail,
    lastError: heartbeat.lastError ?? null,
    lastErrorAt: heartbeat.lastErrorAt ?? null,
  };
}
