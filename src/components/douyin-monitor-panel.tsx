"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type {
  DouyinSnapshot,
  DouyinVideoRecord,
  DouyinVideoSummary,
} from "@/lib/douyin-monitor";

function formatTime(value: string | null) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusText(status: DouyinSnapshot["status"]) {
  if (status === "ok") return "正常";
  if (status === "partial") return "部分失败";
  if (status === "error") return "抓取失败";
  return "待配置";
}

function summaryTone(summary: DouyinVideoSummary | null) {
  if (!summary) return "text-muted";
  if (summary.status === "generated") return "text-success";
  if (summary.status === "error") return "text-danger";
  return "text-warning";
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted">n/a</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border border-line/70 bg-background/45 px-2 py-1 text-xs text-muted"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function SummaryBlock({ summary }: { summary: DouyinVideoSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-line/70 bg-background/45 p-3 text-sm text-muted">
        摘要等待生成。若 AI 失败，会保留公开视频标题和简介。
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-line/70 bg-background/45 p-3 md:grid-cols-[1.25fr_1fr]">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          投研摘要
          <span className={`ml-2 ${summaryTone(summary)}`}>
            {summary.status === "generated"
              ? "AI"
              : summary.status === "error"
                ? "生成失败"
                : "内容有限"}
          </span>
        </div>
        <p className="text-sm leading-6 text-foreground">{summary.coreView}</p>
        {summary.error ? (
          <p className="mt-2 text-xs text-danger">{summary.error}</p>
        ) : null}
      </div>
      <div className="grid gap-2 text-xs">
        <div>
          <div className="mb-1 font-semibold text-muted">相关资产</div>
          <TagList items={summary.assets} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted">催化 / 跟踪</div>
          <TagList items={[...summary.catalysts, ...summary.followUps].slice(0, 6)} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted">风险</div>
          <TagList items={summary.risks} />
        </div>
      </div>
    </div>
  );
}

function VideoCard({ video }: { video: DouyinVideoRecord }) {
  return (
    <article className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-52px_rgba(0,0,0,0.85)]">
      <div className="flex flex-col gap-4 lg:flex-row">
        {video.coverUrl ? (
          <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-line/70 bg-background/50 lg:w-56">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={video.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-md bg-accent-soft px-2 py-1 font-semibold text-accent">
              抖音
            </span>
            <span>{video.creatorName}</span>
            <span>·</span>
            <span>{formatTime(video.publishedAt || video.firstSeenAt)}</span>
            <a
              href={video.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto rounded-md border border-line/70 px-2 py-1 text-xs font-semibold text-foreground hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
            >
              打开视频
            </a>
          </div>
          <h2 className="text-lg font-semibold leading-7 text-foreground">
            {video.title}
          </h2>
          {video.description && video.description !== video.title ? (
            <p className="mt-2 text-sm leading-6 text-muted">{video.description}</p>
          ) : null}
          <div className="mt-3">
            <SummaryBlock summary={video.summary} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function DouyinMonitorPanel({
  initialSnapshot,
  apiEndpoint = "/api/douyin",
  refreshEndpoint = "/api/douyin/refresh",
}: {
  initialSnapshot: DouyinSnapshot;
  apiEndpoint?: string;
  refreshEndpoint?: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const creatorCount = snapshot.creators.length;
  const videos = useMemo(() => snapshot.videos, [snapshot.videos]);

  const reload = useCallback(async (method: "GET" | "POST" = "GET") => {
    setError(null);
    const response = await fetch(method === "POST" ? refreshEndpoint : apiEndpoint, {
      method,
      cache: "no-store",
    });
    const payload = (await response.json()) as DouyinSnapshot & {
      error?: string;
    };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `Douyin API HTTP ${response.status}`);
    }
    setSnapshot(payload);
  }, [apiEndpoint, refreshEndpoint]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void reload("GET").catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  function refreshNow() {
    startTransition(() => {
      void reload("POST").catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-52px_rgba(0,0,0,0.85)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">抖音订阅</h1>
            <p className="mt-1 text-sm text-muted">
              公开视频低频监控 · {creatorCount} 个博主 · 最新 {videos.length} 条 · 更新{" "}
              {formatTime(snapshot.lastUpdatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-line/70 bg-background/45 px-3 py-2 text-xs text-muted">
              状态 <b className="ml-1 text-foreground">{statusText(snapshot.status)}</b>
            </span>
            <button
              type="button"
              onClick={refreshNow}
              disabled={isPending || creatorCount === 0}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent disabled:opacity-40"
            >
              {isPending ? "刷新中..." : "手动刷新"}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {snapshot.errors.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.errors.slice(0, 3).map((item) => (
              <p
                key={`${item.creatorRef}-${item.fetchedAt}`}
                className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning"
              >
                {item.creatorRef}: {item.error || "公开页面暂未解析到视频"}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {creatorCount === 0 ? (
        <div className="rounded-lg border border-dashed border-line/70 bg-panel-strong p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">还没有配置抖音博主</h2>
          <p className="mt-2 text-sm text-muted">
            到设置页添加抖音主页链接后，后台每小时抓取公开视频并生成投研摘要。
          </p>
          <a
            href="/settings"
            className="mt-4 inline-flex rounded-lg border border-line/70 bg-background/45 px-4 py-2 text-sm font-semibold text-foreground hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
          >
            打开设置
          </a>
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-lg border border-line/70 bg-panel-strong p-8 text-center text-sm text-muted">
          暂无缓存视频。可以先点手动刷新；如果公开页面受限，页面会显示失败原因。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  );
}
