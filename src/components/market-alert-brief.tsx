"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronsUp,
  ClipboardList,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import type { MarketBriefSnapshot } from "@/lib/market-alert-brief-types";

type MarketAlertBriefProps = {
  briefs?: Partial<Record<"1h" | "24h", MarketBriefSnapshot>>;
  nowMs: number;
};

function SnapshotTime({ value }: { value: string | null }) {
  const timestamp = Date.parse(value ?? "");
  if (!value || !Number.isFinite(timestamp)) return <span>n/a</span>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(timestamp)}
    </time>
  );
}

function checkedAge(value: string | null, nowMs: number) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - timestamp) / 60_000));
  if (minutes === 0) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function changeText(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function AlertCounts({ counts }: { counts: MarketBriefSnapshot["totals"] | MarketBriefSnapshot["items"][number] }) {
  return (
    <>
      <span className="inline-flex items-center gap-0.5 text-success">
        <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" />暴涨 {counts.pump}
      </span>
      <span className="inline-flex items-center gap-0.5 text-danger">
        <ArrowDownRight aria-hidden className="h-3 w-3 shrink-0" />暴跌 {counts.crash}
      </span>
      <span className="inline-flex items-center gap-0.5 text-warning">
        <ChevronsUp aria-hidden className="h-3 w-3 shrink-0" />轧空 {counts.squeeze}
      </span>
    </>
  );
}

export function MarketAlertBrief({ briefs, nowMs }: MarketAlertBriefProps) {
  const [scope, setScope] = useState<"1h" | "24h">("1h");
  const brief = briefs?.[scope];
  const hasReport = Boolean(brief && (
    brief.status === "ready" || brief.status === "empty" || brief.generatedAt || brief.items.length
  ));
  const checkedAtMs = Date.parse(brief?.checkedAt ?? "");
  const effectiveStale = Boolean(brief && (
    brief.stale || (Number.isFinite(checkedAtMs)
      ? nowMs - checkedAtMs > 75 * 60_000
      : hasReport)
  ));
  const statusText = !brief
    ? "速览尚未生成"
    : brief.status === "error"
      ? hasReport ? "更新失败 · 保留缓存" : "速览生成失败"
      : brief.status === "pending"
        ? hasReport ? "更新待完成 · 保留缓存" : "速览待生成"
        : "缓存速览";
  const needsAttention = brief?.status === "error" || effectiveStale;
  const age = brief ? checkedAge(brief.checkedAt, nowMs) : null;

  return (
    <section
      aria-label="异动速览"
      data-market-alert-brief={true}
      className="min-w-0 w-full border-b border-line px-1.5 pb-3 pt-1"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ClipboardList aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">异动速览</h2>
          <span role="status" className={`text-[10px] ${needsAttention ? "text-warning" : "text-muted"}`}>
            {statusText}
          </span>
          {effectiveStale ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning">
              <ShieldAlert aria-hidden className="h-3 w-3 shrink-0" />
              数据可能已过期
            </span>
          ) : null}
        </div>
        <div role="group" aria-label="速览时段" className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
          {(["1h", "24h"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`h-8 w-12 rounded-[4px] border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${scope === value ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted hover:bg-workspace-surface hover:text-foreground"}`}
              aria-pressed={scope === value}
            >{value}</button>
          ))}
        </div>
      </header>

      {brief ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
          <span className="inline-flex flex-wrap items-center gap-1">
            <Clock3 aria-hidden className="h-3 w-3 shrink-0" />
            数据截至 <SnapshotTime value={brief.windowEnd} />
          </span>
          {brief.generatedAt ? <span>生成 <SnapshotTime value={brief.generatedAt} /></span> : null}
          <span title={age ? brief.checkedAt ?? undefined : undefined}>
            检查 {age ?? <SnapshotTime value={brief.checkedAt} />}
          </span>
          <span>北京时间</span>
        </div>
      ) : null}

      {brief && hasReport ? (
        <div className="mt-2 min-w-0">
          {brief.headline ? (
            <p title={brief.headline} className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
              {brief.headline}
            </p>
          ) : null}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>{brief.totals.symbols} 币种</span>
            <span>{brief.totals.total} 次预警</span>
            <AlertCounts counts={brief.totals} />
          </div>
          {brief.items.length ? (
            <ul aria-label={`${scope} 异动币种`} className="mt-2 min-w-0 divide-y divide-line/70 border-t border-line/70">
              {brief.items.slice(0, 5).map((item) => (
                <li
                  key={item.symbol}
                  data-market-brief-symbol={item.symbol}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.5fr)]"
                >
                  <strong className="order-1 min-w-0 break-all font-mono text-[13px] text-foreground">{item.symbol}</strong>
                  <div className="order-3 col-span-full flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] sm:order-2 sm:col-auto">
                    <AlertCounts counts={item} />
                    <span className="text-muted">共 {item.total}</span>
                  </div>
                  <div
                    data-market-brief-change={true}
                    title="最近一次预警的触发涨跌幅，非所选时段累计涨跌幅；触发周期以原预警为准。"
                    className="order-2 min-w-0 text-right text-[10px] sm:order-3"
                  >
                    <span className="text-muted">最近触发 </span>
                    <strong className={`font-mono text-xs ${item.latestChangePct === null || !Number.isFinite(item.latestChangePct) ? "text-muted" : item.latestChangePct < 0 ? "text-danger" : item.latestChangePct > 0 ? "text-success" : "text-foreground"}`}>
                      {changeText(item.latestChangePct)}
                    </strong>
                    <span className="mt-0.5 block text-[9px] text-muted"><SnapshotTime value={item.latestAt} /></span>
                  </div>
                  <p title={item.reason} className="order-4 col-span-full min-w-0 line-clamp-2 break-words text-xs leading-5 text-muted [overflow-wrap:anywhere] lg:col-auto">
                    {item.reason}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">{brief.status === "empty" ? "本时段暂无异动预警" : "暂无重点币种"}</p>
          )}
          {brief.risks.length ? (
            <ul aria-label="速览风险" className="mt-1.5 min-w-0 space-y-1 border-t border-line/70 pt-2">
              {brief.risks.slice(0, 2).map((risk, index) => (
                <li key={index} className="flex min-w-0 items-start gap-1.5 text-[11px] leading-5 text-warning">
                  <ShieldAlert aria-hidden className="mt-1 h-3 w-3 shrink-0" />
                  <span data-market-brief-risk={true} title={risk} className="min-w-0 line-clamp-2 break-words [overflow-wrap:anywhere]">{risk}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
