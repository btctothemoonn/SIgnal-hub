"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
  DailyBriefItem,
  DailyBriefSnapshot,
} from "@/lib/daily-investment-brief";

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
      <div className="flex aspect-[16/7] items-center justify-center rounded-md border border-line bg-workspace-surface text-xs font-semibold text-muted">
        {item.sourceNames[0] || "News"}
      </div>
    );
  }

  return (
    <div
      aria-label={`${item.title} 配图`}
      className="aspect-[16/7] rounded-md border border-line bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${item.imageUrl}")` }}
    />
  );
}

function BriefItemCard({ item }: { item: DailyBriefItem }) {
  const importanceTone =
    item.importance === "high"
      ? "bg-danger text-danger"
      : item.importance === "medium"
        ? "bg-warning text-warning"
        : "bg-info text-info";

  return (
    <article className="rounded-lg border border-workspace-line-strong bg-workspace-surface p-3 shadow-sm">
      <div className="grid gap-3 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <ItemImage item={item} />
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold text-muted">
              #{item.rank}
            </span>
            <span
              className={[
                "inline-flex items-center rounded-md bg-opacity-10 px-2 py-0.5 text-xs font-semibold",
                importanceTone,
              ].join(" ")}
            >
              {item.importance.toUpperCase()}
            </span>
            <span className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold text-muted">
              {item.topic}
            </span>
          </div>
          <h3 className="text-base font-semibold leading-snug text-foreground">
            {item.title}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted">
            {(item.sourceNames.length > 0 ? item.sourceNames : ["Reuters", "AP News"]).map(
              (source) => (
                <span
                  key={source}
                  className="rounded-md border border-line bg-workspace-surface-raised px-2 py-0.5 font-semibold"
                >
                  {source}
                </span>
              ),
            )}
            {item.sourceUrls.map((sourceUrl, index) => (
              <a
                key={sourceUrl}
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 font-semibold text-accent transition-colors hover:border-accent/60"
              >
                原文 {index + 1}
              </a>
            ))}
          </div>
          <div className="mt-3 grid gap-2 text-sm leading-relaxed text-foreground lg:grid-cols-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-muted">
                发生了什么
              </div>
              <p>{item.whatHappened || "证据不足。"}</p>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted">
                投资影响
              </div>
              <p>{item.investmentImpact || "等待更多确认。"}</p>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted">
                后续关注
              </div>
              <p>{item.watchNext || "继续观察后续数据。"}</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function DailyBriefPanel({
  initialSnapshot,
}: {
  initialSnapshot: DailyBriefSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

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
      if (!next) {
        throw new Error("接口没有返回可读取的简报数据");
      }
      setSnapshot(next);
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

  return (
    <section data-daily-brief className="mx-auto w-full max-w-6xl">
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
          <h2 className="mt-3 text-2xl font-semibold leading-tight text-foreground">
            {snapshot.brief?.title || "每日投资简报"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {snapshot.period.label} · 更新 {formatTime(snapshot.generatedAt)} ·{" "}
            {snapshot.model} · 来源 {sourceSummary(snapshot)}
          </p>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-accent/35 bg-accent-soft px-4 text-sm font-semibold text-accent transition-colors hover:border-accent/60 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw
            aria-hidden
            className={["h-4 w-4", pending ? "animate-spin" : ""].join(" ")}
          />
          手动生成
        </button>
      </div>

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
          <div className="rounded-lg border border-workspace-line-strong bg-workspace-surface p-4 shadow-sm">
            <div className="mb-2 text-xs font-semibold uppercase text-muted">
              Market Pulse
            </div>
            <p className="text-base leading-relaxed text-foreground">
              {snapshot.brief.marketPulse}
            </p>
            {snapshot.brief.priorityLine ? (
              <p className="mt-3 rounded-md border border-line bg-workspace-surface-raised px-3 py-2 text-sm font-semibold text-foreground">
                {snapshot.brief.priorityLine}
              </p>
            ) : null}
          </div>

          {snapshot.brief.watchVariables.length > 0 ? (
            <div className="flex flex-wrap gap-2 rounded-lg border border-workspace-line-strong bg-workspace-surface p-3 shadow-sm">
              {snapshot.brief.watchVariables.map((variable) => (
                <span
                  key={variable}
                  className="rounded-md border border-line bg-workspace-surface-raised px-2.5 py-1 text-xs font-semibold text-muted"
                >
                  {variable}
                </span>
              ))}
            </div>
          ) : null}

          {snapshot.brief.items.map((item) => (
            <BriefItemCard key={`${item.rank}:${item.title}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
