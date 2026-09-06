"use client";

import { ArrowDown, ChevronDown, ChevronUp, LoaderCircle, MessagesSquare, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { WecomCadence } from "@/lib/wecom-types";
import { WecomSession, type WecomInitial } from "./wecom-session";
import { WecomReportView } from "./wecom-report-detail";
import { WecomCaAlerts } from "./wecom-ca-alerts";
import { WecomStatus } from "./wecom-status";
import { WecomTime, wecomCommand, wecomIconButton } from "./wecom-ui";

const cadences: { value: WecomCadence; label: string }[] = [
  { value: "two_hour", label: "2 小时" },
  { value: "six_hour", label: "6 小时" },
  { value: "daily", label: "日报" },
];

function ReadError({ message }: { message?: string }) {
  return message ? <p role="alert" className="my-3 text-xs leading-5 text-warning">{message}</p> : null;
}

export function WecomPanel(props: WecomInitial) {
  const [session] = useState(() => new WecomSession(props, {
    fetch: (url, options) => fetch(url, options),
    now: () => Date.now(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
    onUnauthorized: () => window.location.replace("/login?next=%2Fwecom"),
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const reportRegion = useId();

  useEffect(() => {
    const visible = () => document.visibilityState !== "hidden";
    const visibilityChanged = () => session.setVisible(visible());
    const resume = () => { session.setVisible(visible()); session.resume(); };
    const pageHide = () => session.setVisible(false);
    session.start(visible());
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("online", resume);
      session.stop();
    };
  }, [session]);

  // Never render the SSR seed again after this session's read access is revoked.
  if (state.auth !== "ok") return <section className="py-4">
    <h2 className="text-lg font-semibold">企业微信</h2>
    <p role="alert" className="mt-3 text-sm text-muted">{state.auth === 401 ? "登录已失效，正在前往登录页。" : "无权访问此设备数据，请确认当前账号的访问授权。"}</p>
  </section>;

  const caData = state.caMode === "active" ? state.activeAlerts : state.caHistory;
  const busy = Object.values(state.loading).some(Boolean);
  return (
    <div className="min-w-0 text-foreground">
      <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessagesSquare aria-hidden className="h-5 w-5 shrink-0 text-accent" />
          <h2 className="text-lg font-semibold">企业微信</h2>
          <span className="text-xs text-muted">Asia/Shanghai</span>
        </div>
        <button type="button" aria-label="刷新企业微信" title="刷新企业微信" className={wecomIconButton} disabled={busy} onClick={() => session.refresh()}>
          {busy ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden className="h-4 w-4" />}
        </button>
      </header>
      <ReadError message={state.errors.status} />
      <WecomStatus status={state.status} now={state.now} />
      <div className="grid min-w-0 grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <section aria-label="群聊简报" className="min-w-0 py-5">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">群聊简报</h3>
            <div role="group" aria-label="简报周期" className="inline-flex max-w-full flex-wrap rounded-md border border-workspace-line-strong p-0.5">
              {cadences.map(({ value, label }) => <button key={value} type="button" aria-pressed={state.cadence === value} onClick={() => session.setCadence(value)} className={`min-h-8 min-w-16 rounded px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${state.cadence === value ? "bg-accent-soft text-foreground" : "text-muted hover:text-foreground"}`}>{label}</button>)}
            </div>
          </header>
          <ReadError message={state.errors.reports} />
          {state.loading.reports ? <p role="status" className="my-2 text-xs text-muted">正在读取简报</p> : null}
          {!state.reports && !state.loading.reports ? <p className="py-4 text-sm text-muted">简报暂不可用</p> : null}
          {state.reports?.items.length === 0 ? <p className="py-4 text-sm text-muted">此周期暂无简报</p> : null}
          <div className="divide-y divide-workspace-line-strong">
            {state.reports?.items.map((report, index) => {
              const expanded = state.selectedId === report.id;
              const contentId = `${reportRegion}-${index}`;
              return <article key={report.id} className="min-w-0 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <button type="button" aria-expanded={expanded} aria-controls={contentId} aria-label={expanded ? "收起简报" : "展开简报"} title={expanded ? "收起简报" : "展开简报"} className={wecomIconButton} onClick={() => session.selectReport(expanded ? null : report.id)}>
                    {expanded ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-muted">总结窗口 · <WecomTime value={report.windowStart} /> 至 <WecomTime value={report.windowEnd} /></p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{report.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      <span>来源 {report.sourceCount}</span><span>{report.sourceComplete ? "冻结来源完整" : "冻结来源存在缺口"}</span>
                      <span>生成时间 <WecomTime value={report.generatedAt} /></span><span>同步时间 <WecomTime value={report.syncedAt} /></span>
                      <span className="[overflow-wrap:anywhere]">模型 {report.model}</span>
                    </div>
                  </div>
                </div>
                <div id={contentId} hidden={!expanded} className="min-w-0">
                  {expanded ? <>
                    <ReadError message={state.errors.detail} />
                    {state.loading.detail ? <p role="status" className="py-3 text-xs text-muted">正在读取完整简报</p> : null}
                    {state.detail ? <WecomReportView detail={state.detail} /> : null}
                    {state.errors.detail ? <button type="button" className={wecomCommand} onClick={() => session.selectReport(report.id)}><RefreshCw aria-hidden className="h-4 w-4" />重试详情</button> : null}
                  </> : null}
                </div>
              </article>;
            })}
          </div>
          <ReadError message={state.errors.reportsMore} />
          {state.reports?.nextCursor ? <button type="button" className={`${wecomCommand} mt-3`} disabled={state.loading.reportsMore} onClick={() => session.loadMoreReports()}><ArrowDown aria-hidden className="h-4 w-4" />{state.loading.reportsMore ? "正在读取" : "更早简报"}</button> : null}
        </section>

        <section aria-label="CA 跨群提及" className="min-w-0 border-t border-workspace-line-strong py-5 xl:border-t-0">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">CA 跨群提及</h3>
            <div role="group" aria-label="CA 范围" className="inline-flex rounded-md border border-workspace-line-strong p-0.5">
              {([{ value: "active", label: "当前有效" }, { value: "history", label: "历史" }] as const).map(({ value, label }) => <button type="button" key={value} aria-pressed={state.caMode === value} onClick={() => session.setCaMode(value)} className={`min-h-8 min-w-16 rounded px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${state.caMode === value ? "bg-accent-soft text-foreground" : "text-muted hover:text-foreground"}`}>{label}</button>)}
            </div>
          </header>
          <ReadError message={state.errors.active} />
          {state.caMode === "history" ? <ReadError message={state.errors.history} /> : null}
          {state.loading[state.caMode === "active" ? "active" : "history"] && !caData ? <p role="status" className="py-3 text-xs text-muted">正在读取跨群提及</p> : <WecomCaAlerts data={caData} mode={state.caMode} now={state.now} />}
          {state.caMode === "history" ? <>
            <ReadError message={state.errors.historyMore} />
            {state.caHistory?.nextCursor ? <button type="button" className={`${wecomCommand} mt-3`} disabled={state.loading.historyMore} onClick={() => session.loadMoreCa()}><ArrowDown aria-hidden className="h-4 w-4" />{state.loading.historyMore ? "正在读取" : "更早跨群提及"}</button> : null}
          </> : null}
        </section>
      </div>
      {state.toasts.length ? <aside aria-label="新跨群提及" aria-live="polite" className="fixed bottom-20 right-3 z-40 max-h-[50vh] w-[calc(100%-1.5rem)] max-w-sm space-y-2 overflow-y-auto overscroll-contain lg:bottom-4">
        {state.toasts.map((item) => <div key={`${item.id}:${item.notificationVersion}`} className="flex min-w-0 items-start gap-2 rounded-lg border border-workspace-line-strong bg-workspace-surface p-3 shadow-sm">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">跨群提及 · {item.groupCount} 群</p><p className="mt-1 break-all font-mono text-xs leading-5">{item.network} · {item.address}</p></div>
          <button type="button" title="关闭提示" aria-label="关闭提示" className={wecomIconButton} onClick={() => session.dismissToast(item.id)}><X aria-hidden className="h-4 w-4" /></button>
        </div>)}
      </aside> : null}
    </div>
  );
}
