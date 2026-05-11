"use client";

import Image from "next/image";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import type {
  TelegramChannelWatch,
  TelegramDashboardSnapshot,
  TelegramFeedItem,
  TelegramRealtimeStatus,
  TelegramRealtimeUpdate,
} from "@/lib/telegram-channels";
import { shouldSkipTelegramChannelTranslation } from "@/lib/telegram-translation-policy";

const MAX_LIVE_FEED_ITEMS = 100;
const SNAPSHOT_REFRESH_MS = 120000;

type LocalStreamStatus = Omit<TelegramRealtimeStatus, "state"> & {
  state: TelegramRealtimeStatus["state"] | "reconnecting";
};

const streamTone: Record<
  LocalStreamStatus["state"],
  {
    label: string;
    pill: string;
  }
> = {
  needs_config: {
    label: "未配置",
    pill: "bg-warning-soft text-warning",
  },
  connecting: {
    label: "连接中",
    pill: "bg-info-soft text-info",
  },
  connected: {
    label: "已连接",
    pill: "bg-success-soft text-success",
  },
  subscribed: {
    label: "实时中",
    pill: "bg-success-soft text-success",
  },
  closed: {
    label: "已关闭",
    pill: "bg-warning-soft text-warning",
  },
  error: {
    label: "异常",
    pill: "bg-danger-soft text-danger",
  },
  reconnecting: {
    label: "重连中",
    pill: "bg-warning-soft text-warning",
  },
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMessageTime(raw: string) {
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatLanguageTag(code: string) {
  if (!code || code === "unknown") {
    return "外文";
  }

  return code.toUpperCase();
}

function parseEventPayload<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

function sortFeed(feed: TelegramFeedItem[]) {
  return [...feed]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .slice(0, MAX_LIVE_FEED_ITEMS);
}

function mergeFeed(feed: TelegramFeedItem[], incoming: TelegramFeedItem) {
  return sortFeed([incoming, ...feed.filter((item) => item.id !== incoming.id)]);
}

async function requestTelegramSnapshot(
  signal?: AbortSignal,
): Promise<TelegramDashboardSnapshot> {
  const response = await fetch("/api/telegram", {
    method: "GET",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Telegram snapshot request failed (${response.status})`);
  }

  return (await response.json()) as TelegramDashboardSnapshot;
}

function mergeChannels(
  channels: TelegramChannelWatch[],
  incoming: TelegramChannelWatch[],
) {
  const channelMap = new Map<string, TelegramChannelWatch>();

  for (const channel of [...channels, ...incoming]) {
    channelMap.set(`${channel.channelId || channel.ref}:${channel.ref}`, channel);
  }

  return [...channelMap.values()];
}

function mergeSnapshot(
  current: TelegramDashboardSnapshot,
  incoming: TelegramDashboardSnapshot,
): TelegramDashboardSnapshot {
  const feedMap = new Map<string, TelegramFeedItem>();

  for (const item of [...current.feed, ...incoming.feed]) {
    feedMap.set(item.id, item);
  }

  const mergedFeed = sortFeed([...feedMap.values()]);

  return {
    ...current,
    ...incoming,
    isConnected: current.isConnected || incoming.isConnected,
    status:
      incoming.status === "error" && mergedFeed.length > 0 ? "live" : incoming.status,
    channels: mergeChannels(current.channels, incoming.channels),
    feed: mergedFeed,
  };
}

function mergeRealtimeChannel(
  channels: TelegramChannelWatch[],
  update: TelegramRealtimeUpdate,
): TelegramChannelWatch[] {
  if (channels.some((channel) => channel.ref === update.channel)) {
    return channels;
  }

  return [
    {
      ref: update.channel,
      title: update.channelTitle,
      username: update.feedItem.channelUsername,
      channelId: update.feedItem.channelId,
      link: update.feedItem.channelLink,
      access: "mtproto",
      note: "来自 Telegram 实时事件。",
      avatar: update.feedItem.channelAvatar,
    },
    ...channels,
  ];
}

function getMediaViewport(media: TelegramFeedItem["media"]) {
  const width = media?.width && media.width > 0 ? media.width : 1200;
  const height = media?.height && media.height > 0 ? media.height : 900;

  return {
    width,
    height,
  };
}

function makeInitialStreamStatus(
  initialSnapshot: TelegramDashboardSnapshot,
): LocalStreamStatus {
  return {
    state: initialSnapshot.isConfigured ? "connecting" : "needs_config",
    message: initialSnapshot.isConfigured
      ? "准备连接 Telegram MTProto 实时流..."
      : "还没有配置 Telegram 凭据，当前仅展示说明和占位信息。",
    at: new Date().toISOString(),
  };
}

type Props = {
  initialSnapshot: TelegramDashboardSnapshot;
};

export function TelegramLivePanel({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [streamStatus, setStreamStatus] = useState<LocalStreamStatus>(() =>
    makeInitialStreamStatus(initialSnapshot),
  );
  const deferredFeed = useDeferredValue(snapshot.feed);
  const lastRefreshAtRef = useRef(Date.now());
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    if (!initialSnapshot.isConfigured) {
      return;
    }

    let isActive = true;
    const refreshSnapshot = async () => {
      if (refreshInFlightRef.current) {
        return;
      }
      if (Date.now() - lastRefreshAtRef.current < 60000) {
        return;
      }
      refreshInFlightRef.current = true;
      lastRefreshAtRef.current = Date.now();

      try {
        const incoming = await requestTelegramSnapshot();
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setSnapshot((current) => mergeSnapshot(current, incoming));
        });
      } catch {
        // SSE remains the primary transport; polling only fills any gaps.
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const source = new EventSource("/api/telegram/stream");

    const handleStatus = (event: Event) => {
      const payload = parseEventPayload<TelegramRealtimeStatus>(event);
      if (!payload) {
        return;
      }

      setStreamStatus(payload);

      if (payload.state === "connected" || payload.state === "subscribed") {
        startTransition(() => {
          setSnapshot((current) => ({
            ...current,
            isConnected: true,
            status: "live",
          }));
        });
      }

      if (payload.state === "error") {
        startTransition(() => {
          setSnapshot((current) => ({
            ...current,
            status: current.feed.length > 0 ? "live" : "error",
          }));
        });
      }
    };

    const handleRealtimeEvent = (event: Event) => {
      const payload = parseEventPayload<TelegramRealtimeUpdate>(event);
      if (!payload) {
        return;
      }

      setStreamStatus({
        state: "subscribed",
        message: `实时收到 ${payload.channelTitle} 的新频道消息`,
        at: new Date().toISOString(),
      });

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          isConfigured: true,
          isConnected: true,
          status: "live",
          errors: [],
          channels: mergeRealtimeChannel(current.channels, payload),
          feed: mergeFeed(current.feed, payload.feedItem),
        }));
      });
    };

    source.addEventListener("status", handleStatus);
    source.addEventListener("telegram-event", handleRealtimeEvent);
    source.onerror = () => {
      setStreamStatus({
        state: "reconnecting",
        message: "Telegram 实时流短暂断开，浏览器正在自动重连...",
        at: new Date().toISOString(),
      });
    };

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshSnapshot();
      }
    }, SNAPSHOT_REFRESH_MS);

    const handleFocus = () => {
      void refreshSnapshot();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refreshSnapshot();

    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      source.removeEventListener("status", handleStatus);
      source.removeEventListener("telegram-event", handleRealtimeEvent);
      source.close();
    };
  }, [initialSnapshot.isConfigured]);

  const tone = streamTone[streamStatus.state];

  return (
    <section className="rounded-[32px] border border-line/70 bg-panel p-5 backdrop-blur-xl sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted">
            Telegram Connector
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
            Telegram Channel 实时流
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-muted">
          主链路走 Telegram 官方 MTProto 用户会话；浏览器端同时保留 SSE 和自动补拉，不用手动刷新也能把频道消息追上来。
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            实时状态
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${tone.pill}`}
            >
              {tone.label}
            </span>
            <span className="text-sm text-muted">MTProto</span>
          </div>
          <p className="mt-3 text-sm leading-7 text-muted">{streamStatus.message}</p>
        </article>

        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            监控频道
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {snapshot.channels.length}
          </p>
          <p className="mt-3 text-sm leading-7 text-muted">
            从 <code className="mx-1 font-mono text-xs">TELEGRAM_CHANNELS</code>
            解析频道，再同步每个频道最近的历史消息和后续增量。
          </p>
        </article>

        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            接入模式
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {snapshot.mode.toUpperCase()}
          </p>
          <p className="mt-3 text-sm leading-7 text-muted">{snapshot.note}</p>
        </article>
      </div>

      {snapshot.channels.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {snapshot.channels.map((channel) => (
            <a
              key={`${channel.ref}-${channel.channelId}`}
              href={channel.link}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-line/70 bg-panel-strong px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-panel"
            >
              {channel.username ? `@${channel.username}` : channel.title}
            </a>
          ))}
        </div>
      ) : null}

      {deferredFeed.length > 0 ? (
        <div className="mt-5 space-y-3">
          {deferredFeed.map((message) => {
            const mediaViewport = getMediaViewport(message.media);
            const visibleTranslation = shouldSkipTelegramChannelTranslation({
                channelUsername: message.channelUsername,
                channelRef: message.channelRef,
                channelTitle: message.channelTitle,
              })
              ? null
              : message.translation;

            return (
              <article
                key={message.id}
                className="rounded-[24px] border border-line/70 bg-panel-strong p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                      message.origin === "realtime"
                        ? "bg-accent-soft text-accent"
                        : "bg-info-soft text-info"
                    }`}
                  >
                    {message.origin === "realtime" ? "live" : "history"}
                  </span>
                  <a
                    href={message.channelLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-foreground"
                  >
                    {message.channelTitle}
                  </a>
                  <span className="text-sm text-muted">
                    {formatMessageTime(message.createdAt)}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-7 text-foreground">
                  {message.text}
                </p>

                {visibleTranslation ? (
                  <div className="mt-4 rounded-[18px] border border-info/20 bg-info-soft px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-info">
                      翻译备注 · {formatLanguageTag(visibleTranslation.sourceLanguage)}{" "}
                      -&gt; {visibleTranslation.targetLanguage}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-foreground">
                      {visibleTranslation.text}
                    </p>
                  </div>
                ) : null}

                {message.media ? (
                  <div className="mt-4 overflow-hidden rounded-[20px] border border-line/70 bg-panel-strong">
                    <Image
                      src={message.media.previewUrl}
                      alt={message.media.label}
                      width={mediaViewport.width}
                      height={mediaViewport.height}
                      unoptimized
                      className="block h-auto max-h-[22rem] w-full object-contain"
                    />
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                  <div className="flex flex-wrap gap-3">
                    {message.media ? <span>{message.media.label}</span> : null}
                    {message.views > 0 ? (
                      <span>阅读 {formatMetric(message.views)}</span>
                    ) : null}
                    {message.forwards > 0 ? (
                      <span>转发 {formatMetric(message.forwards)}</span>
                    ) : null}
                  </div>
                  <a
                    href={message.messageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent"
                  >
                    查看原帖
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <article className="mt-5 rounded-[24px] border border-dashed border-line/70 bg-panel-strong p-4">
          <h3 className="text-base font-semibold text-foreground">
            还没有可展示的 Telegram 频道数据
          </h3>
          <p className="mt-2 text-sm leading-7 text-muted">
            先在项目根目录创建 <code className="mx-1 font-mono text-xs">.env.local</code>
            ，填入 <code className="mx-1 font-mono text-xs">TELEGRAM_API_ID</code>、
            <code className="mx-1 font-mono text-xs">TELEGRAM_API_HASH</code>、
            <code className="mx-1 font-mono text-xs">TELEGRAM_SESSION</code> 和
            <code className="mx-1 font-mono text-xs">TELEGRAM_CHANNELS</code>。
          </p>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            api /api/telegram · /api/telegram/stream
          </p>
        </article>
      )}

      {snapshot.errors.length > 0 ? (
        <div className="mt-5 space-y-2">
          {snapshot.errors.map((error) => (
            <p
              key={error}
              className="rounded-[18px] bg-danger-soft px-4 py-3 text-sm leading-6 text-danger"
            >
              {error}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
