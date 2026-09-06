import { Activity, Cpu, Monitor, Radio } from "lucide-react";
import type { WecomSyncStatus } from "@/lib/wecom-types";
import { WecomField, WecomTime } from "./wecom-ui";

export function WecomStatus({ status, now }: { status: WecomSyncStatus | null; now: number }) {
  if (!status) return <section aria-label="设备状态" className="border-y border-workspace-line-strong py-4"><p className="text-sm text-muted">状态暂不可用</p></section>;
  const stale = status.connection === "offline" || (status.lastSeenAt !== null && now - Date.parse(status.lastSeenAt) > 180_000);
  const processLabel = (value: string) => stale ? "状态已过时" : value === "online" ? "在线" : value === "offline" ? "离线" : "未知";
  const connectionLabel = !status.configured ? "未配置" : stale ? "离线" : status.connection === "waiting" ? "等待连接" : "在线";
  // Heartbeats arrive every 60s. An aged observation is not proof of an outage.
  const caAwaitingEvidence = status.caDetector === "online" && status.lastCaEvaluatedAt && now - Date.parse(status.lastCaEvaluatedAt) > 30_000;
  const channels = [
    { label: "设备连接", value: connectionLabel, icon: Monitor },
    { label: "监听", value: processLabel(status.listener), icon: Radio },
    { label: "总结进程", value: processLabel(status.worker), icon: Cpu },
    { label: "CA 检测", value: !stale && caAwaitingEvidence ? "状态待更新" : processLabel(status.caDetector), icon: Activity },
  ];
  return (
    <section aria-label="设备状态" className="border-y border-workspace-line-strong py-4">
      <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-4">
        {channels.map(({ label, value, icon: Icon }) => <div key={label} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted" />
          <span>{label}</span><span className={value === "在线" ? "text-success" : "text-muted"}>{value}</span>
        </div>)}
      </div>
      {stale ? <p className="mt-3 text-xs text-warning">状态已过时，进程状态不代表当前在线情况。</p> : null}
      <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-muted lg:grid-cols-3 xl:grid-cols-6">
        <WecomField label="报告待发送">{status.pendingReports}</WecomField>
        <WecomField label="CA 待发送">{status.pendingAlerts}</WecomField>
        <WecomField label="设备最近连接"><WecomTime value={status.lastSeenAt} /></WecomField>
        <WecomField label="最近报告接收"><WecomTime value={status.lastReportAt} /></WecomField>
        <WecomField label="最近通知采集时间"><WecomTime value={status.lastMessageObservedAt} /></WecomField>
        <WecomField label="最近 CA 评估"><WecomTime value={status.lastCaEvaluatedAt} /></WecomField>
      </dl>
      {status.lastError ? <p className="mt-3 text-xs text-warning [overflow-wrap:anywhere]">设备错误码：{status.lastError}</p> : null}
    </section>
  );
}
