"use client";

import {
  Bitcoin,
  CalendarDays,
  Cpu,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  groupDailyBriefItems,
  type DailyBriefGroupId,
} from "@/lib/daily-brief-display";
import type {
  DailyBriefHistoryEntry,
  DailyBriefItem,
  DailyBriefSnapshot,
} from "@/lib/daily-investment-brief";

const BRIEF_GROUPS = [
  { id: "ai", label: "AI 科技", icon: Cpu },
  { id: "crypto", label: "币圈", icon: Bitcoin },
  { id: "markets", label: "宏观市场", icon: Globe2 },
] as const;

function formatTime(value: string | null) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatHistoryDate(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}月${day}日`;
}

function historyEntryFromSnapshot(
  snapshot: DailyBriefSnapshot,
): DailyBriefHistoryEntry | null {
  if (!snapshot.success || !snapshot.brief) return null;
  return {
    dateKey: snapshot.period.dateKey,
    label: snapshot.period.label,
    generatedAt: snapshot.generatedAt,
    title: snapshot.brief.title,
    itemCount: snapshot.brief.items.length,
  };
}

function statusLabel(snapshot: DailyBriefSnapshot, pending: boolean) {
  if (pending) return "生成中";
  if (snapshot.status === "generated") return "已生成";
  if (snapshot.status === "cached") return "最近一次简报";
  if (snapshot.status === "needs_key") return "等待密钥";
  if (snapshot.status === "error") return "生成失败";
  return "暂无缓存";
}

function sourceSummary(snapshot: DailyBriefSnapshot) {
  const entries = Object.entries(snapshot.sourceCounts);
  if (entries.length === 0) return "独立新闻源暂未返回内容";
  return entries.map(([name, count]) => `${name} ${count}`).join(" · ");
}

function ItemImage({ item }: { item: DailyBriefItem }) {
  if (!item.imageUrl) {
    return (
      <div className="flex aspect-[16/7] min-h-28 items-center justify-center border-b border-line bg-workspace-canvas text-muted sm:aspect-auto sm:min-h-full sm:border-b-0 sm:border-r">
        <div className="flex flex-col items-center gap-2">
          <Globe2 aria-hidden className="h-5 w-5" />
          <span className="text-xs font-semibold">
            {item.sourceNames[0] || "News"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`${item.title} 配图`}
      className="aspect-[16/7] min-h-28 border-b border-line bg-workspace-canvas bg-cover bg-center bg-no-repeat sm:aspect-auto sm:min-h-full sm:border-b-0 sm:border-r"
      style={{ backgroundImage: `url("${item.imageUrl}")` }}
    />
  );
}

function BriefFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 px-3 py-2.5 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:gap-3">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <p className="min-w-0 text-[13px] leading-relaxed text-foreground">
        {value}
      </p>
    </div>
  );
}

function BriefItemCard({ item }: { item: DailyBriefItem }) {
  const tone =
    item.importance === "high"
      ? {
          border: "border-l-danger",
          badge: "border-danger/25 bg-danger-soft text-danger",
          label: "高优先",
        }
      : item.importance === "medium"
        ? {
            border: "border-l-warning",
            badge: "border-warning/25 bg-warning-soft text-warning",
            label: "中优先",
          }
        : {
            border: "border-l-info",
            badge: "border-info/25 bg-info-soft text-info",
            label: "观察",
          };

  return (
    <article
      data-daily-brief-card
      className={[
        "min-w-0 overflow-hidden rounded-lg border border-l-2 border-workspace-line-strong bg-workspace-surface shadow-sm",
        tone.border,
      ].join(" ")}
    >
      <div className="grid min-w-0 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <ItemImage item={item} />
        <div className="min-w-0 p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted">
              #{item.rank}
            </span>
            <span
              className={[
                "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                tone.badge,
              ].join(" ")}
            >
              {tone.label}
            </span>
            <span className="min-w-0 truncate text-[11px] font-semibold text-muted">
              {item.topic}
            </span>
          </div>

          <h3 className="mt-2 text-[15px] font-semibold leading-snug text-foreground">
            {item.title}
          </h3>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {(item.sourceNames.length > 0
              ? item.sourceNames
              : ["Reuters", "AP News"]
            ).map((source) => (
              <span
                key={source}
                className="rounded-md border border-line bg-workspace-surface-raised px-1.5 py-0.5 font-semibold"
              >
                {source}
              </span>
            ))}
            {item.sourceUrls.map((sourceUrl, index) => (
              <a
                key={sourceUrl}
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`打开原文 ${index + 1}`}
                className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-semibold text-accent transition-colors hover:border-accent/60"
              >
                原文 {index + 1}
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-line border-t border-line bg-workspace-surface-raised/45">
        <BriefFact label="发生了什么" value={item.whatHappened || "证据不足。"} />
        <BriefFact label="投资影响" value={item.investmentImpact || "等待更多确认。"} />
        <BriefFact label="后续关注" value={item.watchNext || "继续观察后续数据。"} />
      </div>
    </article>
  );
}

export function DailyBriefPanel({
  initialSnapshot,
  initialHistory,
}: {
  initialSnapshot: DailyBriefSnapshot;
  initialHistory: DailyBriefHistoryEntry[];
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [history, setHistory] = useState(initialHistory);
  const [selectedDate, setSelectedDate] = useState(
    initialSnapshot.period.dateKey,
  );
  const [snapshotCache, setSnapshotCache] = useState<
    Record<string, DailyBriefSnapshot>
  >(() => ({ [initialSnapshot.period.dateKey]: initialSnapshot }));
  const [historyPendingDate, setHistoryPendingDate] = useState<string | null>(
    null,
  );
  const [activeGroup, setActiveGroup] = useState<DailyBriefGroupId>("ai");
  const [pending, setPending] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const groupedItems = useMemo(
    () => groupDailyBriefItems(snapshot.brief?.items ?? []),
    [snapshot.brief?.items],
  );

  const regenerate = async () => {
    setPending(true);
    setUiError(null);
    try {
      const response = await fetch("/api/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const next = (await response
        .json()
        .catch(() => null)) as DailyBriefSnapshot | null;
      if (!response.ok) {
        throw new Error(next?.error || `HTTP ${response.status}`);
      }
      if (!next) throw new Error("接口没有返回可读取的简报数据");
      setSnapshot(next);
      setSelectedDate(next.period.dateKey);
      setSnapshotCache((current) => ({
        ...current,
        [next.period.dateKey]: next,
      }));
      const nextHistoryEntry = historyEntryFromSnapshot(next);
      if (nextHistoryEntry) {
        setHistory((current) =>
          [
            nextHistoryEntry,
            ...current.filter(
              (entry) => entry.dateKey !== nextHistoryEntry.dateKey,
            ),
          ]
            .sort((left, right) => right.dateKey.localeCompare(left.dateKey))
            .slice(0, 15),
        );
      }
      if (!next.success && next.error) {
        setUiError(`生成请求失败：${next.error}`);
      }
    } catch (error) {
      setUiError(
        `生成请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPending(false);
    }
  };

  const selectHistoryDate = async (dateKey: string) => {
    if (dateKey === selectedDate || historyPendingDate) return;
    setUiError(null);
    const cachedSnapshot = snapshotCache[dateKey];
    if (cachedSnapshot) {
      setSnapshot(cachedSnapshot);
      setSelectedDate(dateKey);
      setActiveGroup("ai");
      return;
    }

    setHistoryPendingDate(dateKey);
    try {
      const response = await fetch(
        `/api/daily-brief?date=${encodeURIComponent(dateKey)}`,
        { cache: "no-store" },
      );
      const next = (await response.json().catch(() => null)) as
        | DailyBriefSnapshot
        | { error?: string }
        | null;
      if (!response.ok || !next || !("period" in next)) {
        const message = next && "error" in next ? next.error : null;
        throw new Error(message || `HTTP ${response.status}`);
      }
      setSnapshot(next);
      setSelectedDate(dateKey);
      setActiveGroup("ai");
      setSnapshotCache((current) => ({ ...current, [dateKey]: next }));
    } catch (error) {
      setUiError(
        `历史简报读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setHistoryPendingDate(null);
    }
  };

  return (
    <section data-daily-brief className="mx-auto w-full max-w-[1400px]">
      <div className="mb-3 flex flex-col gap-3 rounded-lg border border-workspace-line-strong bg-workspace-surface p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-line bg-workspace-surface-raised px-2.5 py-1 text-xs font-semibold text-muted">
              DAILY BRIEF
            </span>
            <span className="rounded-md border border-line bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
              {statusLabel(snapshot, pending)}
            </span>
          </div>
          <h2 className="mt-2.5 text-xl font-semibold leading-tight text-foreground sm:text-2xl">
            {snapshot.brief?.title || "每日投资简报"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">
            {snapshot.period.label} · 更新 {formatTime(snapshot.generatedAt)} ·{" "}
            {snapshot.model} · 来源 {sourceSummary(snapshot)}
          </p>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-accent/35 bg-accent-soft px-3 text-sm font-semibold text-accent transition-colors hover:border-accent/60 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw
            aria-hidden
            className={["h-4 w-4", pending ? "animate-spin" : ""].join(" ")}
          />
          手动生成
        </button>
      </div>

      {history.length > 0 ? (
        <div className="mb-3 flex min-w-0 flex-col gap-2 rounded-lg border border-workspace-line-strong bg-workspace-toolbar px-3 py-2.5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted">
            <CalendarDays aria-hidden className="h-4 w-4" />
            <span>历史简报</span>
            <span className="rounded-md bg-workspace-surface-raised px-1.5 py-0.5 text-[10px]">
              近15天
            </span>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex w-max gap-1.5">
              {history.map((entry) => {
                const selected = selectedDate === entry.dateKey;
                const loading = historyPendingDate === entry.dateKey;
                return (
                  <button
                    key={entry.dateKey}
                    type="button"
                    aria-pressed={selected}
                    title={entry.title}
                    disabled={historyPendingDate !== null}
                    onClick={() => selectHistoryDate(entry.dateKey)}
                    className={[
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60",
                      selected
                        ? "border-accent/40 bg-accent-soft text-foreground"
                        : "border-line bg-workspace-surface text-muted hover:border-workspace-line-strong hover:text-foreground",
                    ].join(" ")}
                  >
                    {loading ? (
                      <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    <span>{formatHistoryDate(entry.dateKey)}</span>
                    <span className="text-[10px] font-medium text-muted">
                      {entry.itemCount}条
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.error ? (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {snapshot.error}
        </div>
      ) : null}

      {uiError ? (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {uiError}
        </div>
      ) : null}

      {!snapshot.brief ? (
        <div className="rounded-lg border border-workspace-line-strong bg-workspace-surface p-8 text-center shadow-sm">
          <div className="text-lg font-semibold text-foreground">
            暂无每日投资简报缓存
          </div>
          <p className="mt-2 text-sm text-muted">
            后台会在每天 08:00 后生成；也可以现在手动生成。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
            <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 p-4">
                <div className="mb-1.5 text-[11px] font-semibold text-muted">
                  MARKET PULSE
                </div>
                <p className="text-sm leading-relaxed text-foreground sm:text-[15px]">
                  {snapshot.brief.marketPulse}
                </p>
              </div>
              {snapshot.brief.priorityLine ? (
                <div className="border-t border-line px-4 py-3 lg:border-l lg:border-t-0">
                  <div className="mb-1.5 text-[11px] font-semibold text-muted">
                    今日主线
                  </div>
                  <p className="text-sm font-semibold leading-relaxed text-foreground">
                    {snapshot.brief.priorityLine}
                  </p>
                </div>
              ) : null}
            </div>
            {snapshot.brief.watchVariables.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
                {snapshot.brief.watchVariables.map((variable) => (
                  <span
                    key={variable}
                    className="rounded-md border border-line bg-workspace-surface-raised px-2 py-1 text-[11px] font-semibold text-muted"
                  >
                    {variable}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-workspace-line-strong bg-workspace-toolbar p-1 shadow-sm">
            <div
              role="tablist"
              aria-label="投资情报分类"
              className="grid grid-cols-3 gap-1"
            >
              {BRIEF_GROUPS.map((group) => {
                const selected = activeGroup === group.id;
                const Icon = group.icon;
                return (
                  <button
                    key={group.id}
                    id={`daily-brief-tab-${group.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`daily-brief-panel-${group.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveGroup(group.id)}
                    className={[
                      "flex h-10 min-w-0 items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-semibold transition-colors sm:gap-1.5 sm:px-2 sm:text-sm",
                      selected
                        ? "border-accent/40 bg-accent-soft text-foreground shadow-sm"
                        : "border-transparent text-muted hover:bg-workspace-surface hover:text-foreground",
                    ].join(" ")}
                  >
                    <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="whitespace-nowrap">{group.label}</span>
                    <span
                      className={[
                        "inline-flex min-w-4 items-center justify-center rounded-md px-0.5 py-0.5 text-[10px] sm:min-w-5 sm:px-1",
                        selected
                          ? "bg-workspace-surface text-foreground"
                          : "bg-workspace-surface-raised text-muted",
                      ].join(" ")}
                    >
                      {groupedItems[group.id].length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id={`daily-brief-panel-${activeGroup}`}
            role="tabpanel"
            aria-labelledby={`daily-brief-tab-${activeGroup}`}
          >
            {groupedItems[activeGroup].length > 0 ? (
              <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                {groupedItems[activeGroup].map((item) => (
                  <BriefItemCard
                    key={`${item.rank}:${item.title}`}
                    item={item}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-workspace-line-strong bg-workspace-surface px-4 text-center">
                <Globe2 aria-hidden className="h-5 w-5 text-muted" />
                <div className="mt-2 text-sm font-semibold text-foreground">
                  当前分类暂无重点情报
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
