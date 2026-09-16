import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { AlphaSummaryContent } from "@/lib/alpha-summary";
import type { AlphaEventSource } from "@/lib/alpha-summary-events";

function SourceLinks({ sources }: { sources: AlphaEventSource[] }) {
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
    <span>来源</span>
    {sources.map(source => source.link ? <a key={source.id} href={source.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1 text-info underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-info">
      <span className="break-words [overflow-wrap:anywhere]">{source.author}</span><ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
    </a> : <span key={source.id} className="break-words [overflow-wrap:anywhere]">{source.author}</span>)}
  </div>;
}

function Fold({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <details className="group border-t border-line/60 py-3">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      <span>{title}</span><span className="ml-auto text-xs font-normal tabular-nums text-muted">{count}</span>
    </summary>
    <div className="mt-3 space-y-4 text-sm leading-6">{children}</div>
  </details>;
}

function Lines({ items, tone = "text-foreground" }: { items: string[]; tone?: string }) {
  return <ul className={`space-y-2 ${tone}`}>{items.map((item, index) => <li key={`${index}-${item}`} className="break-words [overflow-wrap:anywhere]">{item}</li>)}</ul>;
}

export function SignalEventSummary({ summary }: { summary: AlphaSummaryContent }) {
  const brief = summary.eventBrief;
  const overview = brief?.overview.length ? brief.overview : [summary.headline].filter(Boolean);
  const differences = brief?.disagreements ?? [];
  const followUps = brief?.followUps ?? [];
  const followUpCount = followUps.length + summary.risks.length + summary.watchlist.length;
  return <div className="min-w-0" data-signal-event-summary>
    <section aria-label="本期速览" className="pb-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">本期速览</h2>
      <ol className="space-y-3">
        {overview.map((item, index) => <li key={`${index}-${item}`} className="flex items-start gap-3">
          <span className="w-4 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-accent">{String(index + 1).padStart(2, "0")}</span>
          <p className="min-w-0 break-words text-sm font-medium leading-6 text-foreground [overflow-wrap:anywhere]">{item}</p>
        </li>)}
      </ol>
    </section>
    {!!brief?.events.length && <section aria-label="重点事件" className="border-t border-line/60 pt-4">
      <h2 className="mb-1 text-sm font-semibold text-foreground">重点事件</h2>
      <div className="divide-y divide-line/50">
        {brief.events.map((event, index) => <article key={`${index}-${event.title}`} className="min-w-0 py-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {event.topic && <span className="max-w-full break-words text-xs font-semibold text-accent [overflow-wrap:anywhere]">{event.topic}</span>}
            <span className={`text-[11px] ${event.evidence === "unverified" ? "text-warning" : "text-muted"}`}>{event.evidence === "opinion" ? "个人观点" : event.evidence === "reported" ? "来源转述" : "未核实"}</span>
          </div>
          <h3 className="break-words text-sm font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">{event.title}</h3>
          <dl className="mt-2 grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-sm leading-6">
            <dt className="text-muted">变化</dt><dd className="break-words text-foreground [overflow-wrap:anywhere]">{event.change}</dd>
            {event.impact && <><dt className="text-muted">影响</dt><dd className="break-words text-muted [overflow-wrap:anywhere]">{event.impact}</dd></>}
            {!!event.watch.length && <><dt className="text-muted">关注</dt><dd><Lines items={event.watch} tone="text-info" /></dd></>}
          </dl>
          <SourceLinks sources={event.sources} />
        </article>)}
      </div>
    </section>}
    {(summary.consensus.length > 0 || differences.length > 0) && <Fold title="共识与分歧" count={summary.consensus.length + differences.length}>
      {!!summary.consensus.length && <section><h3 className="mb-2 text-xs font-semibold text-muted">共识</h3><Lines items={summary.consensus} /></section>}
      {!!differences.length && <section><h3 className="mb-2 text-xs font-semibold text-warning">分歧</h3><Lines items={differences} /></section>}
    </Fold>}
    {followUpCount > 0 && <Fold title="后续关注" count={followUpCount}>
      {followUps.map((item, index) => <article key={`${index}-${item.subject}`} className="min-w-0">
        <h3 className="break-words font-semibold text-foreground [overflow-wrap:anywhere]">{item.subject}</h3>
        <p className="mt-1 break-words text-foreground [overflow-wrap:anywhere]">{item.trigger}</p>
        {item.time && <p className="mt-1 break-words text-info [overflow-wrap:anywhere]">时间：{item.time}</p>}
        {item.risk && <p className="mt-1 break-words text-warning [overflow-wrap:anywhere]">风险条件：{item.risk}</p>}
        <SourceLinks sources={item.sources} />
      </article>)}
      {!!summary.watchlist.length && <section><h3 className="mb-2 text-xs font-semibold text-muted">关注标的</h3><p className="break-words text-info [overflow-wrap:anywhere]">{summary.watchlist.join(" · ")}</p></section>}
      {!!summary.risks.length && <section><h3 className="mb-2 text-xs font-semibold text-warning">风险提示</h3><Lines items={summary.risks} tone="text-warning" /></section>}
    </Fold>}
    {!!summary.authors.length && <Fold title="来源观点" count={summary.authors.length}>
      {summary.authors.map((author, index) => <article key={`${index}-${author.name}`} className="min-w-0">
        <h3 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-foreground"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{author.name}</span><span className="text-xs font-normal tabular-nums text-muted">{author.sourceCount} 条</span></h3>
        <p className="my-2 break-words text-foreground [overflow-wrap:anywhere]">{author.coreView}</p>
        <Lines items={author.alpha} tone="text-muted" />
        {!!author.watch.length && <p className="mt-2 break-words text-info [overflow-wrap:anywhere]">{author.watch.join(" · ")}</p>}
      </article>)}
    </Fold>}
  </div>;
}
