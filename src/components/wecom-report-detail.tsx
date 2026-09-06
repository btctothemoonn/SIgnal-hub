"use client";

import { useId, type ReactNode } from "react";
import type { WecomNote, WecomReportDetail } from "@/lib/wecom-types";
import { WecomAddress, WecomField, WecomTime } from "./wecom-ui";

function References({ ids, prefix }: { ids: string[]; prefix: string }) {
  return ids.length ? <span className="ml-2 inline-flex flex-wrap gap-2 text-xs text-accent">
    {ids.map((id) => <a key={id} className="underline underline-offset-2" href={`#${prefix}-${id}`} aria-label={`来源元数据 ${id}`}>{id}</a>)}
  </span> : null;
}
function Note({ note, prefix }: { note: WecomNote; prefix: string }) {
  return <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{note.text}<References ids={note.source_message_ids} prefix={prefix} /></p>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 border-t border-workspace-line-strong py-4"><h4 className="mb-3 text-sm font-semibold">{title}</h4>{children}</section>;
}
function Notes({ notes, prefix }: { notes: WecomNote[]; prefix: string }) {
  return notes.length ? <div className="space-y-2">{notes.map((note, index) => <Note key={index} note={note} prefix={prefix} />)}</div> : <p className="text-sm text-muted">无有效信息</p>;
}

export function WecomReportView({ detail }: { detail: WecomReportDetail }) {
  const { report, syncedAt } = detail;
  const { briefing, scope, caCoverage } = report;
  const prefix = useId().replaceAll(":", "");
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <header className="py-4">
        <h3 className="text-base font-semibold">{briefing.kind === "market" ? "市场简报" : "业务简报"}</h3>
        <p className="mt-1 text-xs text-muted">版本 {briefing.version} · 修订 {report.revision} · 模型 {report.model}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{report.summary}</p>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-muted sm:grid-cols-3">
          <WecomField label="总结窗口"><WecomTime value={report.windowStart} /> 至 <WecomTime value={report.windowEnd} /></WecomField>
          <WecomField label="生成时间"><WecomTime value={report.generatedAt} /></WecomField>
          <WecomField label="同步时间"><WecomTime value={syncedAt} /></WecomField>
        </dl>
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-x-5 xl:grid-cols-3">
        {([['focus', '焦点'], ['news', '消息'], ['risk', '风险速览']] as const).map(([key, title]) => <Section key={key} title={title}><Note note={briefing.quick_read[key]} prefix={prefix} /></Section>)}
      </div>
      {briefing.kind === "market" ? <>
        <Section title="项目动态">
          {briefing.projects.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">
            {briefing.projects.map((project, index) => <article className="min-w-0 py-3 first:pt-0" key={index}>
              <h5 className="text-sm font-semibold">{project.name} <span className="font-normal text-muted">{project.chain}</span><References ids={project.source_message_ids} prefix={prefix} /></h5>
              <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 lg:grid-cols-2">
                <WecomField label="总结">{project.summary}</WecomField>
                <WecomField label="催化">{project.catalysts}</WecomField>
                <WecomField label="最新进展">{project.latest}</WecomField>
                <WecomField label="风险">{project.risks}</WecomField>
              </dl>
              {project.data.length ? <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                {project.data.map((data, dataIndex) => <div key={dataIndex} className="min-w-0 border-l-2 border-accent/30 pl-3">
                  <dt className="text-xs text-muted">{data.kind}</dt><dd className="mt-1 text-sm">
                    <p>{data.value} {data.unit}<References ids={data.source_message_ids} prefix={prefix} /></p>
                    <p className="mt-1 text-xs text-muted">数据来源：{data.source}</p>
                    <p className="mt-1 text-xs text-muted">原记录时间口径：{data.recorded_at}</p>
                  </dd>
                </div>)}
              </dl> : null}
              {project.addresses.map((address, addressIndex) => <div key={addressIndex} className="mt-3 min-w-0">
                <WecomAddress address={address.address} network={address.chain} /><References ids={address.source_message_ids} prefix={prefix} />
              </div>)}
            </article>)}
          </div>
        </Section>
        <Section title="事件">
          {briefing.events.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">
            {briefing.events.map((event, index) => <article key={index} className="py-3 first:pt-0">
              <h5 className="text-sm font-medium">{event.event}<References ids={event.source_message_ids} prefix={prefix} /></h5>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WecomField label="关联资产">{event.asset}</WecomField><WecomField label="性质">{event.nature}</WecomField>
                <WecomField label="影响">{event.impact}</WecomField><WecomField label="待确认">{event.pending}</WecomField>
              </dl>
            </article>)}
          </div>
        </Section>
      </> : <>
        {([['progress', '业务进展'], ['notices', '通知'], ['blockers', '阻塞']] as const).map(([key, title]) => <Section key={key} title={title}><Notes notes={briefing.business[key]} prefix={prefix} /></Section>)}
        <Section title="待办">
          {briefing.business.tasks.length === 0 ? <p className="text-sm text-muted">无有效信息</p> : null}
          <div className="divide-y divide-workspace-line-strong">{briefing.business.tasks.map((task, index) => <article key={index} className="py-3 first:pt-0">
            <p className="whitespace-pre-wrap text-sm leading-6">{task.text}<References ids={task.source_message_ids} prefix={prefix} /></p>
            <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"><WecomField label="负责人">{task.owner}</WecomField><WecomField label="截止时间">{task.deadline}</WecomField></dl>
          </article>)}</div>
        </Section>
      </>}
      <Section title="信息缺口"><Notes notes={briefing.gaps} prefix={prefix} /></Section>
      <Section title="报告窗口 CA 聚合">
        <p className="mb-3 text-xs text-muted">{caCoverage.sourcesComplete ? "CA 来源完整（冻结范围）" : "CA 来源不完整"} · 导出 {caCoverage.exportedItems} / {caCoverage.totalItems} · {caCoverage.truncated ? "CA 聚合已裁剪" : "CA 聚合未裁剪"}</p>
        {report.caDiscussions.length === 0 ? <p className="text-sm text-muted">本报告无 CA 聚合</p> : null}
        <div className="divide-y divide-workspace-line-strong">{report.caDiscussions.map((item, index) => <article key={index} className="min-w-0 py-3 first:pt-0">
          <WecomAddress address={item.address} network={item.network} />
          <p className="text-xs text-muted">{item.groups.join(" · ")}</p>
          <dl className="my-3 grid grid-cols-3 gap-3"><WecomField label="提及数">{item.mentionCount}</WecomField><WecomField label="去重陈述">{item.uniqueStatementCount}</WecomField><WecomField label="重复搬运">{item.duplicateCount}</WecomField></dl>
          <p className="whitespace-pre-wrap text-sm leading-6">{item.summary ?? "未提供"}<References ids={item.sourceMessageIDs} prefix={prefix} /></p>
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
        <p className="mt-3 text-xs text-muted">原文仅保存在 Mac，未同步。{report.sourcesTruncated ? "原文不分享，不表示简报正文被裁剪。" : "无原文分享。"}</p>
      </Section>
      <Section title="来源元数据">
        {report.sourceReferences.length === 0 ? <p className="text-sm text-muted">无引用元数据</p> : null}
        <dl className="divide-y divide-workspace-line-strong">{report.sourceReferences.map((source) => <div id={`${prefix}-${source.id}`} key={source.id} className="grid min-w-0 scroll-mt-28 grid-cols-1 gap-2 py-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
          <dt className="font-mono text-xs text-muted">{source.id}</dt>
          <dd className="min-w-0 text-xs leading-6">
            {source.available ? <><p className="whitespace-pre-wrap">{source.group ?? "群名未提供"} · {source.sender ?? "昵称未提供"}</p><p className="text-muted">通知采集时间：<WecomTime value={source.observedAt} /></p></> : <p className="text-warning">来源记录缺失；群名、昵称与采集时间未提供。</p>}
          </dd>
        </div>)}</dl>
      </Section>
    </div>
  );
}
