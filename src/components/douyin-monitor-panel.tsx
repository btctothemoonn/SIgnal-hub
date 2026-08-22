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

function snapshotUrl(endpoint: string, limit: number) {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}limit=${encodeURIComponent(String(limit))}`;
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

function DetailList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-xs text-muted">n/a</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-6 text-foreground">
      {items.slice(0, 5).map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SummaryBlock({ summary }: { summary: DouyinVideoSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-[6px] border border-line/70 bg-background/45 p-3 text-sm text-muted">
        摘要等待生成。若 AI 失败，会保留公开视频标题和简介。
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-[6px] border border-line/70 bg-background/45 p-3 md:grid-cols-[1.25fr_1fr]">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted">
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
        <div className="mt-3 rounded-md border border-line/60 bg-panel/45 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-normal text-muted">
            为什么推荐 / 看好
          </div>
          <DetailList items={summary.recommendationReasons} />
        </div>
        {summary.error ? (
          <p className="mt-2 text-xs text-danger">{summary.error}</p>
        ) : null}
      </div>
      <div className="grid gap-2 text-xs">
        <div>
          <div className="mb-1 font-semibold text-muted">A股 / 板块 / 资产</div>
          <TagList items={summary.assets} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted">炒作逻辑 / 催化</div>
          <TagList items={summary.catalysts} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted">风险</div>
          <TagList items={summary.risks} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted">后续跟踪</div>
          <TagList items={summary.followUps} />
        </div>
      </div>
    </div>
  );
}

function VideoCard({ video }: { video: DouyinVideoRecord }) {
  return (
    <article
      data-douyin-video
      className="rounded-[6px] border border-line/70 bg-panel-strong p-3"
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(16rem,0.34fr)_minmax(0,0.66fr)] lg:items-start">
        <div className="grid min-w-0 content-start gap-3">
          {video.coverUrl ? (
            <a
              href={video.videoUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开视频：${video.title}`}
              className="aspect-video w-full overflow-hidden rounded-[6px] border border-line/70 bg-background/50 transition-colors hover:border-accent/45"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={video.coverUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-md bg-accent-soft px-2 py-1 font-semibold text-accent">
              抖音
            </span>
            <span>{video.creatorName}</span>
            <span>·</span>
            <span>{formatTime(video.publishedAt || video.firstSeenAt)}</span>
          </div>
          <a
            href={video.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit rounded-md border border-line/70 px-2 py-1 text-xs font-semibold text-foreground hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
          >
            打开视频
          </a>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-7 text-foreground">
            <a
              href={video.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent hover:underline"
            >
              {video.title}
            </a>
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
  const [togglePending, setTogglePending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedLimit, setLoadedLimit] = useState(
    initialSnapshot.pagination?.limit ?? Math.max(initialSnapshot.videos.length, 10),
  );
  const [isPending, startTransition] = useTransition();

  const creatorCount = snapshot.creators.length;
  const videos = useMemo(() => snapshot.videos, [snapshot.videos]);
  const totalVideos = snapshot.pagination?.total ?? videos.length;

  const reload = useCallback(async (
    method: "GET" | "POST" = "GET",
    limit = loadedLimit,
  ) => {
    setError(null);
    if (method === "POST") {
      const refreshResponse = await fetch(refreshEndpoint, {
        method: "POST",
        cache: "no-store",
      });
      const refreshPayload = (await refreshResponse.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!refreshResponse.ok || refreshPayload.success === false) {
        throw new Error(
          refreshPayload.error || `Douyin API HTTP ${refreshResponse.status}`,
        );
      }
    }
    const response = await fetch(snapshotUrl(apiEndpoint, limit), {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as DouyinSnapshot & {
      error?: string;
    };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `Douyin API HTTP ${response.status}`);
    }
    setSnapshot(payload);
  }, [apiEndpoint, loadedLimit, refreshEndpoint]);

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

  async function loadMore() {
    const nextLimit = loadedLimit + 10;
    setLoadingMore(true);
    try {
      await reload("GET", nextLimit);
      setLoadedLimit(nextLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleEnabled() {
    setTogglePending(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "douyin.setEnabled",
          enabled: !snapshot.enabled,
        }),
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `Settings API HTTP ${response.status}`);
      }
      await reload("GET");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglePending(false);
    }
  }

  return (
    <section data-douyin-workspace className="flex min-w-0 flex-col gap-3">
      <div data-douyin-toolbar className="rounded-[6px] border border-line/70 bg-panel-strong p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">抖音订阅</h1>
            <p className="mt-1 text-xs text-muted">
              公开视频低频监控 · {creatorCount} 个博主 · 已载入 {videos.length}/{totalVideos} 条 · 更新{" "}
              {formatTime(snapshot.lastUpdatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={snapshot.enabled}
              data-douyin-enabled-toggle
              onClick={toggleEnabled}
              disabled={togglePending}
              className={
                "inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 " +
                (snapshot.enabled
                  ? "border-success/35 bg-success-soft text-success"
                  : "border-line/70 bg-background/45 text-muted")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "relative h-4 w-7 rounded-full transition-colors " +
                  (snapshot.enabled ? "bg-success" : "bg-line")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform " +
                    (snapshot.enabled ? "translate-x-3.5" : "translate-x-0.5")
                  }
                />
              </span>
              {togglePending
                ? "保存中..."
                : snapshot.enabled
                  ? "监控已开启"
                  : "监控已暂停"}
            </button>
            <span className="rounded-[6px] border border-line/70 bg-background/45 px-3 py-2 text-xs text-muted">
              状态 <b className="ml-1 text-foreground">{statusText(snapshot.status)}</b>
            </span>
            <button
              type="button"
              onClick={refreshNow}
              disabled={isPending || creatorCount === 0 || !snapshot.enabled}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {isPending ? "刷新中..." : "手动刷新"}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-[6px] bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {!snapshot.enabled ? (
          <p data-douyin-paused-notice className="mt-3 rounded-[6px] bg-warning-soft px-3 py-2 text-sm text-warning">
            抖音监控已暂停。不会抓取新视频或生成 AI 摘要；订阅清单与历史数据均已保留。
          </p>
        ) : null}
        {snapshot.errors.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.errors.slice(0, 3).map((item) => (
              <p
                key={`${item.creatorRef}-${item.fetchedAt}`}
                className="rounded-[6px] bg-warning-soft px-3 py-2 text-xs text-warning"
              >
                {item.creatorRef}: {item.error || "公开页面暂未解析到视频"}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {creatorCount === 0 ? (
        <div className="rounded-[6px] border border-dashed border-line/70 bg-panel-strong p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">还没有配置抖音博主</h2>
          <p className="mt-2 text-sm text-muted">
            到设置页添加抖音主页链接后，后台每小时抓取公开视频并生成投研摘要。
          </p>
          <a
            href="/settings"
            className="mt-4 inline-flex rounded-[6px] border border-line/70 bg-background/45 px-4 py-2 text-sm font-semibold text-foreground hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
          >
            打开设置
          </a>
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-[6px] border border-line/70 bg-panel-strong p-8 text-center text-sm text-muted">
          暂无缓存视频。可以先点手动刷新；如果公开页面受限，页面会显示失败原因。
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div data-douyin-video-list className="flex min-w-0 flex-col gap-3">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
          {snapshot.pagination?.hasMore ? (
            <button
              type="button"
              data-douyin-load-more
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center rounded-[6px] border border-line/70 bg-panel-strong px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              {loadingMore ? "加载中..." : `加载更多（剩余 ${Math.max(0, totalVideos - videos.length)} 条）`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
