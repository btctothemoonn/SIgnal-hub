"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WecomNote, WecomReportDetail } from "@/lib/wecom-types";
import { WecomAddress, WecomField, WecomTime } from "./wecom-ui";

type NarrativeRenderer = (value: string) => ReactNode;
const nicknameClass = "font-extrabold text-[#138390]";
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function narrativeRenderer(report: WecomReportDetail["report"]): NarrativeRenderer {
  const names = [...new Set([
    ...report.sourceReferences.map((reference) => reference.sender),
    ...report.briefing.projects.flatMap((project) => (project.views ?? []).map((view) => view.speaker)),
  ].filter((name): name is string => !!name && !!name.trim()))];
  // Match complete known names, including names that themselves contain brackets.
  const variants = names.flatMap((name) => [name, `[${name}]`, `【${name}】`]).sort((a, b) => b.length - a.length);
  const pattern = variants.length ? new RegExp(variants.map(escapePattern).join("|"), "gu") : null;
  const referenceIds = report.sourceReferences.filter((reference) => !names.includes(reference.id)).map((reference) => reference.id).sort((left, right) => right.length - left.length);
  const ids = referenceIds.length ? `(?:${referenceIds.map(escapePattern).join("|")})(?![A-Za-z0-9_])` : "";
  const citationGroup = ids ? new RegExp(`(?:\\[|【|\\(|（)\\s*(?:(?:来源|引用)[：:]?\\s*)?(?:${ids})(?:[\\s,，、;；]+(?:${ids}))*\\s*(?:\\]|】|\\)|）)`, "g") : null;
  const citationLabel = ids ? new RegExp(`(?:来源|引用)[：:]\\s*(?:${ids})(?:[\\s,，、;；]+(?:${ids}))*`, "g") : null;
  const missingRecord = ids ? new RegExp(`(?<![A-Za-z0-9_])(?:${ids})(?=\\s*对应冻结记录)`, "g") : null;
  const snapshotLabel = names.includes("历史快照") ? null : /(?:\[|【|\(|（)\s*历史快照\s*(?:\]|】|\)|）)[：:]?\s*|历史快照[：:]\s*|^\s*历史快照\s*$/g;
  return (value) => {
    // Hide explicit citation notation only; an ID can also be a literal name or a URL segment.
    const urls = [...value.matchAll(/https?:\/\/[^\s<>"'，。；）】]+/gu)].map((match) => [match.index, match.index + match[0].length]);
    const removals = [citationGroup, citationLabel, missingRecord, snapshotLabel].filter((expression): expression is RegExp => !!expression)
      .flatMap((expression) => [...value.matchAll(expression)])
      .map((match) => [match.index, match.index + match[0].length])
      .filter(([start, end]) => !urls.some(([left, right]) => start < right && end > left))
      .sort(([left], [right]) => left - right);
    let text = "";
    let copiedTo = 0;
    for (const [start, end] of removals) {
      if (end <= copiedTo) continue;
      text += value.slice(copiedTo, Math.max(copiedTo, start));
      copiedTo = end;
    }
    text += value.slice(copiedTo);
    if (!pattern) return text;
    const protectedRanges = [...text.matchAll(/https?:\/\/[^\s<>"'，。；）】]+|0x[a-fA-F0-9]{40}\b|\$[\p{L}\p{N}_]+|[1-9A-HJ-NP-Za-km-z]{32,44}/gu)]
      .map((match) => [match.index, match.index + match[0].length]);
    const result: ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      if (protectedRanges.some(([left, right]) => start < right && end > left)) continue;
      const bracketed = !names.includes(token) && names.includes(token.slice(1, -1));
      if (!bracketed) {
        const before = Array.from(text.slice(0, start)).at(-1) ?? "";
        const after = Array.from(text.slice(end))[0] ?? "";
        const startsAtBoundary = !/[\p{L}\p{N}_]/u.test(before)
          || /(?:群友|用户|昵称|和|与|及|据|由)$/.test(text.slice(0, start));
        const endsAtBoundary = !/[\p{L}\p{N}_]/u.test(after)
          || /^(?:认为|表示|自述|更正|称|说|提到|提及|指出|分享|询问|回复|回应|建议|补充|确认|质疑|提醒|解释|关注|强调|看好|看空|买入|持有|转发|已经|在|已|对|的观点)/.test(text.slice(end));
        if (!startsAtBoundary || !endsAtBoundary) continue;
      }
      result.push(text.slice(cursor, start), <strong key={start} className={nicknameClass}>{token}</strong>);
      cursor = end;
    }
    result.push(text.slice(cursor));
    return result;
  };
}

function Note({ note, renderText }: { note: WecomNote; renderText: NarrativeRenderer }) {
  return <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{renderText(note.text)}</p>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 border-t border-workspace-line-strong py-4"><h4 className="mb-3 text-sm font-semibold">{title}</h4>{children}</section>;
}
function Notes({ notes, renderText }: { notes: WecomNote[]; renderText: NarrativeRenderer }) {
  return notes.length ? <div className="space-y-2">{notes.map((note, index) => <Note key={index} note={note} renderText={renderText} />)}</div> : <p className="text-sm text-muted">无有效信息</p>;
}

const reportTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function IntelligenceTime({ value, short = false }: { value: string | null; short?: boolean }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>未提供</span>;
  const formatted = reportTime.format(new Date(value)).replaceAll("/", "-");
  return <time dateTime={value}>{short ? formatted.slice(5, -3) : formatted}</time>;
}

function IntelligenceAddress({ address }: { address: string }) {
  const [feedback, setFeedback] = useState("");
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      if (alive.current) setFeedback("已复制");
    } catch {
      if (alive.current) setFeedback("复制失败");
    }
  }
  return <>
    <button type="button" title="复制完整 CA" aria-label={`复制地址 ${address}`} onClick={copy}
      className="min-w-0 max-w-full cursor-pointer select-text break-all text-left text-[11px] leading-[1.7] text-[#548fa8] hover:underline focus-visible:outline-2 focus-visible:outline-[#548fa8] sm:text-[12px]">CA: {address}</button>
    {feedback ? <span role="status" className="ml-2 text-[11px] text-[#898d99]">{feedback}</span> : null}
  </>;
}

function IntelligenceReport({ detail }: { detail: WecomReportDetail }) {
  const { report } = detail;
  const b = report.briefing;
  const missing = (value?: string) => !value || ["无", "未提供", "未确认", "无有效信息"].includes(value.trim());
  const attributed = narrativeRenderer(report);
  const row = (children: ReactNode, className = "") => <div className={`grid min-w-0 grid-cols-[7px_minmax(0,1fr)] gap-x-[10px] ${className}`}>
    <span aria-hidden className="mt-[0.62em] h-[7px] w-[7px] rounded-full" style={{ background: "var(--intel-ink, #159c9f)" }} />
    <div className="min-w-0 whitespace-pre-wrap">{children}</div>
  </div>;
  const field = (label: string, value?: string) => missing(value) ? null : row(<>{label}：{attributed(value!)}</>);
  const project = (item: typeof b.projects[number], index: number) => <article key={index} className="min-w-0 [break-inside:avoid]">
    <div className="mb-[5px] flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h5 className="min-w-0 text-[18px] leading-[1.3] tracking-[-0.6px] [font-family:Arial_Narrow,Arial,PingFang_SC,sans-serif] font-extrabold text-[#18212f] sm:text-[20px]">{item.name}{missing(item.chain) ? null : <> · {item.chain}</>}</h5>
      {item.addresses.map((address, addressIndex) => <IntelligenceAddress key={addressIndex} address={address.address} />)}
    </div>
    <div className="space-y-[3px]">
      {item.data.map((data, dataIndex) => <div key={dataIndex}>{field("数据", `${data.source} ${data.value} ${data.unit}（${data.recorded_at}）${missing(data.kind) || data.kind.trim() === "历史快照" ? "" : ` · ${data.kind}`}`)}</div>)}
      {field("动态", missing(item.latest) ? item.summary : item.latest)}
      {field("逻辑", item.catalysts)}
      {item.views?.length ? row(<>观点：{item.views.map((view, viewIndex) => <span key={viewIndex}>{viewIndex ? "；" : ""}<strong className={nicknameClass}>[{view.speaker}]</strong>：{attributed(view.text)}</span>)}</>) : null}
      {field("分歧", item.disagreement)}{field("风险", item.risks)}
    </div>
  </article>;
  const event = (item: typeof b.events[number], index: number) => <article key={index} className="min-w-0 [break-inside:avoid]">
    <h5 className="mb-[5px] text-[18px] leading-[1.3] tracking-[-0.6px] [font-family:Arial_Narrow,Arial,PingFang_SC,sans-serif] font-extrabold text-[#18212f] sm:text-[20px]">{attributed(item.event)}</h5>
    <div className="space-y-[3px]">{field("涉及", item.asset)}{field("性质", item.nature)}{field(item.section === "warning" ? "警示" : "动态", item.impact)}{field("待确认", item.pending)}</div>
  </article>;
  const sections = [
    ["opportunity", "机会与逻辑", "#a97616", "#fff0d4"],
    ["news", "消息面", "#2c83c0", "#e0f0ff"],
    ["subject", "标的与事件", "#28a078", "#e1f6eb"],
    ["market", "大盘与主流币", "#159c9f", "#def5f4"],
    ["warning", "警示", "#c94950", "#ffe5e7"],
  ];
  return <div className="intel-report mx-auto w-full min-w-0 max-w-[720px] bg-[#f5f5fb] px-[5%] pt-[25px] pb-[42px] text-[clamp(13px,2.1vw,15px)] leading-[1.6] text-[#565d68] [overflow-wrap:anywhere] sm:pt-[40px]" style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
    <header className="mb-3">
      <h3 className="text-[23px] leading-[1.3] tracking-[-0.7px] font-extrabold text-[#18212f] sm:text-[24px]">{report.scope.groupNames.length === 1 ? report.scope.groupNames[0] : "群聊"}情报</h3>
      <p className="mt-[5px] text-[13px] leading-[1.6] text-[#8b909b]"><IntelligenceTime value={report.windowStart} short /> 至 <IntelligenceTime value={report.windowEnd} short /></p>
    </header>
    <div className="space-y-[23px]">
      {sections.map(([key, title, ink, tint]) => {
        const cards = ["news", "warning"].includes(key) ? b.events.filter((item) => item.section === key).map(event) : b.projects.filter((item) => item.section === key).map(project);
        return <section key={key} style={{ "--intel-ink": ink } as CSSProperties}>
          <h4 className="mb-[10px] table rounded-[2px] border-l-[5px] pr-[10px] pl-[7px] text-[18px] leading-[1.15] font-bold sm:text-[20px]" style={{ color: ink, borderColor: ink, background: tint }}>{title}</h4>
          <div className="space-y-[15px] rounded-[4px] bg-white px-[15px] pt-[18px] pb-[16px] shadow-[0_3px_0_#dfe2eb] sm:px-[22px] sm:pt-[22px] sm:pb-[19px]">{cards.length ? cards : <p>无</p>}</div>
        </section>;
      })}
    </div>
    <details className="mt-6 text-[12px] leading-6 text-[#898d99]"><summary className="cursor-pointer">报告窗口 CA 聚合</summary>
      <Section title="报告窗口 CA 聚合">
        <p className="mb-3 text-xs text-muted">{report.caCoverage.sourcesComplete ? "CA 来源完整（冻结范围）" : "CA 来源不完整"} · 导出 {report.caCoverage.exportedItems} / {report.caCoverage.totalItems} · {report.caCoverage.truncated ? "CA 聚合已裁剪" : "CA 聚合未裁剪"}</p>
        {report.caDiscussions.length === 0 ? <p className="text-sm text-muted">本报告无 CA 聚合</p> : null}
        <div className="divide-y divide-workspace-line-strong">{report.caDiscussions.map((item, index) => <article key={index} className="min-w-0 py-3 first:pt-0">
          <WecomAddress address={item.address} network={item.network} />
          <p className="text-xs text-muted">{item.groups.join(" · ")}</p>
          <dl className="my-3 grid grid-cols-3 gap-3"><WecomField label="提及数">{item.mentionCount}</WecomField><WecomField label="去重陈述">{item.uniqueStatementCount}</WecomField><WecomField label="重复搬运">{item.duplicateCount}</WecomField></dl>
          <p className="whitespace-pre-wrap text-sm leading-6">{attributed(item.summary ?? "未提供")}</p>
        </article>)}</div>
      </Section>
    </details>
    {b.gaps.some((gap) => !missing(gap.text)) ? <aside className="mt-6 space-y-1 text-[12px] leading-6 text-[#898d99]">
      <p className="font-semibold">信息缺口</p>
      {b.gaps.map((gap, index) => <div key={index}>{field("缺口", gap.text)}</div>)}
    </aside> : null}
    <p className="mt-8 text-center text-[11px] leading-[1.6] text-[#a7aab5] sm:text-[12px]">由 {report.model} 根据{report.scope.groupNames.length === 1 ? report.scope.groupNames[0] : "已采集群聊"}聊天自动整理 · <IntelligenceTime value={report.generatedAt} /></p>
  </div>;
}

export function WecomReportView({ detail }: { detail: WecomReportDetail }) {
  const { report, syncedAt } = detail;
  const { briefing, scope, caCoverage } = report;
  const renderText = narrativeRenderer(report);
  if (briefing.version === 3 && briefing.kind === "market") return <IntelligenceReport detail={detail}/>;
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <header className="py-4">
        <h3 className="text-base font-semibold">{briefing.kind === "market" ? "市场简报" : "业务简报"}</h3>
        <p className="mt-1 text-xs text-muted">版本 {briefing.version} · 修订 {report.revision} · 模型 {report.model}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{renderText(report.summary)}</p>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-muted sm:grid-cols-3">
          <WecomField label="总结窗口"><WecomTime value={report.windowStart} /> 至 <WecomTime value={report.windowEnd} /></WecomField>
          <WecomField label="生成时间"><WecomTime value={report.generatedAt} /></WecomField>
          <WecomField label="同步时间"><WecomTime value={syncedAt} /></WecomField>
        </dl>
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-x-5 xl:grid-cols-3">
        {([['focus', '焦点'], ['news', '消息'], ['risk', '风险速览']] as const).map(([key, title]) => <Section key={key} title={title}><Note note={briefing.quick_read[key]} renderText={renderText} /></Section>)}
      </div>
      {briefing.kind === "market" ? <>
        <Section title="项目动态">
          {briefing.projects.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">
            {briefing.projects.map((project, index) => <article className="min-w-0 py-3 first:pt-0" key={index}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h5 className="min-w-0 text-sm font-semibold">{project.name} <span className="font-normal text-muted">{project.chain}</span></h5>
                {project.addresses.map((address, addressIndex) => <IntelligenceAddress key={addressIndex} address={address.address} />)}
              </div>
              <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 lg:grid-cols-2">
                <WecomField label="总结">{renderText(project.summary)}</WecomField>
                <WecomField label="催化">{renderText(project.catalysts)}</WecomField>
                <WecomField label="最新进展">{renderText(project.latest)}</WecomField>
                <WecomField label="风险">{renderText(project.risks)}</WecomField>
              </dl>
              {project.data.length ? <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                {project.data.map((data, dataIndex) => <div key={dataIndex} className="min-w-0 border-l-2 border-accent/30 pl-3">
                  {data.kind.trim() !== "历史快照" ? <dt className="text-xs text-muted">{renderText(data.kind)}</dt> : null}<dd className="mt-1 text-sm">
                    <p>{data.value} {data.unit}</p>
                    <p className="mt-1 text-xs text-muted">数据来源：{renderText(data.source)}</p>
                    <p className="mt-1 text-xs text-muted">原记录时间口径：{data.recorded_at}</p>
                  </dd>
                </div>)}
              </dl> : null}

            </article>)}
          </div>
        </Section>
        <Section title="事件">
          {briefing.events.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">
            {briefing.events.map((event, index) => <article key={index} className="py-3 first:pt-0">
              <h5 className="text-sm font-medium">{renderText(event.event)}</h5>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WecomField label="关联资产">{renderText(event.asset)}</WecomField><WecomField label="性质">{renderText(event.nature)}</WecomField>
                <WecomField label="影响">{renderText(event.impact)}</WecomField><WecomField label="待确认">{renderText(event.pending)}</WecomField>
              </dl>
            </article>)}
          </div>
        </Section>
      </> : <>
        {([['progress', '业务进展'], ['notices', '通知'], ['blockers', '阻塞']] as const).map(([key, title]) => <Section key={key} title={title}><Notes notes={briefing.business[key]} renderText={renderText} /></Section>)}
        <Section title="待办">
          {briefing.business.tasks.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">{briefing.business.tasks.map((task, index) => <article key={index} className="py-3 first:pt-0">
            <p className="whitespace-pre-wrap text-sm leading-6">{renderText(task.text)}</p>
            <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"><WecomField label="负责人">{renderText(task.owner)}</WecomField><WecomField label="截止时间">{task.deadline}</WecomField></dl>
          </article>)}</div>
        </Section>
      </>}
      <Section title="信息缺口"><Notes notes={briefing.gaps} renderText={renderText} /></Section>
      <Section title="报告窗口 CA 聚合">
        <p className="mb-3 text-xs text-muted">{caCoverage.sourcesComplete ? "CA 来源完整（冻结范围）" : "CA 来源不完整"} · 导出 {caCoverage.exportedItems} / {caCoverage.totalItems} · {caCoverage.truncated ? "CA 聚合已裁剪" : "CA 聚合未裁剪"}</p>
        {report.caDiscussions.length === 0 ? <p className="text-sm text-muted">本报告无 CA 聚合</p> : null}
        <div className="divide-y divide-workspace-line-strong">{report.caDiscussions.map((item, index) => <article key={index} className="min-w-0 py-3 first:pt-0">
          <WecomAddress address={item.address} network={item.network} />
          <p className="text-xs text-muted">{item.groups.join(" · ")}</p>
          <dl className="my-3 grid grid-cols-3 gap-3"><WecomField label="提及数">{item.mentionCount}</WecomField><WecomField label="去重陈述">{item.uniqueStatementCount}</WecomField><WecomField label="重复搬运">{item.duplicateCount}</WecomField></dl>
          <p className="whitespace-pre-wrap text-sm leading-6">{renderText(item.summary ?? "未提供")}</p>
        </article>)}</div>
      </Section>
      <Section title="范围与完整性">
        <p className="mb-3 whitespace-pre-wrap text-sm">{scope.groupNames.length ? scope.groupNames.join(" · ") : "未提供群名"}</p>
        <p className="text-xs text-muted">{report.sourceComplete ? "冻结来源完整" : "冻结来源存在缺口"}；不代表完整群聊，未做外部核验。</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <WecomField label="冻结输入">{scope.frozenCount}</WecomField><WecomField label="已分析">{scope.analyzedCount}</WecomField>
          <WecomField label="可读记录">{scope.readableCount}</WecomField><WecomField label="缺失记录">{scope.missingCount}</WecomField>
          <WecomField label="采集时间未知">{scope.unknownTimeCount}</WecomField><WecomField label="来源数">{report.sourceCount}</WecomField>
          <WecomField label="通知采集截止"><WecomTime value={scope.dataCutoff} /></WecomField><WecomField label="时间口径">通知采集时间 · {scope.timeZone}</WecomField>
        </dl>
      </Section>

    </div>
  );
}
