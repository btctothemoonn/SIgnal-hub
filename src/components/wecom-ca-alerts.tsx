"use client";

import type { WecomCaList } from "@/lib/wecom-types";
import { isWecomExpired } from "./wecom-session";
import { WecomAddress, WecomField, WecomTime } from "./wecom-ui";

export function WecomCaAlerts({ data, mode, now }: { data: WecomCaList | null; mode: "active" | "history"; now: number }) {
  if (!data) return <p className="py-4 text-sm text-muted">跨群提及暂不可用</p>;
  return (
    <div className="min-w-0">
      {mode === "active" ? <p className="mb-3 text-xs text-muted">
        有效总量 {data.total ?? "未提供"} · 本次读取 {data.items.length}
        {data.truncated ? <span className="ml-2 text-warning">仅显示前 {data.items.length} 条，列表已截断</span> : null}
      </p> : <p className="mb-3 text-xs text-muted">历史记录 {data.items.length} 条</p>}
      <p className="mb-3 text-xs leading-5 text-muted">跨群提及，非投资建议。重复搬运不等于独立证实；未注明链的讨论可能无法跨群合并。</p>
      {data.items.length === 0 ? <p className="py-5 text-sm text-muted">{mode === "active" ? "暂无有效跨群提及" : "暂无跨群提及历史"}</p> : null}
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {data.items.map((item) => {
          const expired = isWecomExpired(item, now);
          const early = item.status === "expired" && Date.parse(item.evaluatedAt) < Date.parse(item.expiresAt);
          return <article key={item.id} aria-label={`跨群提及 ${item.address}`} className="min-w-0 rounded-lg border border-workspace-line-strong bg-workspace-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={expired ? "text-muted" : "font-medium text-success"}>{early ? "提前关闭 · 已失效" : expired ? "已失效" : "有效"}</span>
              {item.catchup ? <span className="text-warning">追赶补传</span> : null}
              {item.delayed ? <span className="text-warning">延迟接收</span> : null}
              {item.notificationVersion === 0 && !item.catchup ? <span className="text-muted">新提示已抑制</span> : null}
              <span className="text-muted">修订 {item.revision}</span>
            </div>
            {expired ? <p className="mb-2 text-xs text-muted">最后有效快照；群名、计数与采集范围保留关闭前结果。</p> : null}
            <WecomAddress address={item.address} network={item.network} />
            <p className="mb-3 whitespace-pre-wrap text-xs leading-5 [overflow-wrap:anywhere]">{item.groups.join(" · ")}</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <WecomField label="群数">{item.groupCount}</WecomField>
              <WecomField label="提及数">{item.mentionCount}</WecomField>
              <WecomField label="去重陈述">{item.uniqueStatementCount}</WecomField>
              <WecomField label="重复搬运">{item.duplicateCount}</WecomField>
            </dl>
            <p className="mt-3 text-xs text-muted">统计窗口 {item.windowSeconds / 60} 分钟 · 阈值 {item.thresholdGroups} 群</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-muted sm:grid-cols-2">
              <WecomField label="通知采集范围"><WecomTime value={item.firstSeenAt} /> 至 <WecomTime value={item.lastSeenAt} /></WecomField>
              <WecomField label="触发时间"><WecomTime value={item.triggeredAt} /></WecomField>
              <WecomField label="评估时间"><WecomTime value={item.evaluatedAt} /></WecomField>
              <WecomField label="预计失效"><WecomTime value={item.expiresAt} /></WecomField>
              <WecomField label="首次接收"><WecomTime value={item.firstReceivedAt} /></WecomField>
              <WecomField label="同步时间"><WecomTime value={item.syncedAt} /></WecomField>
            </dl>
          </article>;
        })}
      </div>
    </div>
  );
}
