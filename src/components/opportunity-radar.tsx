"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserJsonCache } from "@/components/use-browser-json-cache";
import type {
  OpportunityCard,
  OpportunityListStatus,
  OpportunityMarketFilter,
  OpportunitySnapshot,
  OpportunitySort,
} from "@/lib/opportunity-types";

type OpportunityIconName =
  | "bookmark"
  | "chevron"
  | "external"
  | "refresh"
  | "x";

type OpportunitySnapshotMutation =
  | { type: "follow"; id: number; followed: boolean }
  | { type: "dismiss"; id: number };

type OpportunityRequestState = {
  sequence: number;
  loading: boolean;
  error: string | null;
};

export function nextOpportunityRequestSequence(
  sequences: Map<string, number>,
  key: string,
) {
  const next = (sequences.get(key) ?? 0) + 1;
  sequences.set(key, next);
  return next;
}

export function isOpportunityRequestCurrent(
  sequences: ReadonlyMap<string, number>,
  key: string,
  sequence: number,
) {
  return sequences.get(key) === sequence;
}

export function applyOpportunitySnapshotMutation(
  snapshot: OpportunitySnapshot,
  mutation: OpportunitySnapshotMutation,
): OpportunitySnapshot {
  if (mutation.type === "follow") {
    return {
      ...snapshot,
      items: snapshot.items.map((candidate) =>
        candidate.id === mutation.id
          ? { ...candidate, followed: mutation.followed }
          : candidate,
      ),
    };
  }

  return {
    ...snapshot,
    items:
      snapshot.status === "history"
        ? snapshot.items.map((candidate) =>
            candidate.id === mutation.id
              ? { ...candidate, dismissed: true }
              : candidate,
          )
        : snapshot.items.filter((candidate) => candidate.id !== mutation.id),
  };
}

const MARKET_LABELS: Record<OpportunityCard["market"], string> = {
  us: "美股",
  cn: "A股",
  crypto: "加密",
};

const EVENT_LABELS: Record<OpportunityCard["eventType"], string> = {
  earnings: "财报",
  order: "订单",
  policy: "政策",
  product: "产品",
  capital: "资本",
  "supply-chain": "供应链",
  other: "其他",
};

const STATUS_LABELS: Record<OpportunityCard["status"], string> = {
  new: "新机会",
  tracking: "跟踪中",
  confirmed: "已确认",
  expired: "已失效",
};

function OpportunityIcon({
  name,
  filled = false,
}: {
  name: OpportunityIconName;
  filled?: boolean;
}) {
  const common = {
    className: "h-4 w-4",
    viewBox: "0 0 24 24",
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "bookmark") {
    return (
      <svg {...common}>
        <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" />
      </svg>
    );
  }

  if (name === "chevron") {
    return (
      <svg {...common}>
        <path d="m7 10 5 5 5-5" />
      </svg>
    );
  }

  if (name === "external") {
    return (
      <svg {...common}>
        <path d="M14 4h6v6" />
        <path d="m20 4-9 9" />
        <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 11" />
        <path d="M17.9 15a7 7 0 0 1-11.6 2.6L4 13" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function formatOpportunityTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatMarketReaction(item: OpportunityCard) {
  const move = item.marketReaction.absoluteMovePercent;
  if (!item.marketReaction.available || move === null) return "待获取";
  return `${move > 0 ? "+" : ""}${move.toFixed(1)}%`;
}

function OpportunityDetailList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function OpportunityFilters({
  market,
  sort,
  status,
  onMarketChange,
  onSortChange,
  onStatusChange,
}: {
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  onMarketChange: (value: OpportunityMarketFilter) => void;
  onSortChange: (value: OpportunitySort) => void;
  onStatusChange: (value: OpportunityListStatus) => void;
}) {
  const selectClass =
    "mt-1 h-8 w-full min-w-0 rounded-md border border-line/70 bg-background/55 px-2 text-xs font-medium text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";

  return (
    <div className="mt-3 grid min-w-0 grid-cols-3 gap-1.5 sm:gap-2">
      <label className="min-w-0 text-[11px] font-medium text-muted">
        市场
        <select
          aria-label="市场"
          value={market}
          onChange={(event) =>
            onMarketChange(event.target.value as OpportunityMarketFilter)
          }
          className={selectClass}
        >
          <option value="all">全部</option>
          <option value="us">美股</option>
          <option value="cn">A股</option>
          <option value="crypto">加密</option>
        </select>
      </label>
      <label className="min-w-0 text-[11px] font-medium text-muted">
        排序
        <select
          aria-label="排序"
          value={sort}
          onChange={(event) =>
            onSortChange(event.target.value as OpportunitySort)
          }
          className={selectClass}
        >
          <option value="score">评分</option>
          <option value="latest">最新</option>
        </select>
      </label>
      <label className="min-w-0 text-[11px] font-medium text-muted">
        状态
        <select
          aria-label="状态"
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as OpportunityListStatus)
          }
          className={selectClass}
        >
          <option value="active">有效</option>
          <option value="history">历史</option>
        </select>
      </label>
    </div>
  );
}

function OpportunityCardView({
  item,
  onFollow,
  onDismiss,
}: {
  item: OpportunityCard;
  onFollow: (item: OpportunityCard, followed: boolean) => Promise<void>;
  onDismiss: (item: OpportunityCard) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<"follow" | "dismiss" | null>(
    null,
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const followLabel = item.followed ? "取消关注" : "关注";
  const dismissLabel = item.dismissed ? "已忽略" : "忽略";
  const thesis = item.thesis || (item.aiPending ? "AI 待补充" : "暂无机会摘要");

  const updateFollow = async () => {
    setPendingAction("follow");
    try {
      await onFollow(item, !item.followed);
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const dismiss = async () => {
    setPendingAction("dismiss");
    try {
      await onDismiss(item);
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <article className="min-w-0 rounded-lg border border-line/70 bg-panel px-3 py-3 shadow-[0_14px_32px_-30px_rgba(0,0,0,0.75)]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span aria-label={`评分 ${item.finalScore}`} className="text-base font-bold tabular-nums text-foreground">
              {item.finalScore}
            </span>
            <span>信心 {item.confidence}</span>
            <span>市场 {MARKET_LABELS[item.market]}</span>
            <span>事件 {EVENT_LABELS[item.eventType]}</span>
            <span>状态 {STATUS_LABELS[item.status]}</span>
          </div>
          <h3
            aria-label={`资产 ${item.assetKeys.join(" · ")}`}
            className="mt-1 break-words text-sm font-semibold text-foreground"
          >
            {item.assetKeys.join(" · ")}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={followLabel}
            title={followLabel}
            disabled={pendingAction !== null}
            onClick={() => void updateFollow()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-50"
          >
            <OpportunityIcon name="bookmark" filled={item.followed} />
          </button>
          <button
            type="button"
            aria-label={dismissLabel}
            title={dismissLabel}
            disabled={pendingAction !== null || item.dismissed}
            onClick={() => void dismiss()}
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-line/70 px-2 text-muted transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger disabled:opacity-60"
          >
            {item.dismissed ? (
              <span className="text-[11px] font-medium">已忽略</span>
            ) : (
              <OpportunityIcon name="x" />
            )}
          </button>
          <button
            type="button"
            aria-label={expanded ? "收起" : "展开"}
            title={expanded ? "收起" : "展开"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 text-muted transition-colors hover:bg-panel-strong hover:text-foreground"
          >
            <span className={expanded ? "rotate-180" : ""}>
              <OpportunityIcon name="chevron" />
            </span>
          </button>
        </div>
      </div>

      <p className="mt-1.5 break-words text-sm leading-5 text-foreground">
        {thesis}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          时间窗 {formatOpportunityTime(item.firstSeenAt)} 至{" "}
          {formatOpportunityTime(item.lastSeenAt)}
        </span>
        <span>来源 {item.evidence.length}</span>
        <span>价格反应 {formatMarketReaction(item)}</span>
        {item.validUntil ? (
          <span>有效至 {formatOpportunityTime(item.validUntil)}</span>
        ) : null}
      </div>

      {mutationError ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          操作失败：{mutationError}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-3 grid min-w-0 gap-3 border-t border-line/70 pt-3">
          <OpportunityDetailList title="理由" items={item.reasons} />
          <OpportunityDetailList title="风险" items={item.risks} />
          <OpportunityDetailList title="失效条件" items={item.invalidation} />
          {item.evidence.length > 0 ? (
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-muted">证据</h4>
              <div className="mt-1 grid min-w-0 gap-1.5">
                {item.evidence.map((evidence) => {
                  const linkLabel = `打开原文：${evidence.sourceName}`;
                  return (
                    <a
                      key={evidence.id}
                      href={evidence.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={linkLabel}
                      title={linkLabel}
                      className="flex min-w-0 items-start gap-1.5 rounded-md border border-line/60 px-2 py-1.5 text-xs text-info transition-colors hover:border-info/35 hover:bg-info-soft/40"
                    >
                      <span className="mt-0.5 shrink-0">
                        <OpportunityIcon name="external" />
                      </span>
                      <span className="min-w-0 break-words">
                        <strong className="font-semibold">{evidence.sourceName}</strong>
                        {evidence.textExcerpt ? ` · ${evidence.textExcerpt}` : ""}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function OpportunityRadar() {
  const [market, setMarket] = useState<OpportunityMarketFilter>("all");
  const [sort, setSort] = useState<OpportunitySort>("score");
  const [status, setStatus] = useState<OpportunityListStatus>("active");
  const cacheKey = `signal-hub:opportunities:v1:${market}:${sort}:${status}`;
  const [cached, writeCached] = useBrowserJsonCache<OpportunitySnapshot>(cacheKey);
  const [liveByKey, setLiveByKey] = useState<
    Record<string, OpportunitySnapshot>
  >({});
  const [requestStateByKey, setRequestStateByKey] = useState<
    Record<string, OpportunityRequestState>
  >({});
  const snapshotsRef = useRef(new Map<string, OpportunitySnapshot>());
  const requestSequencesRef = useRef(new Map<string, number>());
  const snapshot = liveByKey[cacheKey] ?? cached;
  const requestState = requestStateByKey[cacheKey];
  const loading = requestState?.loading ?? snapshot === null;
  const error = requestState?.error ?? null;

  useEffect(() => {
    if (snapshot) snapshotsRef.current.set(cacheKey, snapshot);
  }, [cacheKey, snapshot]);

  const commitSnapshot = useCallback(
    (key: string, next: OpportunitySnapshot) => {
      snapshotsRef.current.set(key, next);
      setLiveByKey((current) => ({ ...current, [key]: next }));
    },
    [],
  );

  const load = useCallback(async () => {
    const requestKey = cacheKey;
    const sequence = nextOpportunityRequestSequence(
      requestSequencesRef.current,
      requestKey,
    );
    setRequestStateByKey((current) => ({
      ...current,
      [requestKey]: { sequence, loading: true, error: null },
    }));
    try {
      const query = new URLSearchParams({ market, sort, status });
      const response = await fetch(`/api/opportunities?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as OpportunitySnapshot;
      if (
        !isOpportunityRequestCurrent(
          requestSequencesRef.current,
          requestKey,
          sequence,
        )
      ) {
        return;
      }
      commitSnapshot(requestKey, next);
      writeCached(next);
      setRequestStateByKey((current) => ({
        ...current,
        [requestKey]: { sequence, loading: false, error: null },
      }));
    } catch (loadError) {
      if (
        !isOpportunityRequestCurrent(
          requestSequencesRef.current,
          requestKey,
          sequence,
        )
      ) {
        return;
      }
      setRequestStateByKey((current) => ({
        ...current,
        [requestKey]: {
          sequence,
          loading: false,
          error:
            loadError instanceof Error ? loadError.message : String(loadError),
        },
      }));
    }
  }, [cacheKey, commitSnapshot, market, sort, status, writeCached]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const replaceSnapshot = useCallback(
    (mutation: OpportunitySnapshotMutation) => {
      const sequence = nextOpportunityRequestSequence(
        requestSequencesRef.current,
        cacheKey,
      );
      const current = snapshotsRef.current.get(cacheKey);
      if (!current) return;
      const next = applyOpportunitySnapshotMutation(current, mutation);
      commitSnapshot(cacheKey, next);
      writeCached(next);
      setRequestStateByKey((requestStates) => ({
        ...requestStates,
        [cacheKey]: { sequence, loading: false, error: null },
      }));
    },
    [cacheKey, commitSnapshot, writeCached],
  );

  const follow = useCallback(
    async (item: OpportunityCard, followed: boolean) => {
      const response = await fetch(`/api/opportunities/${item.id}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followed }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      replaceSnapshot({ type: "follow", id: item.id, followed });
    },
    [replaceSnapshot],
  );

  const dismiss = useCallback(
    async (item: OpportunityCard) => {
      const response = await fetch(`/api/opportunities/${item.id}/dismiss`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      replaceSnapshot({ type: "dismiss", id: item.id });
    },
    [replaceSnapshot],
  );

  return (
    <section className="min-w-0 rounded-lg border border-line/70 bg-panel-strong/95 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">机会雷达</h2>
          <p className="truncate text-[11px] text-muted">
            {snapshot ? `快照 ${formatOpportunityTime(snapshot.generatedAt)}` : "本地缓存"}
          </p>
        </div>
        <button
          type="button"
          aria-label="刷新机会快照"
          title="刷新机会快照"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line/70 text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-50"
        >
          <span className={loading ? "animate-spin" : ""}>
            <OpportunityIcon name="refresh" />
          </span>
        </button>
      </div>

      <OpportunityFilters
        market={market}
        sort={sort}
        status={status}
        onMarketChange={setMarket}
        onSortChange={setSort}
        onStatusChange={setStatus}
      />

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-danger/35 bg-danger-soft px-2.5 py-2 text-xs text-danger">
          加载失败：{error}；已保留上次缓存。
        </p>
      ) : null}
      {loading && !snapshot ? (
        <p className="py-10 text-center text-sm text-muted">加载机会快照...</p>
      ) : null}

      <div className="mt-3 grid min-w-0 gap-2">
        {snapshot?.items.map((item) => (
          <OpportunityCardView
            key={item.id}
            item={item}
            onFollow={follow}
            onDismiss={dismiss}
          />
        ))}
        {snapshot && snapshot.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            当前筛选暂无机会
          </p>
        ) : null}
      </div>
    </section>
  );
}
