"use client";

import Image from "next/image";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronsUp,
  Maximize2,
  Radio,
  RefreshCw,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import { isMarketSnapshotStale } from "@/lib/market-snapshot-freshness";
import type { getMarketAlertsSnapshot } from "@/lib/market-alerts-store";
import { MarketAlertBrief } from "./market-alert-brief";
import { MarketOpportunityPanel } from "./market-opportunity-panel";

type MarketAlertsSnapshot = ReturnType<typeof getMarketAlertsSnapshot>;
type MarketAlertEvent = MarketAlertsSnapshot["events"][number];
type Filter = "all" | "volatility" | "short_squeeze";
type SelectedChart = {
  symbol: string;
  url: string;
  interval: string;
  updatedAt: string | null;
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "volatility", label: "暴涨暴跌" },
  { key: "short_squeeze", label: "轧空" },
];

// Wide rows align price and valuations with the header. Narrow rows keep
// those metrics on a second line so they remain visible without expansion.
const ALERT_ROW_COLUMNS = "grid-cols-[minmax(0,1fr)_5.5rem_4.75rem_1.5rem] @min-[40rem]:grid-cols-[minmax(0,1fr)_5.75rem_4.5rem_4.5rem_5.5rem_4.75rem_1.5rem]";

function formatTime(value: string | null | undefined, seconds = false) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
  }).format(date);
}

function signedPercent(value: unknown, digits = 2) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function compactMoney(value: unknown, locale = "zh-CN", fallback = "n/a") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(number).replace(/\.0(?=\D|$)/g, "");
}

function priceText(value: unknown, fallback = "n/a") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  if (number >= 1_000) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (number >= 1) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${number.toPrecision(5)}`;
}

function metricNumber(event: MarketAlertEvent, key: string) {
  const value = event.metrics[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tokenSymbol(symbol: string) {
  return symbol.replace(/USDT$/i, "") || symbol;
}

function klineIntervalLabel(interval: string | null | undefined) {
  const normalized = interval?.trim() || "15m";
  const minuteMatch = /^(\d+)m$/i.exec(normalized);
  return minuteMatch ? `${minuteMatch[1]} 分钟` : normalized;
}

function workerTone(tone: "success" | "warning" | "danger") {
  if (tone === "success") return "bg-success text-success";
  if (tone === "danger") return "bg-danger text-danger";
  return "bg-warning text-warning";
}

type AlertDirection = "up" | "down" | "squeeze";
type LevelFilter = 0 | 1 | 2 | 3;
type WindowFilter = "all" | "1h" | "3h" | "24h";
const TICKER_FRESH_MS = 30 * 60 * 1000;
const GROUP_WINDOW_MS = 60 * 60 * 1000;
const WATCHLIST_KEY = "market-alert-watchlist";

function alertDirection(event: MarketAlertEvent): AlertDirection {
  if (event.type === "short_squeeze") return "squeeze";
  return event.side === "SHORT" ? "down" : "up";
}

function directionMark(direction: AlertDirection) {
  if (direction === "down") return "▼";
  if (direction === "squeeze") return "⬆";
  return "▲";
}

function relativeAge(value: string | null | undefined, nowMs: number) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time) || !Number.isFinite(nowMs)) return "时间未知";
  const minutes = Math.max(0, Math.floor((nowMs - time) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function clock(value: string | null | undefined) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return "--:--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
}

type AlertGroup = {
  id: string;
  symbol: string;
  direction: AlertDirection;
  level: number;
  latest: MarketAlertEvent;
  events: MarketAlertEvent[];
};

function groupAlerts(events: MarketAlertEvent[]): AlertGroup[] {
  const ordered = [...events].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || right.id.localeCompare(left.id));
  const groups: AlertGroup[] = [];
  for (const event of ordered) {
    const at = Date.parse(event.occurredAt);
    const direction = alertDirection(event);
    const group = groups.find((item) => item.symbol === event.symbol && item.direction === direction && Number.isFinite(at) && item.events[0] && Date.parse(item.latest.occurredAt) - at <= GROUP_WINDOW_MS && Date.parse(item.latest.occurredAt) - at >= 0);
    if (!group) {
      groups.push({ id: event.id, symbol: event.symbol, direction, level: event.level, latest: event, events: [event] });
      continue;
    }
    group.events.push(event);
    if (event.level > group.level) group.level = event.level;
  }
  return groups.sort((left, right) =>
    right.level - left.level
    || Date.parse(right.latest.occurredAt) - Date.parse(left.latest.occurredAt)
    || (right.latest.volumeRatio ?? -1) - (left.latest.volumeRatio ?? -1)
    || left.symbol.localeCompare(right.symbol));
}

function Sparkline({ values }: { values: number[] }) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const points = finite.map((value, index) => {
    const x = (index / (finite.length - 1)) * 64;
    const y = 16 - ((value - min) / span) * 14 - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 64 16" className="h-4 w-16 shrink-0 text-accent">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

function SqueezeWatch({ snapshot }: { snapshot: MarketAlertsSnapshot }) {
  const active = snapshot.activeSignals.filter((signal) => signal.kind === "short_squeeze");
  const meta = snapshot.health.squeeze?.meta ?? {};
  const covered = typeof meta.oiCoverage === "number" ? meta.oiCoverage : "—";
  const scanned = typeof meta.scanned === "number" ? meta.scanned : "—";
  return (
    <section aria-label="轧空观察" className="rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">轧空观察</h2>
        <span className="text-[10px] text-muted">OI 覆盖 {covered}/{scanned}</span>
      </header>
      {active.length ? (
        <ul className="divide-y divide-line/80 px-4">
          {active.slice(0, 8).map((signal) => (
            <li key={signal.key} className="flex items-center justify-between py-2 text-xs">
              <span className="font-mono font-bold text-foreground">{tokenSymbol(signal.symbol)}</span>
              <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 font-semibold text-warning">L{signal.level}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-muted">当前无候选 · OI 覆盖 {covered}/{scanned}</p>
      )}
    </section>
  );
}

function Ranking({ snapshot }: { snapshot: MarketAlertsSnapshot }) {
  const ranking = snapshot.marketRanking.slice(0, 12);
  const maximum = Math.max(1, ...ranking.map((item) => Math.abs(item.pct24h)));

  return (
    <section className="overflow-hidden rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">24h 异动排行</h2>
            <p className="mt-0.5 truncate text-[10px] text-muted">按绝对涨跌幅排序</p>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-muted">
          {ranking.length} 币种
        </span>
      </header>

      {ranking.length ? (
        <div className="divide-y divide-line/80 px-3">
          {ranking.map((item) => {
            const rising = item.pct24h >= 0;
            const width = Math.max(7, (Math.abs(item.pct24h) / maximum) * 100);
            return (
              <div
                key={item.symbol}
                data-market-ranking-symbol={item.symbol}
                className="grid min-h-12 grid-cols-[minmax(4.75rem,0.7fr)_minmax(5.5rem,1.3fr)] items-center gap-x-2 gap-y-1 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-sm font-bold text-foreground">
                      {tokenSymbol(item.symbol)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] font-medium text-muted">
                      {priceText(item.price)}
                    </span>
                    {item.dualSignal ? (
                      <span className="rounded-sm bg-warning-soft px-1 py-0.5 text-[9px] font-bold text-warning">
                        双重
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(3rem,1fr)_auto] items-center gap-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-workspace-canvas">
                    <div
                      className={`h-full rounded-full ${rising ? "bg-success" : "bg-danger"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className={`min-w-17 text-right font-mono text-sm font-bold ${rising ? "text-success" : "text-danger"}`}>
                    {signedPercent(item.pct24h)}
                  </span>
                </div>

                <div className="col-span-2 flex items-center justify-end gap-2 text-[10px]">
                  {item.counts.pump ? (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-success" title="暴涨推送次数">
                      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />{item.counts.pump}
                    </span>
                  ) : null}
                  {item.counts.crash ? (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-danger" title="暴跌推送次数">
                      <ArrowDownRight aria-hidden className="h-3.5 w-3.5" />{item.counts.crash}
                    </span>
                  ) : null}
                  {item.counts.squeeze ? (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-warning" title="轧空推送次数">
                      <ChevronsUp aria-hidden className="h-3.5 w-3.5" />{item.counts.squeeze}
                    </span>
                  ) : null}
                  <span className="text-muted">共 {item.counts.total}</span>
                </div>

                <div className="col-span-full flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                  <span>流通市值 {compactMoney(item.marketCapUsd)}</span>
                  <span aria-hidden>·</span>
                  <span>FDV {compactMoney(item.fdvUsd)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-5 py-10 text-center text-sm text-muted">
          近 24 小时暂无已触发币种
        </div>
      )}
    </section>
  );
}

const EventCard = memo(function EventCard({
  event,
  peers,
  expanded,
  onToggle,
  onOpenChart,
  onOpenSheet,
  nowMs,
}: {
  event: MarketAlertEvent;
  peers: MarketAlertEvent[];
  expanded: boolean;
  onToggle: (eventId: string) => void;
  onOpenChart: (chart: SelectedChart) => void;
  onOpenSheet: (event: MarketAlertEvent, peers: MarketAlertEvent[]) => void;
  nowMs: number;
}) {
  const squeeze = event.type === "short_squeeze";
  const rising = squeeze || event.side === "LONG";
  const deliveryIssue =
    event.deliveryStatus === "uncertain"
      ? "推送待确认"
      : event.deliveryStatus === "failed"
        ? "推送失败"
        : null;
  const pct24h = metricNumber(event, "pct24h");
  const oiGrowth = metricNumber(event, "oiGrowth15m");
  const funding = metricNumber(event, "funding");
  const chartUrl = event.chartUrl;
  const chartInterval = event.chartInterval || "15m";
  const shortLabel = squeeze ? "15m OI" : "25m 价格";
  const shortValue = squeeze
    ? signedPercent(oiGrowth)
    : signedPercent(event.changePct);
  const kindLabel = squeeze ? "轧空" : rising ? "暴涨" : "暴跌";
  const detailId = `market-alert-detail-${event.id}`;
  const marketCap = compactMoney(event.marketCapUsd, "en-US", "—");
  const fdv = compactMoney(event.fdvUsd, "en-US", "—");
  const valuationTitle = event.valuationUpdatedAt
    ? `市值更新 ${formatTime(event.valuationUpdatedAt)}`
    : "暂无市值数据";
  const level = Math.max(event.level, ...peers.map((item) => item.level));
  const tickerUpdatedMs = Date.parse(event.tickerUpdatedAt ?? "");
  const tickerStale = Number.isFinite(tickerUpdatedMs) && nowMs - tickerUpdatedMs > TICKER_FRESH_MS;
  const direction = alertDirection(event);
  const sparkValues = [...peers].reverse().map((item) => item.changePct).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return (
    <article
      data-market-alert-row={event.symbol}
      data-market-alert-level={level}
      data-market-alert-ticker-stale={tickerStale ? "true" : undefined}
      className={`border-l-2 bg-workspace-surface [contain-intrinsic-size:52px] [content-visibility:auto] ${tickerStale ? "opacity-60" : ""} ${level >= 3 ? "bg-warning-soft/40 ring-1 ring-inset ring-warning/50" : ""} ${squeeze ? "border-l-warning" : rising ? "border-l-success" : "border-l-danger"}`}
    >
      <button
        type="button"
        data-market-alert-toggle={event.id}
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${expanded ? "收起" : "展开"} ${event.symbol} 预警详情，${kindLabel}，24 小时 ${signedPercent(pct24h)}，${shortLabel} ${shortValue}`}
        onClick={() => {
          if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches) {
            onOpenSheet(event, peers);
            return;
          }
          onToggle(event.id);
        }}
        className={`hidden min-h-[52px] w-full items-center gap-x-1.5 gap-y-1 px-2.5 py-1.5 text-left transition-colors hover:bg-workspace-surface-raised sm:grid ${ALERT_ROW_COLUMNS}`}
      >
        <span className="flex min-w-0 items-center gap-1.5" title={`${event.symbol} · ${kindLabel}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] ${squeeze ? "bg-warning-soft text-warning" : rising ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {squeeze ? <ChevronsUp aria-hidden className="h-3.5 w-3.5" /> : rising ? <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /> : <ArrowDownRight aria-hidden className="h-3.5 w-3.5" />}
          </span>
          <strong className="min-w-0 break-all font-mono text-xs leading-4 text-foreground">{tokenSymbol(event.symbol)}</strong>
          <span className="shrink-0 font-mono text-[10px] font-semibold text-muted">{directionMark(direction)} L{level}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted">×{peers.length}</span>
          <Sparkline values={sparkValues} />
        </span>

        <span data-market-alert-price title="触发时价格（美元）" className="hidden break-all text-right font-mono text-xs tabular-nums text-foreground @min-[40rem]:block">{priceText(event.price, "—")}</span>
        <span title={valuationTitle} className="hidden text-right font-mono text-xs tabular-nums text-foreground @min-[40rem]:block">{marketCap}</span>
        <span title={valuationTitle} className="hidden text-right font-mono text-xs tabular-nums text-foreground @min-[40rem]:block">{fdv}</span>

        <span className={`text-right font-mono text-xs font-semibold ${squeeze ? "text-warning" : rising ? "text-success" : "text-danger"}`}>
          {shortValue}
          <span className="mt-0.5 block whitespace-nowrap text-[10px] font-normal text-muted">{shortLabel}</span>
        </span>

        <span className="text-right text-[10px] text-muted">{formatTime(event.occurredAt)}<span className="mt-0.5 block sm:hidden">{clock(event.occurredAt)}</span></span>

        <span className="flex h-8 w-6 items-center justify-center text-muted">
          <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
        <span title={valuationTitle} className="col-span-full flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted @min-[40rem]:hidden">
          <span data-market-alert-price title="触发时价格（美元）">价格 <span className="font-mono tabular-nums text-foreground">{priceText(event.price, "—")}</span></span>
          <span>流通市值 <span className="font-mono tabular-nums text-foreground">{marketCap}</span></span>
          <span>FDV <span className="font-mono tabular-nums text-foreground">{fdv}</span></span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onOpenSheet(event, peers)}
        className="block w-full px-3 py-2 text-left sm:hidden"
      >
        <span className="block truncate font-mono text-sm font-semibold text-foreground">
          {tokenSymbol(event.symbol)} {directionMark(direction)} L{level} {signedPercent(event.changePct)} ×{peers.length} · {clock(event.occurredAt)}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">量比 {event.volumeRatio == null ? "—" : event.volumeRatio.toFixed(1)} · {event.trigger.split("·")[0]}</span>
      </button>

      {expanded ? (
        <div
          id={detailId}
          data-market-alert-detail={event.symbol}
          className="grid min-w-0 grid-cols-1 gap-3 border-t border-line bg-workspace-surface-raised p-2.5"
        >
          <div className="min-w-0">
            {chartUrl ? (
              <button
                type="button"
                aria-label={`放大 ${event.symbol} K线图`}
                onClick={() => onOpenChart({
                  symbol: event.symbol,
                  url: chartUrl,
                  interval: chartInterval,
                  updatedAt: event.chartUpdatedAt,
                })}
                className="group relative block w-full overflow-hidden rounded-md border border-line bg-[#10161d] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                <Image
                  unoptimized
                  src={chartUrl}
                  alt={`${event.symbol} 最新 ${klineIntervalLabel(chartInterval)} K 线图`}
                  width={1200}
                  height={630}
                  loading="eager"
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="aspect-[1200/630] h-auto w-full object-contain"
                />
                <span className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white opacity-80 transition-opacity group-hover:opacity-100">
                  <Maximize2 aria-hidden className="h-4 w-4" />
                </span>
                <span className="absolute bottom-2 left-2 rounded-sm bg-black/65 px-2 py-1 text-[10px] font-medium text-white/80">
                  {chartInterval} · 更新 {formatTime(event.chartUpdatedAt)}
                </span>
              </button>
            ) : (
              <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-line bg-workspace-canvas text-xs text-muted">
                暂无 K 线快照
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${squeeze ? "bg-warning-soft text-warning" : rising ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{event.stage}</span>
              <span className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">{event.source}</span>
              {deliveryIssue ? <span className="rounded-sm border border-danger/35 bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">{deliveryIssue}</span> : null}
            </div>
            <p className="mt-2 text-sm leading-5 text-foreground">{event.trigger}</p>

            <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-xs @min-[28rem]:grid-cols-4">
              <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">24h</dt><dd className={`mt-0.5 font-mono font-semibold ${pct24h === null ? "text-muted" : pct24h >= 0 ? "text-success" : "text-danger"}`}>{signedPercent(pct24h)}</dd></div>
              {squeeze ? (
                <>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">15m</dt><dd className={`mt-0.5 font-mono font-semibold ${event.changePct === null ? "text-muted" : event.changePct >= 0 ? "text-success" : "text-danger"}`}>{signedPercent(event.changePct)}</dd></div>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">OI 15m</dt><dd className="mt-0.5 font-mono font-semibold text-foreground">{signedPercent(oiGrowth)}</dd></div>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">资金费率</dt><dd className="mt-0.5 font-mono font-semibold text-foreground">{funding === null ? "n/a" : signedPercent(funding * 100, 3)}</dd></div>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">评分</dt><dd className="mt-0.5 font-mono font-semibold text-warning">{event.score ?? 0}</dd></div>
                </>
              ) : (
                <>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">{shortLabel}</dt><dd className="mt-0.5 font-mono font-semibold text-foreground">{shortValue}</dd></div>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">量比</dt><dd className="mt-0.5 font-mono font-semibold text-foreground">{event.volumeRatio?.toFixed(2) ?? "n/a"}x</dd></div>
                  <div className="bg-workspace-surface px-2.5 py-2"><dt className="text-[10px] text-muted">等级</dt><dd className="mt-0.5 font-mono font-semibold text-foreground">L{event.level}</dd></div>
                </>
              )}
            </dl>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-muted">
              <span data-market-alert-price>价格 <strong className="font-mono font-semibold text-foreground">{priceText(event.price)}</strong></span>
              <span>触发 {formatTime(event.occurredAt)}</span>
              <span title={valuationTitle}>流通市值 <strong className="font-mono font-semibold text-foreground">{marketCap}</strong></span>
              <span title={valuationTitle}>FDV <strong className="font-mono font-semibold text-foreground">{fdv}</strong></span>
            </div>

            {event.reasons.length ? <p className="mt-3 text-xs leading-5 text-muted">{event.reasons.join(" · ")}</p> : null}
            <ol aria-label="触发时间线" className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] text-muted">
              {peers.map((item) => (
                <li key={item.id} className="flex flex-wrap gap-x-2">
                  <span>{formatTime(item.occurredAt)}</span>
                  <span>L{item.level}</span>
                  <span>{signedPercent(item.changePct)}</span>
                  <span>{item.trigger}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </article>
  );
});

function ActiveSignals({ snapshot }: { snapshot: MarketAlertsSnapshot }) {
  return (
    <section className="rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap aria-hidden className="h-4 w-4 text-warning" />
          <h2 className="text-sm font-semibold text-foreground">活跃信号</h2>
        </div>
        <span className="text-xs text-muted">{snapshot.activeSignals.length}</span>
      </header>
      <div className="divide-y divide-line/80 px-4">
        {snapshot.activeSignals.length ? snapshot.activeSignals.slice(0, 12).map((signal) => (
          <div key={signal.key} className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <div className="min-w-0">
              <div className="truncate font-mono font-bold text-foreground">{signal.symbol}</div>
              <div className="mt-0.5 truncate text-muted">{signal.kind === "short_squeeze" ? "轧空" : signal.side === "SHORT" ? "暴跌" : "暴涨"}</div>
            </div>
            <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono font-semibold text-muted">L{signal.level}</span>
          </div>
        )) : <div className="py-8 text-center text-xs text-muted">暂无活跃信号</div>}
      </div>
    </section>
  );
}

function WorkerHealth({
  snapshot,
  nowMs,
}: {
  snapshot: MarketAlertsSnapshot;
  nowMs: number;
}) {
  const workers = [
    ["WS 快速层", snapshot.health.volatilityWs],
    ["REST 确认层", snapshot.health.volatilityRest],
    ["轧空扫描", snapshot.health.squeeze],
    ["做单决策", snapshot.health.opportunity],
  ] as const;
  return (
    <section className="rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Radio aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">Worker 状态</h2>
      </header>
      <div className="divide-y divide-line/80 px-4">
        {workers.map(([label, heartbeat]) => {
          const view = getMarketAlertWorkerView(heartbeat, nowMs);
          const tone = workerTone(view.tone);
          return (
            <div key={label} className="py-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-foreground">{label}</span>
                <span className={`inline-flex items-center gap-1.5 ${tone.split(" ")[1]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.split(" ")[0]}`} />
                  {view.label}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 leading-5 text-muted">{view.detail}</p>
              {view.lastError && heartbeat?.status !== "error" ? (
                <p className={`mt-1 line-clamp-2 text-[10px] leading-4 ${view.lastErrorRecovered ? "text-warning" : "text-danger"}`}>
                  {view.lastErrorRecovered ? "已恢复的错误" : "最近错误"}
                  {view.lastErrorAt ? `（${formatTime(view.lastErrorAt, true)}）` : ""}
                  ：{view.lastError}
                </p>
              ) : null}
              {heartbeat?.updatedAt ? <div className="mt-1 text-[10px] text-muted">心跳 {formatTime(heartbeat.updatedAt, true)}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MarketAlertsPanel({
  initialSnapshot,
}: {
  initialSnapshot: MarketAlertsSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filter, setFilter] = useState<Filter>("all");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "retrying">("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedChart, setSelectedChart] = useState<SelectedChart | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [pushSymbol, setPushSymbol] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>(0);
  const [directionFilter, setDirectionFilter] = useState<AlertDirection | "all">("all");
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");
  const [watchOnly, setWatchOnly] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ event: MarketAlertEvent; peers: MarketAlertEvent[] } | null>(null);
  useEffect(() => {
    const symbol = new URLSearchParams(window.location?.search ?? "").get("symbol");
    if (symbol && /^[A-Z0-9]{2,40}$/.test(symbol)) queueMicrotask(() => setPushSymbol(symbol));
  }, []);
  useEffect(() => {
    if (pushSymbol && typeof document !== "undefined") document.getElementById(`market-push-${pushSymbol}`)?.scrollIntoView({ block: "start" });
  }, [pushSymbol]);
  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((current) => current === eventId ? null : eventId);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem(WATCHLIST_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || !parsed.length) return;
      setWatchlist(parsed.filter((item) => typeof item === "string"));
    } catch { /* ignore a damaged watchlist */ }
  }, []);

  useEffect(() => {
    if (!selectedChart) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedChart(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedChart]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (levelFilter) params.set("level", String(levelFilter));
      if (watchOnly && watchlist.length === 1) params.set("symbol", watchlist[0]);
      if (windowFilter !== "all") {
        const hours = windowFilter === "1h" ? 1 : windowFilter === "3h" ? 3 : 24;
        params.set("from", new Date(Date.now() - hours * 60 * 60_000).toISOString());
        params.set("to", new Date().toISOString());
      }
      const response = await fetch(`/api/market-alerts?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot((await response.json()) as MarketAlertsSnapshot);
      setStreamStatus("live");
    } catch {
      setStreamStatus("retrying");
    } finally {
      setRefreshing(false);
    }
  }, [levelFilter, watchOnly, watchlist, windowFilter]);

  useEffect(() => {
    let pollTimer = 0;
    let closed = false;
    const stream = new EventSource("/api/market-alerts/stream");
    const stopPoll = () => {
      if (!pollTimer) return;
      window.clearInterval(pollTimer);
      pollTimer = 0;
    };
    const handleSnapshot = (message: MessageEvent<string>) => {
      try {
        setSnapshot(JSON.parse(message.data) as MarketAlertsSnapshot);
        setStreamStatus("live");
        stopPoll();
      } catch {
        setStreamStatus("retrying");
      }
    };
    stream.addEventListener("market-alerts-snapshot", handleSnapshot as EventListener);
    stream.addEventListener("heartbeat", () => setStreamStatus("live"));
    stream.onerror = () => {
      setStreamStatus("retrying");
      if (pollTimer || closed) return;
      pollTimer = window.setInterval(() => { void refresh(); }, 120_000);
    };
    return () => {
      closed = true;
      stopPoll();
      stream.close();
    };
  }, [refresh]);

  const filteredEvents = useMemo(
    () => snapshot.events.filter((event) => {
      if (filter !== "all" && event.type !== filter) return false;
      if (levelFilter && event.level !== levelFilter) return false;
      if (directionFilter !== "all" && alertDirection(event) !== directionFilter) return false;
      if (watchOnly && !watchlist.includes(event.symbol)) return false;
      if (windowFilter !== "all") {
        const at = Date.parse(event.occurredAt);
        const hours = windowFilter === "1h" ? 1 : windowFilter === "3h" ? 3 : 24;
        if (!Number.isFinite(at) || nowMs - at > hours * 60 * 60_000) return false;
      }
      return true;
    }),
    [directionFilter, filter, levelFilter, nowMs, snapshot.events, watchOnly, watchlist, windowFilter],
  );
  const groups = useMemo(() => groupAlerts(filteredEvents), [filteredEvents]);
  const directionCounts = useMemo(() => ({
    up: snapshot.events.filter((event) => alertDirection(event) === "up").length,
    down: snapshot.events.filter((event) => alertDirection(event) === "down").length,
    squeeze: snapshot.events.filter((event) => alertDirection(event) === "squeeze").length,
  }), [snapshot.events]);
  const workerLights = [
    ["WS", snapshot.health.volatilityWs],
    ["REST", snapshot.health.volatilityRest],
    ["轧空", snapshot.health.squeeze],
    ["决策", snapshot.health.opportunity],
  ] as const;
  const counts = useMemo(
    () => ({
      all: snapshot.events.length,
      volatility: snapshot.events.filter((event) => event.type === "volatility").length,
      short_squeeze: snapshot.events.filter((event) => event.type === "short_squeeze").length,
    }),
    [snapshot.events],
  );
  const liveWorkers = [
    snapshot.health.volatilityWs,
    snapshot.health.volatilityRest,
    snapshot.health.squeeze,
    snapshot.health.opportunity,
  ].filter((heartbeat) => getMarketAlertWorkerView(heartbeat, nowMs).tone === "success").length;

  return (
    <div className="space-y-3">
      {pushSymbol ? <div id={`market-push-${pushSymbol}`} className="rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm text-foreground">通知关联币种：<strong className="font-mono">{pushSymbol}</strong>。当前列表可能已更新，币种不在列表中时仍保留这条通知引用。</div> : null}
      <div className="flex flex-col gap-3 rounded-lg border border-workspace-line-strong bg-workspace-toolbar px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div data-market-alert-status className="flex items-center gap-2 overflow-x-auto whitespace-nowrap max-sm:flex-nowrap sm:flex-wrap">
            <ShieldAlert aria-hidden className="h-5 w-5 shrink-0 text-warning" />
            <h1 className="text-lg font-semibold text-foreground">合约异动</h1>
            {workerLights.map(([label, heartbeat]) => {
              const view = getMarketAlertWorkerView(heartbeat, nowMs);
              const tone = workerTone(view.tone);
              return (
                <span key={label} title={`${label} ${view.label}`} className={`inline-flex items-center gap-1 text-[11px] font-medium ${tone.split(" ")[1]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.split(" ")[0]}`} />
                  {label}
                </span>
              );
            })}
            <span className={`text-[11px] font-medium ${liveWorkers === 4 ? "text-success" : "text-warning"}`}>{liveWorkers}/4 在线</span>
            <span className="text-[11px] text-muted">上涨 {directionCounts.up}</span>
            <span className="text-[11px] text-muted">下跌 {directionCounts.down}</span>
            <span className="text-[11px] text-muted">轧空 {directionCounts.squeeze}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            数据时间 {formatTime(snapshot.latestUpdatedAt || snapshot.generatedAt, true)}
            <span> · 最新 {relativeAge(snapshot.latestUpdatedAt || snapshot.generatedAt, nowMs)}</span>
            {isMarketSnapshotStale(snapshot.latestUpdatedAt || snapshot.generatedAt, nowMs) ? (
              <span className="text-warning"> · 数据可能已过期</span>
            ) : null}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-md border border-line bg-workspace-canvas p-1 sm:flex-none">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`min-w-0 rounded-[5px] border px-2.5 py-1.5 text-xs font-semibold transition-colors ${filter === item.key ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted hover:bg-workspace-surface hover:text-foreground"}`}
              >
                <span className="truncate">{item.label} {counts[item.key]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            title="刷新异动数据"
            aria-label="刷新异动数据"
            disabled={refreshing}
            onClick={() => void refresh()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-workspace-surface text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <MarketAlertBrief briefs={snapshot.briefs} nowMs={nowMs} />

      <div
        data-market-alert-workspace={true}
        className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(19rem,2fr)] lg:grid-rows-[auto_1fr] lg:items-start"
      >
        <div
          data-market-alert-right-rail={true}
          className="order-1 min-w-0 space-y-3 lg:order-2 lg:col-start-2 lg:row-start-1"
        >
          <div data-market-alert-filters className="sticky top-0 z-20 flex gap-1 overflow-x-auto rounded-lg border border-line bg-workspace-surface p-1.5 shadow-sm lg:static lg:flex-wrap">
            {([0, 1, 2, 3] as const).map((level) => (
              <button key={level} type="button" aria-pressed={levelFilter === level} onClick={() => setLevelFilter(level)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelFilter === level ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted"}`}>{level === 0 ? "全部等级" : `L${level}`}</button>
            ))}
            {(["all", "up", "down", "squeeze"] as const).map((direction) => (
              <button key={direction} type="button" aria-pressed={directionFilter === direction} onClick={() => setDirectionFilter(direction)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${directionFilter === direction ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted"}`}>{direction === "all" ? "全部方向" : direction === "up" ? "上涨" : direction === "down" ? "下跌" : "轧空方向"}</button>
            ))}
            {(["all", "1h", "3h", "24h"] as const).map((windowKey) => (
              <button key={windowKey} type="button" aria-pressed={windowFilter === windowKey} onClick={() => setWindowFilter(windowKey)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${windowFilter === windowKey ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted"}`}>{windowKey === "all" ? "全部时间" : windowKey === "1h" ? "1小时" : windowKey === "3h" ? "3小时" : "24小时"}</button>
            ))}
            <button type="button" aria-pressed={watchOnly} onClick={() => setWatchOnly((current) => !current)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${watchOnly ? "border-accent/40 bg-accent-soft text-foreground" : "border-transparent text-muted"}`}>自选 {watchlist.length}</button>
          </div>
          <SqueezeWatch snapshot={snapshot} />
          <MarketOpportunityPanel
            opportunities={snapshot.opportunities}
            meta={snapshot.opportunityMeta}
            heartbeat={snapshot.health.opportunity}
            nowMs={nowMs}
          />
        </div>

        <section
          data-market-alert-feed={true}
          className="@container order-2 min-w-0 lg:order-1 lg:col-start-1 lg:row-span-2 lg:row-start-1"
        >
          <header className="mb-2 flex items-center justify-between px-1.5">
            <h2 className="text-sm font-semibold text-foreground">实时预警</h2>
            <span className="text-xs text-muted">{groups.length} 组</span>
          </header>
          <div className="overflow-hidden rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
            <div className={`grid min-h-8 items-center gap-x-1.5 border-b border-l-2 border-l-transparent border-line bg-workspace-surface-raised px-2.5 text-[10px] font-medium text-muted ${ALERT_ROW_COLUMNS}`}>
              <span>币种</span>
              <span title="预警触发时价格（美元）" className="hidden text-right @min-[40rem]:block">价格</span>
              <span className="hidden text-right @min-[40rem]:block">流通市值</span>
              <span className="hidden text-right @min-[40rem]:block">FDV</span>
              <span className="text-right">触发变化</span>
              <span className="text-right">时间</span>
              <span />
            </div>
            {groups.length ? (
              <div className="divide-y divide-line/80">
                {groups.map((group) => (
                  <EventCard
                    key={group.id}
                    event={group.latest}
                    peers={group.events}
                    expanded={group.id === expandedEventId}
                    onToggle={toggleEvent}
                    onOpenChart={setSelectedChart}
                    onOpenSheet={(event, peers) => setSheet({ event, peers })}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-workspace-line-strong bg-workspace-surface px-4 py-12 text-center text-sm text-muted">
                当前筛选暂无预警
              </div>
            )}
          </div>
        </section>
        <aside
          data-market-alert-sidebar={true}
          role="region"
          aria-label="24 小时异动排行、活跃信号和服务状态"
          tabIndex={0}
          className="order-3 grid gap-3 lg:col-start-2 lg:row-start-2 lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
        >
          <Ranking snapshot={snapshot} />
          {/* Active signals repeat the tracking list and worker health is
              operational detail, so both start collapsed behind one summary. */}
          <details data-market-alert-more={true} className="group min-w-0 rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
              <span>活跃信号 · 服务状态</span>
              <span className="inline-flex items-center gap-2 text-[11px] font-medium">
                <span className={liveWorkers === 4 ? "text-success" : "text-warning"}>{liveWorkers}/4 在线</span>
                <ChevronDown aria-hidden className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="grid gap-3 border-t border-line p-3">
              <ActiveSignals snapshot={snapshot} />
              <WorkerHealth snapshot={snapshot} nowMs={nowMs} />
            </div>
          </details>
        </aside>
      </div>

      {sheet ? (
        <div role="dialog" aria-modal="true" aria-label={`${sheet.event.symbol} 详情`} className="fixed inset-0 z-[80] flex items-end sm:hidden">
          <button type="button" aria-label="关闭详情背景" className="absolute inset-0 bg-black/70" onClick={() => setSheet(null)} />
          <div className="relative z-10 max-h-[85vh] w-full overflow-auto rounded-t-2xl border border-line bg-workspace-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-mono text-sm font-bold">{tokenSymbol(sheet.event.symbol)} {directionMark(alertDirection(sheet.event))} L{sheet.event.level}</h2>
              <button type="button" aria-label="关闭详情" onClick={() => setSheet(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line"><X aria-hidden className="h-4 w-4" /></button>
            </div>
            {sheet.event.chartUrl ? (
              <Image unoptimized src={sheet.event.chartUrl} alt={`${sheet.event.symbol} 最新 ${klineIntervalLabel(sheet.event.chartInterval)} K 线图`} width={1200} height={630} className="h-auto w-full" />
            ) : <p className="py-6 text-center text-xs text-muted">暂无 K 线快照</p>}
            <ol aria-label="触发时间线" className="mt-3 space-y-1 text-xs text-muted">
              {sheet.peers.map((item) => <li key={item.id}>{clock(item.occurredAt)} · L{item.level} · {signedPercent(item.changePct)} · {item.trigger}</li>)}
            </ol>
          </div>
        </div>
      ) : null}

      {selectedChart ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedChart.symbol} K线图`}
          className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
        >
          <button
            type="button"
            aria-label="关闭 K线图背景"
            onClick={() => setSelectedChart(null)}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-white/15 bg-[#10161d] shadow-2xl">
            <header className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-4">
              <div className="min-w-0">
                <h2 className="truncate font-mono text-sm font-bold text-white">
                  {selectedChart.symbol} · {selectedChart.interval}
                </h2>
                <p className="mt-0.5 text-[10px] text-white/55">
                  更新 {formatTime(selectedChart.updatedAt, true)}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭 K线图"
                onClick={() => setSelectedChart(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 overflow-auto p-2 sm:p-4">
              <Image
                unoptimized
                src={selectedChart.url}
                alt={`${selectedChart.symbol} K线图大图`}
                width={1200}
                height={630}
                sizes="(min-width: 1280px) 72rem, 100vw"
                className="mx-auto h-auto max-h-[78vh] w-full object-contain"
                priority
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
