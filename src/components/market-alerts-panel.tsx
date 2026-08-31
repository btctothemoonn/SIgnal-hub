"use client";

import Image from "next/image";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronsUp,
  Maximize2,
  Radio,
  RefreshCw,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import type { getMarketAlertsSnapshot } from "@/lib/market-alerts-store";

type MarketAlertsSnapshot = ReturnType<typeof getMarketAlertsSnapshot>;
type MarketAlertEvent = MarketAlertsSnapshot["events"][number];
type Filter = "all" | "volatility" | "short_squeeze";
type SelectedChart = {
  symbol: string;
  url: string;
  updatedAt: string | null;
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "volatility", label: "暴涨暴跌" },
  { key: "short_squeeze", label: "轧空" },
];

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
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function compactMoney(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

function priceText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "n/a";
  if (number >= 1_000) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (number >= 1) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${number.toPrecision(5)}`;
}

function metricNumber(event: MarketAlertEvent, key: string) {
  const number = Number(event.metrics[key]);
  return Number.isFinite(number) ? number : null;
}

function tokenSymbol(symbol: string) {
  return symbol.replace(/USDT$/i, "") || symbol;
}

function workerTone(tone: "success" | "warning" | "danger") {
  if (tone === "success") return "bg-success text-success";
  if (tone === "danger") return "bg-danger text-danger";
  return "bg-warning text-warning";
}

function Ranking({ snapshot }: { snapshot: MarketAlertsSnapshot }) {
  const ranking = snapshot.marketRanking.slice(0, 12);
  const maximum = Math.max(1, ...ranking.map((item) => Math.abs(item.pct24h)));

  return (
    <section className="overflow-hidden rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft text-accent">
            <Activity aria-hidden className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">24h 异动排行</h2>
            <p className="mt-0.5 text-xs text-muted">近 24h 已触发 · 按绝对涨跌幅排序</p>
          </div>
        </div>
        <span className="rounded-md border border-line bg-workspace-surface-raised px-2 py-1 text-xs font-medium text-muted">
          {ranking.length} 币种
        </span>
      </header>

      {ranking.length ? (
        <div className="divide-y divide-line/80 px-4 sm:px-5">
          {ranking.map((item) => {
            const rising = item.pct24h >= 0;
            const width = Math.max(7, (Math.abs(item.pct24h) / maximum) * 100);
            return (
              <div
                key={item.symbol}
                data-market-ranking-symbol={item.symbol}
                className="grid min-h-12 grid-cols-[minmax(5.5rem,0.65fr)_minmax(8.75rem,1.35fr)] items-center gap-2 py-2 sm:grid-cols-[minmax(9rem,0.6fr)_minmax(10rem,1.3fr)_minmax(10rem,1fr)] sm:gap-3"
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
                  <div className="mt-0.5 text-[10px] text-muted">{compactMoney(item.quoteVolume)}</div>
                </div>

                <div className="grid grid-cols-[minmax(3rem,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(4rem,1fr)_auto] sm:gap-3">
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

                <div className="col-span-2 flex items-center justify-end gap-2 text-[11px] sm:col-span-1">
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

function EventCard({
  event,
  eager,
  onOpenChart,
}: {
  event: MarketAlertEvent;
  eager: boolean;
  onOpenChart: (chart: SelectedChart) => void;
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

  return (
    <article className={`rounded-lg border bg-workspace-surface px-3 py-3 shadow-sm sm:px-4 ${squeeze ? "border-warning/35" : rising ? "border-success/25" : "border-danger/30"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${squeeze ? "bg-warning-soft text-warning" : rising ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {squeeze ? <ChevronsUp aria-hidden className="h-4 w-4" /> : rising ? <ArrowUpRight aria-hidden className="h-4 w-4" /> : <ArrowDownRight aria-hidden className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-mono text-sm font-bold text-foreground">{event.symbol}</h3>
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${squeeze ? "bg-warning-soft text-warning" : rising ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
                {event.stage}
              </span>
              <span className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
                {event.source}
              </span>
              {deliveryIssue ? (
                <span className="rounded-sm border border-danger/35 bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                  {deliveryIssue}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-5 text-foreground">{event.trigger}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-semibold text-foreground">{priceText(event.price)}</div>
          <div className="mt-0.5 text-[10px] text-muted">{formatTime(event.occurredAt)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/70 pt-2 text-xs text-muted">
        {pct24h !== null ? <span>24h <strong className={pct24h >= 0 ? "text-success" : "text-danger"}>{signedPercent(pct24h)}</strong></span> : null}
        {squeeze ? (
          <>
            <span>15m <strong className="text-foreground">{signedPercent(event.changePct)}</strong></span>
            <span>OI <strong className="text-foreground">{signedPercent(oiGrowth)}</strong></span>
            <span>费率 <strong className="text-foreground">{funding === null ? "n/a" : signedPercent(funding * 100, 3)}</strong></span>
            <span>评分 <strong className="text-warning">{event.score ?? 0}</strong></span>
          </>
        ) : (
          <>
            <span>近25m <strong className={rising ? "text-success" : "text-danger"}>{signedPercent(event.changePct)}</strong></span>
            <span>量比 <strong className="text-foreground">{event.volumeRatio?.toFixed(2) ?? "n/a"}x</strong></span>
            <span>等级 <strong className="text-foreground">L{event.level}</strong></span>
          </>
        )}
      </div>
      {event.reasons.length ? (
        <p className="mt-2 text-xs leading-5 text-muted">{event.reasons.join(" · ")}</p>
      ) : null}
      {chartUrl ? (
        <button
          type="button"
          aria-label={`放大 ${event.symbol} K线图`}
          onClick={() => onOpenChart({
            symbol: event.symbol,
            url: chartUrl,
            updatedAt: event.chartUpdatedAt,
          })}
          className="group relative mt-3 block w-full overflow-hidden rounded-md border border-line bg-[#10161d] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <Image
            unoptimized
            src={chartUrl}
            alt={`${event.symbol} 最新 5 分钟 K 线图`}
            width={1200}
            height={630}
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1280px) 58vw, 100vw"
            className="aspect-[1200/630] max-h-64 w-full object-contain"
          />
          <span className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white opacity-80 transition-opacity group-hover:opacity-100">
            <Maximize2 aria-hidden className="h-4 w-4" />
          </span>
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/65 px-2 py-1 text-[10px] font-medium text-white/80">
            5m · 更新 {formatTime(event.chartUpdatedAt)}
          </span>
        </button>
      ) : null}
    </article>
  );
}

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
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-danger">
                  最近错误：{view.lastError}
                </p>
              ) : null}
              {heartbeat?.updatedAt ? <div className="mt-1 text-[10px] text-muted">{formatTime(heartbeat.updatedAt, true)}</div> : null}
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

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedChart) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedChart(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedChart]);

  useEffect(() => {
    const stream = new EventSource("/api/market-alerts/stream");
    const handleSnapshot = (message: MessageEvent<string>) => {
      try {
        setSnapshot(JSON.parse(message.data) as MarketAlertsSnapshot);
        setStreamStatus("live");
      } catch {
        setStreamStatus("retrying");
      }
    };
    stream.addEventListener("market-alerts-snapshot", handleSnapshot as EventListener);
    stream.addEventListener("heartbeat", () => setStreamStatus("live"));
    stream.onerror = () => setStreamStatus("retrying");
    return () => stream.close();
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/market-alerts?limit=100", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot((await response.json()) as MarketAlertsSnapshot);
      setStreamStatus("live");
    } catch {
      setStreamStatus("retrying");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const filteredEvents = useMemo(
    () => snapshot.events.filter((event) => filter === "all" || event.type === filter),
    [filter, snapshot.events],
  );
  const eagerChartEventId = filteredEvents.find((event) => event.chartUrl)?.id ?? null;
  const counts = useMemo(
    () => ({
      all: snapshot.events.length,
      volatility: snapshot.events.filter((event) => event.type === "volatility").length,
      short_squeeze: snapshot.events.filter((event) => event.type === "short_squeeze").length,
    }),
    [snapshot.events],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-workspace-line-strong bg-workspace-toolbar p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden className="h-5 w-5 text-warning" />
            <h1 className="text-lg font-semibold text-foreground">合约异动</h1>
            <span className={`h-1.5 w-1.5 rounded-full ${streamStatus === "live" ? "bg-success" : "bg-warning"}`} />
          </div>
          <p className="mt-1 text-xs text-muted">更新 {formatTime(snapshot.latestUpdatedAt || snapshot.generatedAt, true)}</p>
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

      <Ranking snapshot={snapshot} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.68fr)] xl:items-start">
        <section className="min-w-0">
          <header className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-foreground">实时预警</h2>
            <span className="text-xs text-muted">{filteredEvents.length} 条</span>
          </header>
          <div className="space-y-2">
            {filteredEvents.length ? filteredEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                eager={event.id === eagerChartEventId}
                onOpenChart={setSelectedChart}
              />
            )) : (
              <div className="rounded-lg border border-dashed border-workspace-line-strong bg-workspace-surface px-4 py-12 text-center text-sm text-muted">
                当前筛选暂无预警
              </div>
            )}
          </div>
        </section>
        <aside className="grid gap-4 xl:sticky xl:top-[5.75rem]">
          <ActiveSignals snapshot={snapshot} />
          <WorkerHealth snapshot={snapshot} nowMs={nowMs} />
        </aside>
      </div>

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
                  {selectedChart.symbol} · 5m
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
