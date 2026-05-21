"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SystemHealthStatus = "ok" | "unknown" | "warning" | "error";

type SystemHealthItem = {
  id: string;
  label: string;
  status: SystemHealthStatus;
  detail: string;
  updatedAt: string | null;
  stale: boolean;
  meta?: Record<string, string | number | boolean | null>;
};

type SystemHealthSnapshot = {
  generatedAt: string;
  status: SystemHealthStatus;
  items: SystemHealthItem[];
};

function statusLabel(status: SystemHealthStatus) {
  if (status === "ok") return "正常";
  if (status === "warning") return "注意";
  if (status === "error") return "故障";
  return "未知";
}

function statusClass(status: SystemHealthStatus) {
  if (status === "ok") return "border-success/35 bg-success-soft text-success";
  if (status === "warning") return "border-warning/35 bg-warning-soft text-warning";
  if (status === "error") return "border-danger/35 bg-danger-soft text-danger";
  return "border-line/70 bg-panel text-muted";
}

function formatTime(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function metaChips(meta: SystemHealthItem["meta"]) {
  if (!meta) return [];
  return Object.entries(meta)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
}

export function SystemHealthPanel() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/system-health", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot((await response.json()) as SystemHealthSnapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const grouped = useMemo(() => {
    const items = snapshot?.items ?? [];
    return {
      errors: items.filter((item) => item.status === "error"),
      warnings: items.filter((item) => item.status === "warning"),
      healthy: items.filter((item) => item.status === "ok" || item.status === "unknown"),
    };
  }, [snapshot]);

  return (
    <div className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-48px_rgba(38,31,27,0.55)]">
      <div className="flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">信息健康中心</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            只读取本地缓存、SQLite 和 systemd 状态，用来判断后台采集是否掉线。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {snapshot ? (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(
                snapshot.status,
              )}`}
            >
              {statusLabel(snapshot.status)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-line/70 bg-panel px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
          >
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-sm text-muted">加载中...</p>
      ) : error ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-danger">
              <div className="text-lg font-semibold">{grouped.errors.length}</div>
              <div>故障</div>
            </div>
            <div className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-warning">
              <div className="text-lg font-semibold">{grouped.warnings.length}</div>
              <div>注意</div>
            </div>
            <div className="rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-success">
              <div className="text-lg font-semibold">{grouped.healthy.length}</div>
              <div>正常</div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {snapshot.items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-line/70 bg-panel px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {item.label}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(
                          item.status,
                        )}`}
                      >
                        {statusLabel(item.status)}
                      </span>
                      {item.stale ? (
                        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning">
                          stale
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
                  </div>
                  <span className="text-[11px] text-muted">
                    {formatTime(item.updatedAt)}
                  </span>
                </div>
                {metaChips(item.meta).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {metaChips(item.meta).map((chip) => (
                      <span
                        key={chip}
                        className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] text-muted"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted">
            最后检查 {formatTime(snapshot.generatedAt)}
          </p>
        </>
      ) : null}
    </div>
  );
}
