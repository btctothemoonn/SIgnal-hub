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

export function SignalSummaryEvents({ events, timeZone }: { events: SignalSummaryEvent[]; timeZone: string }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-line/60 bg-panel-strong px-3 py-3 text-sm leading-6 text-muted">
        当前样本暂无值得跟踪的事件。可查看来源观点或等待新消息。
      </p>
    );
  }
  return (
    <section aria-label="事件跟踪" className="space-y-3">
      <p className="text-xs font-semibold text-muted">值得跟踪的事件</p>
      {events.slice(0, 5).map((event, index) => (
        <article key={`${event.title}-${index}`} className="rounded-lg border border-line/60 bg-panel-strong/90 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold leading-6 text-foreground">{event.title}</h3>
            <span className="shrink-0 rounded-md bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info">{EVIDENCE_LABELS[event.evidenceType]}</span>
          </div>
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
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </section>
  );
}
