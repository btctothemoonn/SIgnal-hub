"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AlphaSummaryAudience,
  AlphaSummaryScope,
  AlphaSummarySnapshot,
} from "@/lib/alpha-summary";

const POLL_INTERVAL_MS = 10 * 60 * 1000;
const MIN_MANUAL_BUSY_MS = 700;
const SUMMARY_SCOPES: {
  id: AlphaSummaryScope;
  label: string;
  title: string;
  emptyWindow: string;
  pollMs: number;
}[] = [
  {
    id: "12h",
    label: "12h",
    title: "短线消息总结",
    emptyWindow: "最近 12 小时",
    pollMs: POLL_INTERVAL_MS,
  },
  {
    id: "today",
    label: "24h",
    title: "24 小时消息总结",
    emptyWindow: "最近 24 小时",
    pollMs: 15 * 60 * 1000,
  },
  {
    id: "3d",
    label: "3天",
    title: "近 3 天趋势总结",
    emptyWindow: "近 3 天",
    pollMs: 30 * 60 * 1000,
  },
  {
    id: "7d",
    label: "7天",
    title: "近 7 天趋势总结",
    emptyWindow: "近 7 天",
    pollMs: 60 * 60 * 1000,
  },
];

type AlphaSummaryCardProps = {
  audience?: AlphaSummaryAudience;
  compact?: boolean;
  className?: string;
  deskLabel?: string;
  endpoint?: string;
  showHeaderMeta?: boolean;
};

type AlphaSummaryScopeResultProps = {
  audience: AlphaSummaryAudience;
  compact: boolean;
  scope: AlphaSummaryScope;
  snapshot: AlphaSummarySnapshot | null;
  manualMessage: string | null;
};

function formatTime(raw: string | null) {
  if (!raw) return "n/a";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function scopeConfig(scope: AlphaSummaryScope) {
  return SUMMARY_SCOPES.find((item) => item.id === scope) ?? SUMMARY_SCOPES[0];
}

function scopeTitle(scope: AlphaSummaryScope, audience: AlphaSummaryAudience) {
  if (audience !== "stocks") return scopeConfig(scope).title;
  const titles: Record<AlphaSummaryScope, string> = {
    "12h": "短线投研总结",
    today: "24 小时投研总结",
    "3d": "近 3 天投研总结",
    "7d": "近 7 天投研总结",
  };
  return titles[scope];
}

function statusLabel(snapshot: AlphaSummarySnapshot | null) {
  if (!snapshot) return "加载中";
  if (snapshot.status === "needs_key") return "待配置";
  if (snapshot.status === "empty") return "暂无数据";
  if (snapshot.status === "error") return "生成失败";
  if (snapshot.status === "generated") return "已生成";
  return "缓存";
}

function statusTone(snapshot: AlphaSummarySnapshot | null) {
  if (!snapshot) return "bg-info-soft text-info";
  if (snapshot.status === "needs_key" || snapshot.status === "error") {
    return "bg-danger-soft text-danger";
  }
  if (snapshot.status === "empty") return "bg-warning-soft text-warning";
  return "bg-success-soft text-success";
}

function manualResultMessage(snapshot: AlphaSummarySnapshot, label: string) {
  if (snapshot.status === "empty") {
    return `已检查：${label}暂无可总结消息，暂未调用 AI。`;
  }
  if (snapshot.status === "needs_key") {
    return "生成失败：AI key 还没有配置。";
  }
  if (snapshot.status === "error") {
    return `生成失败：${snapshot.error || "请稍后重试。"}`;
  }
  if (snapshot.status === "generated") {
    return `已重新生成：${formatTime(snapshot.generatedAt)}`;
  }
  return `已刷新：${formatTime(snapshot.generatedAt)}`;
}

function AlphaSummaryScopeResult({
  audience,
  compact,
  scope,
  snapshot,
  manualMessage,
}: AlphaSummaryScopeResultProps) {
  const summary = snapshot?.summary ?? null;
  const isProblem =
    snapshot?.status === "needs_key" || snapshot?.status === "error";
  const activeScopeTitle = scopeTitle(scope, audience);

  const insightGridClass = compact
    ? "grid gap-3"
    : "grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]";
  const authorsGridClass = compact ? "grid gap-3" : "grid gap-4 2xl:grid-cols-2";

  return (
    <div className="px-4 py-4 sm:px-5">
        {manualMessage ? (
          <p
            className={`mb-4 rounded-lg border px-3 py-2 text-xs leading-5 ${
              manualMessage.includes("失败") || manualMessage.includes("请求失败")
                ? "border-danger/30 bg-danger-soft text-danger"
                : "border-line/60 bg-panel-strong text-muted"
            }`}
          >
            {manualMessage}
          </p>
        ) : null}

        {summary ? (
          <div className="space-y-5">
            <div className="border-l-2 border-accent pl-3">
              <p className="text-xs font-semibold uppercase text-muted">
                {activeScopeTitle}
              </p>
              <h2
                className={`mt-2 break-words font-semibold text-foreground [overflow-wrap:anywhere] ${
                  compact ? "text-lg leading-7" : "text-xl leading-8 sm:text-2xl"
                }`}
              >
                {summary.headline}
              </h2>
            </div>

            <div className={insightGridClass}>
              {summary.consensus.length > 0 ? (
                <section className="rounded-lg border border-line/60 bg-panel-strong/90 p-4">
                  <p className="text-[11px] font-semibold uppercase text-muted">
                    核心共识
                  </p>
                  <div className="mt-2 space-y-2">
                    {summary.consensus.map((item) => (
                      <p
                        key={item}
                        className="break-words text-sm leading-6 text-foreground"
                      >
                        {item}
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}

              {summary.watchlist.length > 0 || summary.risks.length > 0 ? (
                <section className="rounded-lg border border-line/60 bg-panel-strong/90 p-4">
                  {summary.watchlist.length > 0 ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase text-muted">
                        Watchlist
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {summary.watchlist.map((item) => (
                          <span
                            key={item}
                            className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {summary.risks.length > 0 ? (
                    <div className={summary.watchlist.length > 0 ? "mt-4" : ""}>
                      <p className="text-[11px] font-semibold uppercase text-muted">
                        风险
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {summary.risks.map((risk) => (
                          <p
                            key={risk}
                            className="break-words text-sm leading-6 text-warning"
                          >
                            {risk}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            {summary.authors.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase text-muted">
                    来源观点
                  </p>
                  <span className="text-xs text-muted">
                    {summary.authors.length} 个信号源
                  </span>
                </div>
                <div className={authorsGridClass}>
                  {summary.authors.map((author) => (
                    <article
                      key={`${author.name}-${author.coreView}`}
                      className="rounded-lg border border-line/60 bg-panel-strong/90 p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-foreground">
                          {author.name}
                        </h3>
                        <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                          {author.sourceCount} 条
                        </span>
                      </div>
                      <p className="mt-2 break-words text-sm leading-6 text-foreground">
                        {author.coreView}
                      </p>
                      {author.alpha.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
                          {author.alpha.map((item) => (
                            <p
                              key={item}
                              className="break-words text-sm leading-6 text-muted"
                            >
                              {item}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {author.watch.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {author.watch.map((item) => (
                            <span
                              key={item}
                              className="rounded-md bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border-l-2 border-line pl-3">
              <p className="text-xs font-semibold uppercase text-muted">
                {activeScopeTitle}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">
                等待可总结信号
              </h2>
            </div>
            <p
              className={`rounded-lg border border-line/60 bg-panel-strong px-3 py-2 text-sm leading-6 ${
                isProblem ? "text-danger" : "text-muted"
              }`}
            >
              {snapshot?.error ||
                (snapshot?.status === "empty"
                  ? "当前周期还没有可总结的消息。"
                  : "正在读取本地缓存。")}
            </p>
          </div>
        )}
    </div>
  );
}

export function AlphaSummaryCard({
  audience = "signals",
  compact = false,
  className = "",
  deskLabel = "Signals AI",
  endpoint = "/api/alpha-summary",
  showHeaderMeta = true,
}: AlphaSummaryCardProps) {
  const [scope, setScope] = useState<AlphaSummaryScope>("12h");
  const [snapshotRecord, setSnapshotRecord] = useState<{
    scope: AlphaSummaryScope;
    snapshot: AlphaSummarySnapshot;
  } | null>(null);
  const [busyScope, setBusyScope] = useState<AlphaSummaryScope | null>(null);
  const [manualMessageRecord, setManualMessageRecord] = useState<{
    scope: AlphaSummaryScope;
    message: string;
  } | null>(null);
  const requestsInFlight = useRef<Set<AlphaSummaryScope>>(new Set());
  const abortControllers = useRef<Map<AlphaSummaryScope, Set<AbortController>>>(
    new Map(),
  );
  const snapshot =
    snapshotRecord?.scope === scope ? snapshotRecord.snapshot : null;
  const manualMessage =
    manualMessageRecord?.scope === scope ? manualMessageRecord.message : null;
  const activeScope = scopeConfig(scope);
  const summaryPeriodLabel = snapshot?.period.label ?? activeScope.emptyWindow;
  const metaItems = snapshot
    ? [
        { label: "窗口", value: snapshot.period.label },
        { label: "模型", value: snapshot.model },
        {
          label: "来源",
          value:
            audience === "stocks"
              ? `${snapshot.itemCount} 条 · Stocks ${snapshot.sourceCounts.stocks ?? 0} / TG ${snapshot.sourceCounts.telegram} / X ${snapshot.sourceCounts.x}`
              : `${snapshot.itemCount} 条 · TG ${snapshot.sourceCounts.telegram} / X ${snapshot.sourceCounts.x}`,
        },
        { label: "更新", value: formatTime(snapshot.generatedAt) },
      ]
    : [
        { label: "窗口", value: activeScope.emptyWindow },
        { label: "模型", value: "AI" },
        { label: "来源", value: "读取中" },
        { label: "更新", value: "n/a" },
      ];

  const loadSummary = useCallback(
    async (force = false, targetScope: AlphaSummaryScope) => {
      if (requestsInFlight.current.has(targetScope)) return;
      requestsInFlight.current.add(targetScope);
      const controller = new AbortController();
      const scopedControllers =
        abortControllers.current.get(targetScope) ?? new Set<AbortController>();
      scopedControllers.add(controller);
      abortControllers.current.set(targetScope, scopedControllers);
      const startedAt = Date.now();
      const targetScopeConfig = scopeConfig(targetScope);
      const manualProgressMessage = `正在重新生成${targetScopeConfig.label}总结...`;
      if (force) {
        setManualMessageRecord({
          scope: targetScope,
          message: manualProgressMessage,
        });
      }
      setBusyScope(targetScope);
      try {
        const params = new URLSearchParams({ scope: targetScope });
        if (audience !== "signals") params.set("audience", audience);
        const response = await fetch(`${endpoint}?${params.toString()}`, {
          method: force ? "POST" : "GET",
          headers: force ? { "Content-Type": "application/json" } : undefined,
          body: force
            ? JSON.stringify({ force: true, scope: targetScope, audience })
            : undefined,
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as AlphaSummarySnapshot;
        if (!controller.signal.aborted && scope === targetScope) {
          setSnapshotRecord({ scope: targetScope, snapshot: payload });
          if (force) {
            setManualMessageRecord({
              scope: targetScope,
              message: manualResultMessage(payload, targetScopeConfig.label),
            });
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (force) {
            setManualMessageRecord((current) =>
              current?.scope === targetScope &&
              current.message === manualProgressMessage
                ? null
                : current,
            );
          }
          return;
        }
        if (force && !controller.signal.aborted && scope === targetScope) {
          setManualMessageRecord({
            scope: targetScope,
            message: `请求失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (force && !controller.signal.aborted) {
          const waitMs = MIN_MANUAL_BUSY_MS - (Date.now() - startedAt);
          if (waitMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, waitMs));
          }
        }
        requestsInFlight.current.delete(targetScope);
        const currentScopedControllers =
          abortControllers.current.get(targetScope);
        currentScopedControllers?.delete(controller);
        if (currentScopedControllers?.size === 0) {
          abortControllers.current.delete(targetScope);
        }
        setBusyScope((current) => (current === targetScope ? null : current));
      }
    },
    [audience, endpoint, scope],
  );

  useEffect(() => {
    const controllers = abortControllers.current;
    const inFlightScopes = requestsInFlight.current;
    const loadTimer = window.setTimeout(() => {
      void loadSummary(false, scope);
    }, 0);
    const pollTimer = window.setInterval(() => {
      void loadSummary(false, scope);
    }, activeScope.pollMs);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearInterval(pollTimer);
      controllers.forEach((scopedControllers) => {
        scopedControllers.forEach((controller) => {
          controller.abort();
        });
      });
      controllers.clear();
      inFlightScopes.clear();
    };
  }, [activeScope.pollMs, loadSummary, scope]);

  const scopeTabs = (
    <div className="grid w-full grid-cols-4 gap-0.5 rounded-md border border-line/70 bg-background/40 p-0.5 sm:max-w-sm">
      {SUMMARY_SCOPES.map((item) => {
        const selected = item.id === scope;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            onClick={() => setScope(item.id)}
            className={`h-7 rounded-md px-1.5 text-[11px] font-semibold transition-colors ${
              selected
                ? "bg-foreground text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
                : "text-muted hover:bg-panel hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)] pointer-events-auto",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="border-b border-line/60 bg-panel-strong/72 px-4 py-3 sm:px-5">
        <div
          className={`flex flex-col gap-2 ${
            compact ? "" : "xl:flex-row xl:items-center xl:justify-between"
          }`}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {showHeaderMeta ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-line/70 bg-background/45 px-2 py-1 text-[11px] font-semibold uppercase text-muted">
                  {deskLabel}
                </span>
                <span
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusTone(snapshot)}`}
                >
                  {statusLabel(snapshot)}
                </span>
                {metaItems.map((item) => (
                  <span
                    key={item.label}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line/60 bg-panel px-2 py-1 text-[11px] text-muted"
                  >
                    <span className="shrink-0">{item.label}</span>
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {item.value}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div
                data-alpha-summary-period
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line/60 bg-panel px-2 py-1 text-[11px] text-muted sm:w-fit"
              >
                <span className="shrink-0">周期</span>
                <span className="min-w-0 truncate font-medium text-foreground">
                  {summaryPeriodLabel}
                </span>
              </div>
            )}

            {scopeTabs}
          </div>

          <div className={compact ? "grid" : ""}>
            <button
              type="button"
              disabled={busyScope === scope}
              onClick={() => void loadSummary(true, scope)}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-line/70 bg-foreground px-3 text-xs font-semibold text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)] transition-colors hover:bg-accent disabled:opacity-60"
            >
              {busyScope === scope ? "生成中..." : "重新生成"}
            </button>
          </div>
        </div>
      </div>
      <AlphaSummaryScopeResult
        audience={audience}
        compact={compact}
        scope={scope}
        snapshot={snapshot}
        manualMessage={manualMessage}
      />
    </section>
  );
}
