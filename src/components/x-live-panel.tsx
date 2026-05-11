"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type {
  TwitterDashboardSnapshot,
  TwitterFeedItem,
  TwitterWatchAccount,
} from "@/lib/6551-twitter";

const MAX_LIVE_FEED_ITEMS = 100;

type LocalStreamStatus = {
  state:
    | "needs_token"
    | "paused"
    | "connecting"
    | "connected"
    | "subscribed"
    | "error"
    | "reconnecting";
  message: string;
  at: string;
};

const streamTone: Record<
  LocalStreamStatus["state"],
  { label: string; pill: string }
> = {
  needs_token: { label: "Needs token", pill: "bg-warning-soft text-warning" },
  paused: { label: "Paused", pill: "bg-warning-soft text-warning" },
  connecting: { label: "Connecting", pill: "bg-info-soft text-info" },
  connected: { label: "Connected", pill: "bg-success-soft text-success" },
  subscribed: { label: "Live", pill: "bg-success-soft text-success" },
  error: { label: "Error", pill: "bg-danger-soft text-danger" },
  reconnecting: { label: "Reconnecting", pill: "bg-warning-soft text-warning" },
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTweetTime(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseEventPayload<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

function sortFeed(feed: TwitterFeedItem[]) {
  return [...feed]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .slice(0, MAX_LIVE_FEED_ITEMS);
}

function mergeWatchAccounts(
  watchAccounts: TwitterWatchAccount[],
  incoming: TwitterWatchAccount[],
) {
  const accountMap = new Map<string, TwitterWatchAccount>();
  for (const account of [...watchAccounts, ...incoming]) {
    accountMap.set(account.username.toLowerCase(), account);
  }
  return [...accountMap.values()];
}

function mergeSnapshot(
  current: TwitterDashboardSnapshot,
  incoming: TwitterDashboardSnapshot,
): TwitterDashboardSnapshot {
  const feedMap = new Map<string, TwitterFeedItem>();
  for (const item of [...current.feed, ...incoming.feed]) {
    feedMap.set(item.id, item);
  }
  const mergedFeed = sortFeed([...feedMap.values()]);

  return {
    ...current,
    ...incoming,
    isConnected: current.isConnected || incoming.isConnected,
    status:
      incoming.status === "error" && mergedFeed.length > 0
        ? "live"
        : incoming.status,
    watchAccounts: mergeWatchAccounts(
      current.watchAccounts,
      incoming.watchAccounts,
    ),
    feed: mergedFeed,
  };
}

function makeInitialStreamStatus(
  initialSnapshot: TwitterDashboardSnapshot,
): LocalStreamStatus {
  if (initialSnapshot.status === "paused") {
    return {
      state: "paused",
      message: "X pipeline is paused.",
      at: new Date().toISOString(),
    };
  }

  if (!initialSnapshot.isConfigured) {
    return {
      state: "needs_token",
      message: "TWITTER_TOKEN is not configured.",
      at: new Date().toISOString(),
    };
  }

  return {
    state: initialSnapshot.isConnected ? "subscribed" : "connecting",
    message: initialSnapshot.note,
    at: new Date().toISOString(),
  };
}

type Props = {
  initialSnapshot: TwitterDashboardSnapshot;
};

export function XLivePanel({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [streamStatus, setStreamStatus] = useState<LocalStreamStatus>(() =>
    makeInitialStreamStatus(initialSnapshot),
  );
  const deferredFeed = useDeferredValue(snapshot.feed);

  useEffect(() => {
    if (!initialSnapshot.isConfigured || initialSnapshot.status === "paused") {
      return;
    }

    let isActive = true;
    const source = new EventSource("/api/x/events");

    const handleSnapshot = (event: Event) => {
      const payload = parseEventPayload<TwitterDashboardSnapshot>(event);
      if (!payload || !isActive) return;

      setStreamStatus({
        state: payload.isConnected ? "subscribed" : "connected",
        message: payload.note,
        at: new Date().toISOString(),
      });

      startTransition(() => {
        setSnapshot((current) => mergeSnapshot(current, payload));
      });
    };

    source.addEventListener("x-snapshot", handleSnapshot);
    source.onerror = () => {
      setStreamStatus({
        state: "reconnecting",
        message: "Local X event stream disconnected; reconnecting.",
        at: new Date().toISOString(),
      });
    };

    return () => {
      isActive = false;
      source.removeEventListener("x-snapshot", handleSnapshot);
      source.close();
    };
  }, [initialSnapshot.isConfigured, initialSnapshot.status]);

  const tone = streamTone[streamStatus.state];

  return (
    <section className="rounded-[32px] border border-line/70 bg-panel p-5 backdrop-blur-xl sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted">
            X Connector
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
            Local X Pipeline
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-muted">
          Browser reads local SQLite snapshots. A background worker owns the
          single 6551 WebSocket connection.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Stream
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${tone.pill}`}
            >
              {tone.label}
            </span>
            <span className="text-sm text-muted">local SSE</span>
          </div>
          <p className="mt-3 text-sm leading-7 text-muted">
            {streamStatus.message}
          </p>
        </article>

        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Accounts
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {snapshot.watchAccounts.length}
          </p>
        </article>

        <article className="rounded-[22px] border border-line/70 bg-panel-strong p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Feed
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {snapshot.feed.length}
          </p>
        </article>
      </div>

      {deferredFeed.length > 0 ? (
        <div className="mt-5 space-y-3">
          {deferredFeed.map((tweet) => (
            <article
              key={tweet.id}
              className="rounded-[24px] border border-line/70 bg-panel-strong p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={tweet.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-foreground"
                >
                  @{tweet.username}
                </a>
                <span className="text-sm text-muted">{tweet.queryLabel}</span>
                <span className="text-sm text-muted">
                  {formatTweetTime(tweet.createdAt)}
                </span>
              </div>

              <p className="mt-3 text-sm leading-7 text-foreground">
                {tweet.text}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                <div className="flex flex-wrap gap-3">
                  <span>Like {formatMetric(tweet.likes)}</span>
                  <span>RT {formatMetric(tweet.retweets)}</span>
                  <span>Reply {formatMetric(tweet.replies)}</span>
                  {tweet.views > 0 ? (
                    <span>View {formatMetric(tweet.views)}</span>
                  ) : null}
                </div>
                <a
                  href={tweet.tweetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent"
                >
                  Open
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <article className="mt-5 rounded-[24px] border border-dashed border-line/70 bg-panel-strong p-4">
          <h3 className="text-base font-semibold text-foreground">
            No local X feed yet
          </h3>
          <p className="mt-2 text-sm leading-7 text-muted">
            Start the X pipeline worker and wait for 6551 WebSocket events.
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
