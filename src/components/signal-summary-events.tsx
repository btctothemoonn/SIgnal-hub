import type { AlphaSummarySnapshot } from "@/lib/alpha-summary";
import type { SignalSummaryEvent } from "@/lib/signal-summary-events";

export function formatSignalSummaryTime(raw: string | null | undefined, timeZone = "Asia/Shanghai") {
  if (!raw) return "未知";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "未知";
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "Asia/Shanghai" }).format(date);
  }
}

export function SignalSummaryFreshness({ snapshot }: { snapshot: AlphaSummarySnapshot | null }) {
  if (!snapshot) {
    return <p className="mb-4 text-xs leading-5 text-muted" role="status">正在读取总结与样本信息…</p>;
  }
  const timeZone = snapshot.period.timeZone;
  const coverage = snapshot.coverage;
  const failed = snapshot.status === "error" || snapshot.status === "needs_key";
  return (
    <div data-signal-summary-freshness className="mb-4 space-y-1 text-xs leading-5 text-muted">
      {failed && snapshot.summary ? (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
          <p className="font-semibold">更新失败，正在显示上次总结</p>
          {snapshot.error ? <p className="mt-1 break-words">{snapshot.error}</p> : null}
        </div>
      ) : null}
      <p>上次成功生成：{snapshot.generatedAt ? formatSignalSummaryTime(snapshot.generatedAt, timeZone) : snapshot.summary ? "未知" : "暂无"}</p>
      {failed ? <p>本次尝试：{formatSignalSummaryTime(snapshot.lastAttemptAt, timeZone)}</p> : null}
      {coverage ? (
        <>
          <p>实际纳入：{coverage.selectedCount} 条 / 候选 {coverage.candidateCount} 条</p>
          <p>样本时间：{coverage.startAt && coverage.endAt ? `${formatSignalSummaryTime(coverage.startAt, timeZone)} 至 ${formatSignalSummaryTime(coverage.endAt, timeZone)}` : "暂无消息时间范围"}</p>
        </>
      ) : (
        <p>总结消息：{snapshot.itemCount} 条 · 实际消息时间范围未知</p>
      )}
      <p>时区：{timeZone || "Asia/Shanghai"}</p>
    </div>
  );
}

const EVIDENCE_LABELS: Record<SignalSummaryEvent["evidenceType"], string> = {
  reported: "来源陈述",
  opinion: "作者观点",
  inference: "AI 推断",
};

const TRACKING_LABELS = {
  new: { label: "新增", style: "bg-info-soft text-info" },
  updated: { label: "有新进展", style: "bg-accent-soft text-accent" },
  continuing: { label: "继续观察", style: "bg-panel text-muted" },
  invalidated: { label: "失效", style: "bg-warning-soft text-warning" },
} as const;

function EventTrackingBadge({ event, historical = false }: { event: SignalSummaryEvent; historical?: boolean }) {
  const state = event.tracking?.state;
  if (!state) return null;
  const badge = TRACKING_LABELS[state];
  const label = historical && state === "new" ? "首次纳入" : historical && state === "updated" ? "此前有进展" : badge.label;
  return <span data-signal-event-state={state} className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${badge.style}`}>{label}</span>;
}

export function SignalSummaryEvents({ events, history = [], timeZone }: {
  events: SignalSummaryEvent[];
  history?: SignalSummaryEvent[];
  timeZone: string;
}) {
  const visibleEvents = events.map((event, index) => ({ event, index })).sort((left, right) => {
    const rank = (event: SignalSummaryEvent) => event.tracking?.state === "continuing" || !event.tracking ? 1 : 0;
    return rank(left.event) - rank(right.event) || left.index - right.index;
  }).slice(0, 5).map(({ event }) => event);
  const activeIds = new Set(events.flatMap((event) => event.tracking ? [event.tracking.id] : []));
  const historyEvents = history.filter((event) => event.tracking && !activeIds.has(event.tracking.id)).slice(0, 10);
  return (
    <section aria-label="事件跟踪" className="space-y-3">
      {visibleEvents.length > 0 ? <p className="text-xs font-semibold text-muted">值得跟踪的事件 · 本轮变化优先</p> : (
        <p className="rounded-lg border border-line/60 bg-panel-strong px-3 py-3 text-sm leading-6 text-muted">
          当前样本暂无值得跟踪的事件。可查看来源观点或等待新消息。
        </p>
      )}
      {visibleEvents.map((event, index) => (
        <article key={event.tracking?.id ?? `${event.title}-${index}`} data-signal-event-id={event.tracking?.id} className="rounded-lg border border-line/60 bg-panel-strong/90 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold leading-6 text-foreground">{event.title}</h3>
            <div className="flex flex-wrap gap-1.5">
              <EventTrackingBadge event={event} />
              <span className="shrink-0 rounded-md bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info">{EVIDENCE_LABELS[event.evidenceType]}</span>
            </div>
          </div>
          {event.tracking ? (
            <div className="mt-2 space-y-1 text-xs leading-5 text-muted">
              <p>首次跟踪：{formatSignalSummaryTime(event.tracking.firstSeenAt, timeZone)}</p>
              {event.tracking.previousGeneratedAt ? <p>对照上次：{formatSignalSummaryTime(event.tracking.previousGeneratedAt, timeZone)}</p> : null}
              <p className="break-words text-foreground">本轮变化：{event.tracking.note}</p>
            </div>
          ) : null}
          <div className="mt-3 space-y-3 text-sm leading-6">
            <div><p className="text-[11px] font-semibold text-muted">发生了什么变化</p><p className="break-words text-foreground">{event.change}</p></div>
            <div><p className="text-[11px] font-semibold text-muted">为什么继续跟踪</p><p className="break-words text-foreground">{event.whyTrack}</p></div>
            <div><p className="text-[11px] font-semibold text-muted">下一步观察</p><ul className="list-disc space-y-1 pl-4 text-muted">{event.watch.map((item) => <li key={item} className="break-words">{item}</li>)}</ul></div>
            <div><p className="text-[11px] font-semibold text-warning">失效条件</p><ul className="list-disc space-y-1 pl-4 text-warning">{event.invalidate.map((item) => <li key={item} className="break-words">{item}</li>)}</ul></div>
          </div>
          <div className="mt-4 border-t border-line/50 pt-3">
            <p className="text-[11px] font-semibold text-muted">原帖来源</p>
            <ul className="mt-1.5 space-y-1.5 text-xs leading-5">
              {event.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.link} target="_blank" rel="noreferrer noopener" className="break-words text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                    {source.author} · {source.source} · <time dateTime={source.createdAt}>{formatSignalSummaryTime(source.createdAt, timeZone)}</time>
                  </a>
                  {event.tracking?.newSourceIds.includes(source.id) ? <span data-signal-new-evidence className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">本轮新增原文</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
      {historyEvents.length > 0 ? (
        <details data-signal-event-history className="rounded-lg border border-line/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold leading-6 text-muted hover:text-foreground">此前跟踪 · 本轮未纳入 {historyEvents.length} 项</summary>
          <p className="mt-1 text-xs leading-5 text-muted">保留此前的观察记录，最近纳入时间与本轮总结分开显示。</p>
          <ul className="mt-2 space-y-3 text-xs leading-5">
            {historyEvents.map((event) => (
              <li key={event.tracking!.id}>
                <div className="flex flex-wrap items-center gap-2"><span className="break-words font-medium text-foreground">{event.title}</span><EventTrackingBadge event={event} historical /></div>
                <p className="mt-0.5 text-muted">最近纳入：{formatSignalSummaryTime(event.tracking!.lastSeenAt, timeZone)}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {event.sources.map((source) => <a key={source.id} href={source.link} target="_blank" rel="noreferrer noopener" className="break-words text-accent underline decoration-accent/30 underline-offset-2">{source.author} · 原文</a>)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
