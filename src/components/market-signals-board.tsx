"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronDown, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import type { MarketSignalsBoardData } from "@/lib/market-signals-view";
import { MarketSignalCardChart, cardTime } from "./market-signal-card-chart";
import {
  buildCardRows, currentStageEvent, directionOf, EPISODE_MS, eventTime, triggerLabel, type AssetFilter, type BoardEvent, type CardRow,
  type DirectionFilter,
} from "./market-signal-card-model";

type BoardSignal = MarketSignalsBoardData["signals"]["signals"][number];
type Ticker = MarketSignalsBoardData["tickers"][number];
type OutcomeGroup = MarketSignalsBoardData["signals"]["alertOutcomeStats"]["groups"][number];
type RecentOutcomes = MarketSignalsBoardData["signals"]["recentAlertOutcomes"];
type WindowKey = "1h" | "4h" | "24h";

const WATCHLIST_KEY = "market-alert-watchlist";
const WINDOW_MS: Record<WindowKey, number> = { "1h": 3_600_000, "4h": 4 * 3_600_000, "24h": 24 * 3_600_000 };
const HOLD_MS = 24 * 3_600_000;
const WATCH_SHOW_MS = 12 * 3_600_000;
const SIGNALS_STALE_MS = 15 * 60_000;
const REFRESH_MIN_GAP_MS = 15_000;
const CARDS_PER_PAGE = 8;

function base(symbol: string) {
  return symbol.replace(/USDT$/, "");
}

function MarketSymbolLink({ symbol, className }: { symbol: string; className: string }) {
  return (
    <Link
      href={`/news?symbol=${encodeURIComponent(symbol)}`}
      prefetch={false}
      aria-label={`查看 ${base(symbol)} 实时行情`}
      className={`${className} hover:text-accent hover:underline`}
    >
      {base(symbol)}
    </Link>
  );
}

function clock(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(date);
}

function age(value: string | null | undefined, nowMs: number) {
  const ms = nowMs - Date.parse(value ?? "");
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

function pct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function rate(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function price(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return Number(value.toPrecision(4)).toString();
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
    .format(value)
    .replace(/\.0(?=\D|$)/g, "");
}

function tone(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "text-muted";
  return value > 0 ? "text-success" : "text-danger";
}

function num(detail: BoardSignal["detail"], key: string) {
  const value = Number(detail[key]);
  return Number.isFinite(value) ? value : null;
}

const ASSET_LABEL: Record<string, string> = {
  EQUITY: "美股",
  HK_EQUITY: "港股",
  KR_EQUITY: "韩股",
  CN_EQUITY: "A股",
  COMMODITY: "商品",
  INDEX: "指数",
  FX: "外汇",
  PREMARKET: "盘前",
};

function AssetBadge({ type }: { type: string | undefined }) {
  if (!type) return null;
  const label = ASSET_LABEL[type] ?? type;
  const className = type === "EQUITY" ? "border-sky-500/50 bg-sky-500/15 text-sky-500" : "border-line bg-workspace-canvas text-muted";
  return <span title={`Binance 标的类型：${type}`} className={`shrink-0 rounded border px-1 text-[10px] font-semibold leading-4 ${className}`}>{label}</span>;
}

function Section({ title, hint, children, aside }: { title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside ?? (hint ? <span className="text-[11px] text-muted">{hint}</span> : null)}
      </header>
      {children}
    </section>
  );
}

function StatsLine({ live, backtest }: { live: string; backtest: string }) {
  return (
    <p className="border-t border-line px-3 py-1.5 text-[11px] leading-5 text-muted">
      <span className="text-foreground/80">实盘近 30 天：</span>{live}
      <span className="mx-1.5">·</span>
      <span>回测：{backtest}</span>
    </p>
  );
}

const OUTCOME_CATEGORY_LABEL: Record<OutcomeGroup["category"], string> = { pump: "暴涨", crash: "暴跌", squeeze: "轧空" };
const OUTCOME_HORIZONS = ["1h", "4h", "24h"] as const;
const OUTCOME_MIN_SAMPLE = 10;

function winTone(stat: OutcomeGroup["horizons"]["1h"]) {
  if (stat.winRate === null || stat.n < OUTCOME_MIN_SAMPLE) return "text-muted";
  if (stat.winRate >= 0.55) return "text-success";
  if (stat.winRate <= 0.45) return "text-danger";
  return "text-foreground";
}

function AlertOutcomeTable({ groups, windowDays }: { groups: OutcomeGroup[]; windowDays: number }) {
  return (
    <Section title={`预警后续表现 · 近 ${windowDays} 天`} hint="胜率 = 价格继续朝预警方向走（暴跌看跌）· 中位为同方向收益">
      {groups.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="bg-workspace-surface-raised text-[10px] font-medium text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">触发条件</th>
                <th className="px-2 py-1.5 text-right font-medium">次数</th>
                {OUTCOME_HORIZONS.map((key) => <th key={key} className="px-2 py-1.5 text-right font-medium">{key} 胜率 · 中位</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const summary = group.group === "全部";
                return (
                  <tr key={`${group.category}:${group.group}`} className={summary ? "border-t border-workspace-line-strong bg-workspace-canvas/60" : "border-t border-line/60"}>
                    <td className={`px-3 py-1.5 ${summary ? "font-semibold text-foreground" : "pl-6 text-foreground/90"}`}>
                      {summary ? OUTCOME_CATEGORY_LABEL[group.category] : group.group}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted">{group.total}</td>
                    {OUTCOME_HORIZONS.map((key) => {
                      const stat = group.horizons[key];
                      return (
                        <td key={key} className="px-2 py-1.5 text-right font-mono" title={`${key} 已完成 ${stat.n} 条`}>
                          <span className={`font-semibold ${winTone(stat)}`}>{rate(stat.winRate)}</span>
                          <span className={`ml-1.5 ${stat.n < OUTCOME_MIN_SAMPLE ? "text-muted" : tone(stat.medianPct)}`}>{pct(stat.medianPct)}</span>
                          <span className="ml-1 text-[10px] text-muted">n{stat.n}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-5 text-xs text-muted">样本积累中，每条预警满 1h / 4h / 24h 后自动记录。</p>
      )}
      <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">灰色 = 样本少于 {OUTCOME_MIN_SAMPLE} 条。</p>
    </Section>
  );
}

function PullbackCard({ signal, ticker, nowMs, asset }: { signal: BoardSignal; ticker: Ticker | undefined; nowMs: number; asset?: string }) {
  const stop = num(signal.detail, "stopPrice");
  const current = ticker?.price ?? null;
  const since = current ? (current / signal.refPrice - 1) * 100 : null;
  const outcome = signal.outcome as { returnPct?: number; stopHit?: boolean } | null;
  const endsAt = Date.parse(signal.signalAt) + HOLD_MS;
  let status: { label: string; className: string };
  if (outcome && typeof outcome.returnPct === "number") {
    status = { label: `已结束 ${pct(outcome.returnPct)}${outcome.stopHit ? " · 止损" : ""}`, className: tone(outcome.returnPct) };
  } else if (current !== null && stop !== null && current <= stop) {
    status = { label: "已跌破止损", className: "text-danger" };
  } else {
    const leftH = Math.max(0, Math.ceil((endsAt - nowMs) / 3_600_000));
    status = { label: `观察中 · 剩 ${leftH}h`, className: "text-accent" };
  }
  return (
    <article id={`signal-${signal.symbol}`} className="rounded-md border border-line border-l-[3px] border-l-success bg-workspace-surface-raised p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><MarketSymbolLink symbol={signal.symbol} className="font-mono text-sm font-bold text-foreground" /><AssetBadge type={asset} /></span>
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">回调买点</span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted">
        <div><dt>参考价</dt><dd className="font-mono text-xs font-semibold text-foreground">{price(signal.refPrice)}</dd></div>
        <div><dt>止损 -8%</dt><dd className="font-mono text-xs font-semibold text-foreground">{price(stop)}</dd></div>
        <div><dt>至今</dt><dd className={`font-mono text-xs font-semibold ${tone(since)}`}>{pct(since)}</dd></div>
      </dl>
      <p className="mt-1.5 text-[11px] text-muted">
        {clock(signal.signalAt)} 提示 · 触发前 24h {pct(num(signal.detail, "pre24hPct"))} · 触发后高点 {price(num(signal.detail, "highSinceTrigger"))}
      </p>
      {signal.aiNote ? <p className="mt-1.5 text-xs leading-5 text-foreground/85">{signal.aiNote}</p> : null}
      <p className={`mt-1 text-[11px] font-medium ${status.className}`}>{status.label}</p>
    </article>
  );
}

function WatchRow({ signal, nowMs, asset }: { signal: BoardSignal; nowMs: number; asset?: string }) {
  const funding = num(signal.detail, "funding");
  return (
    <li className="px-3 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1"><MarketSymbolLink symbol={signal.symbol} className="min-w-0 truncate font-mono font-semibold text-foreground" /><AssetBadge type={asset} /></span>
      <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted">
        <span title="OI 24h 变化">OI {pct(num(signal.detail, "oi24hPct"), 0)}</span>
        <span title="资金费率" className={funding !== null && funding < 0 ? "text-danger" : undefined}>
          费率 {funding === null ? "—" : `${(funding * 100).toFixed(3)}%`}
        </span>
        <span title="价格 24h">24h {pct(num(signal.detail, "px24hPct"))}</span>
        <span className="w-14 text-right">{age(signal.signalAt, nowMs)}</span>
      </span>
      </div>
      {signal.aiNote ? <p className="mt-0.5 text-[11px] leading-5 text-foreground/80">{signal.aiNote}</p> : null}
    </li>
  );
}

function cardStage(row: CardRow, nowMs: number, event?: BoardEvent) {
  if (event) {
    const styles = { down: "bg-danger-soft text-danger", squeeze: "bg-warning-soft text-warning", up: "bg-info-soft text-info" };
    return { label: triggerLabel(event), style: styles[directionOf(event)] };
  }
  return row.episode && nowMs >= row.episode.firstAt + EPISODE_MS
    ? { label: "观察结束", style: "bg-workspace-canvas text-muted" }
    : { label: "爆量观察", style: "bg-warning-soft text-warning" };
}

function Metric({ label, value, title, className = "", compact = false }: { label: string; value: string; title?: string; className?: string; compact?: boolean }) {
  return <div className={className} title={title}><dt className="text-[11px] leading-5 text-muted">{label}</dt>
    <dd className={`font-mono font-semibold tabular-nums text-foreground ${compact ? "text-sm" : "text-base"}`}>{value}</dd>
  </div>;
}

function OutcomeChips({ outcome }: { outcome: RecentOutcomes[string] | undefined }) {
  if (!outcome) return null;
  return (
    <span className="ml-1.5 text-[10px]">
      {OUTCOME_HORIZONS.filter((key) => outcome[key] !== null).map((key) => (
        <span key={key} className="ml-1">{key} <span className={tone(outcome[key])}>{pct(outcome[key])}</span></span>
      ))}
    </span>
  );
}

function quoteVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "暂无采样";
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(2))} 万 USDT`;
  return `${Number(value.toFixed(2)).toLocaleString("zh-CN")} USDT`;
}

function SignalCard({ row, ticker, candles, metrics, nowMs, expanded, onToggle, starred, onStar, asset, outcomes, guidance, direction }: {
  row: CardRow; ticker?: Ticker; candles: MarketSignalsBoardData["cardCandles"][string];
  metrics?: MarketSignalsBoardData["cardMetrics"][string]; nowMs: number; expanded: boolean; onToggle: () => void;
  starred: boolean; onStar: () => void; asset?: string; outcomes: RecentOutcomes; guidance?: string; direction: DirectionFilter;
}) {
  const { symbol, episode } = row;
  const stageEvent = currentStageEvent(row, direction);
  const stage = cardStage(row, nowMs, stageEvent);
  const last = row.events[0];
  const bar = candles.at(-1);
  const lastCloseMs = bar ? bar.at + 60_000 : 0;
  const useClose = bar && (!ticker || lastCloseMs > Date.parse(ticker.updatedAt));
  const current = useClose ? bar.close : ticker?.price;
  const since = episode && current && episode.firstPrice > 0 ? (current / episode.firstPrice - 1) * 100 : null;
  const chartUrl = row.events.find(event => event.chartUrl)?.chartUrl;
  const firstConfirmation = row.confirmations[0];
  const confirmIds = new Set(row.confirmations.map(event => event.id));
  const timeline = row.events.map(event => ({
    id: event.id, at: eventTime(event), color: directionOf(event) === "down" ? "text-danger" : directionOf(event) === "squeeze" ? "text-warning" : "text-info",
    title: confirmIds.has(event.id) ? `暴涨确认 L${event.level}` : `${episode ? "独立触发 · " : ""}${event.stage} · L${event.level}`,
    detail: [event.trigger, `触发价 ${price(event.price)}`, event.changePct == null ? null : pct(event.changePct), event.volumeRatio == null ? null : `量比 ${event.volumeRatio.toFixed(2)} 倍`].filter(Boolean).join(" · "),
    outcome: outcomes[event.id] as RecentOutcomes[string] | undefined,
  }));
  if (episode) {
    timeline.push({ id: "first-burst", at: episode.firstAt, color: "text-warning", title: "首次爆量", detail: `1 分钟成交额 ${quoteVolume(episode.firstQuoteVolume)}`, outcome: undefined });
    if (episode.count > 1) timeline.push({ id: "repeat-burst", at: episode.lastAt, color: "text-warning", title: "再次爆量", detail: `本轮累计 ${episode.count} 次`, outcome: undefined });
    if (firstConfirmation && !timeline.some(item => item.id === firstConfirmation.id)) {
      timeline.push({ id: firstConfirmation.id, at: eventTime(firstConfirmation), color: "text-info", title: `暴涨确认 L${firstConfirmation.level}`, detail: `触发价 ${price(firstConfirmation.price)}`, outcome: outcomes[firstConfirmation.id] });
    }
  }
  timeline.sort((a, b) => a.at - b.at);
  const preview = episode ? timeline.filter(item => item.id === "first-burst" || item.id === firstConfirmation?.id || item.id === stageEvent?.id) : timeline.slice(-2);
  const detailsId = `details-${symbol}`;
  const funding = metrics?.fundingRate;
  return (
    <li id={`coin-${symbol}`} className="@container min-w-0 scroll-mt-24 rounded-xl border border-workspace-line-strong bg-workspace-surface px-3.5 py-3 sm:px-5 sm:py-4">
      <header className="grid min-w-0 gap-x-3 gap-y-2 @min-[520px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <MarketSymbolLink symbol={symbol} className="max-w-full truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl" />
          <span className="hidden text-xs text-muted @min-[520px]:inline">USDT 永续</span>
          <AssetBadge type={asset} />
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${stage.style}`}>{stage.label}</span>
          <button type="button" aria-pressed={starred} aria-label={`${starred ? "取消自选" : "加入自选"} ${base(symbol)}`} onClick={onStar}
            className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-workspace-canvas @min-[520px]:ml-0">
            <Star aria-hidden className={`size-4 ${starred ? "fill-warning text-warning" : ""}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 @min-[520px]:row-span-2 @min-[520px]:flex-col @min-[520px]:items-end">
          <span title={`最近报价 · ${useClose ? cardTime(lastCloseMs) : clock(ticker?.updatedAt)}`} className="font-mono text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl"><span className="sr-only">最新价格 </span>{price(current)}</span>
          {episode ? <span className={`text-xs font-semibold ${tone(since)}`}>较首爆 {pct(since, 2)}</span> : <span className={`text-xs font-semibold ${tone(ticker?.pct24h)}`}>24h {pct(ticker?.pct24h)}</span>}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
          {episode ? <span>首爆 <b className="font-mono font-medium text-foreground">{cardTime(episode.firstAt)}</b> · {price(episode.firstPrice)} USDT</span>
            : <span>最近触发 {cardTime(row.latestAt)} · {price(last?.price)} USDT</span>}
          <span className="font-mono text-[10px]">FDV {money(ticker?.fdvUsd ?? last?.fdvUsd)}</span>
          {guidance ? <span className="text-[10px]">{guidance}</span> : null}
        </div>
      </header>

      <div className="mt-3 grid gap-3 border-t border-line pt-3 @min-[580px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] @min-[580px]:gap-4">
        <MarketSignalCardChart row={row} candles={candles} endMs={nowMs} stageEvent={stageEvent} />
        <dl className="grid grid-cols-2 content-start gap-x-2 gap-y-3 border-t border-line pt-2 @min-[580px]:border-l @min-[580px]:border-t-0 @min-[580px]:pl-4 @min-[580px]:pt-0">
          <Metric label="首爆量比" value={episode ? `${episode.firstRatio.toFixed(2)} 倍` : "—"} />
          <Metric label="1h 持仓量变化" value={pct(metrics?.oi1hPct, 2)} title="最近两个已完成整点之间，未平仓合约数量的变化" />
          <Metric label="资金费率" value={funding == null ? "—" : pct(funding * 100, 3)} className={expanded ? "" : "hidden @min-[580px]:block"} />
          <Metric label="15m 空头强平（采样）" value={quoteVolume(metrics?.shortLiquidations15m)} title="最近 15 分钟实际采集到的空头强平成交额" className={expanded ? "" : "hidden @min-[580px]:block"} compact />
        </dl>
      </div>

      <div id={detailsId} className={`mt-3 border-t border-line pt-2.5 ${expanded ? "" : "hidden @min-[580px]:block"}`}>
        <ol aria-label={`${base(symbol)} 触发时间线`} className={`grid gap-1.5 text-xs ${expanded ? "max-h-64 overflow-y-auto" : ""}`}>
          {(expanded ? timeline : preview).map(item => (
            <li key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
              <time dateTime={new Date(item.at).toISOString()} className={`font-mono font-semibold ${item.color}`}>{cardTime(item.at)}</time>
              <span className="min-w-0"><span className="font-medium">{item.title}</span> <span className="text-muted">{item.detail}</span><OutcomeChips outcome={item.outcome} /></span>
            </li>
          ))}
        </ol>
        {expanded ? <p className="mt-2 text-[10px] text-muted">24h {pct(ticker?.pct24h)} · 流通市值 {money(ticker?.marketCapUsd ?? last?.marketCapUsd)}</p> : null}
        {expanded && chartUrl ? <Image unoptimized src={chartUrl} alt={`${base(symbol)} 最近触发时的 K 线快照`} width={1200} height={630} className="mt-2 h-auto w-full max-w-lg rounded border border-line" /> : null}
      </div>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
          {expanded ? "收起详情" : <><span className="@min-[580px]:hidden">展开费率、强平与记录</span><span className="hidden @min-[580px]:inline">查看全部触发记录</span></>}
          <ChevronDown aria-hidden className={`size-3.5 ${expanded ? "rotate-180" : ""}`} />
        </button>
        <Link href={`/news?symbol=${encodeURIComponent(symbol)}`} prefetch={false} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-info hover:underline" aria-label={`打开 ${base(symbol)} 实时 K 线`}>
          打开实时 K 线 <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </footer>
    </li>
  );
}

export function MarketSignalsBoard({ initialData }: { initialData: MarketSignalsBoardData }) {
  const [data, setData] = useState(initialData);
  const [nowMs, setNowMs] = useState(() => Date.parse(initialData.generatedAt));
  const [connection, setConnection] = useState<"live" | "retrying">("live");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("crypto");
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [cardLimit, setCardLimit] = useState(CARDS_PER_PAGE);
  const [focusRequest, setFocusRequest] = useState<{ symbol: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/market-signals", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as MarketSignalsBoardData;
      setData(next);
      setNowMs(Date.parse(next.generatedAt));
      setConnection("live");
    } catch {
      setConnection("retrying");
    }
  }, []);

  useEffect(() => {
    let lastLoad = Date.now();
    let pending = 0;
    const throttled = () => {
      if (pending) return;
      const wait = Math.max(0, lastLoad + REFRESH_MIN_GAP_MS - Date.now());
      pending = window.setTimeout(() => {
        pending = 0;
        lastLoad = Date.now();
        void load();
      }, wait);
    };
    const poll = window.setInterval(throttled, 60_000);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    const stream = new EventSource("/api/market-alerts/stream?updates=revision");
    stream.addEventListener("market-alerts-snapshot", throttled);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clockTimer);
      window.clearTimeout(pending);
      stream.close();
    };
  }, [load]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(WATCHLIST_KEY) ?? "[]");
      if (Array.isArray(parsed)) queueMicrotask(() => setWatchlist(parsed.filter((item) => typeof item === "string")));
    } catch { /* ignore a damaged watchlist */ }
    const symbol = new URLSearchParams(window.location?.search ?? "").get("symbol");
    if (symbol && /^[A-Z0-9]{2,40}$/.test(symbol)) {
      queueMicrotask(() => {
        setExpanded(symbol);
        if (initialData.assetClasses?.[symbol] === "EQUITY") setAssetFilter("equity");
        setFocusRequest({ symbol });
      });
    }
  }, [initialData.assetClasses]);

  const toggleStar = useCallback((symbol: string) => {
    setWatchlist((current) => {
      const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol];
      try { window.localStorage?.setItem(WATCHLIST_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, []);

  const tickers = useMemo(() => new Map(data.tickers.map((ticker) => [ticker.symbol, ticker])), [data.tickers]);
  const btc24h = tickers.get("BTCUSDT")?.pct24h ?? null;
  const btcWarning = btc24h !== null && btc24h <= data.signals.rules.btcShortWarningPct;
  const coinSymbols = useMemo(() => new Set(data.signals.coinSymbols), [data.signals.coinSymbols]);
  const scopedSignals = useMemo(
    () => data.signals.signals.filter(signal => coinSymbols.has(signal.symbol)),
    [data.signals.signals, coinSymbols],
  );
  const pullbacks = useMemo(() => scopedSignals.filter(signal => signal.kind === "pullback_long"), [scopedSignals]);
  const coils = scopedSignals.filter(signal => signal.kind === "coil_watch" && nowMs - Date.parse(signal.signalAt) <= WATCH_SHOW_MS);
  const volatiles = scopedSignals.filter(signal => signal.kind === "volatile_watch" && nowMs - Date.parse(signal.signalAt) <= WATCH_SHOW_MS);
  const activePullback = useMemo(() => {
    const map = new Map<string, BoardSignal>();
    for (const signal of pullbacks) if (!map.has(signal.symbol)) map.set(signal.symbol, signal);
    return map;
  }, [pullbacks]);

  const rows = useMemo(() => buildCardRows(data, {
    asset: assetFilter, direction: directionFilter, watchlist, startMs: nowMs - WINDOW_MS[windowKey], endMs: nowMs,
  }), [data, assetFilter, directionFilter, watchlist, nowMs, windowKey]);
  const feed = useMemo(() => rows.flatMap(row => row.events).sort((a, b) => eventTime(b) - eventTime(a)).slice(0, 30), [rows]);
  const visibleRows = rows.slice(0, cardLimit);
  if (expanded && !visibleRows.some(row => row.symbol === expanded)) {
    const target = rows.find(row => row.symbol === expanded);
    if (target) visibleRows.push(target);
  }
  const canScroll = !!focusRequest && visibleRows.some(row => row.symbol === focusRequest.symbol);
  useEffect(() => {
    if (focusRequest && canScroll) document.getElementById(`coin-${focusRequest.symbol}`)?.scrollIntoView({ block: "center" });
  }, [focusRequest, canScroll]);

  const liveWorkers = Object.values(data.health).filter((heartbeat) => getMarketAlertWorkerView(heartbeat, nowMs).online).length;
  const signalsStale = !data.signals.meta.lastSuccessAt || nowMs - Date.parse(data.signals.meta.lastSuccessAt) > SIGNALS_STALE_MS;
  const stats = data.signals.cryptoStats;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${connection === "live" && liveWorkers === 4 && !signalsStale ? "bg-success" : "bg-warning"}`} />
          <span>行情 {liveWorkers}/4 在线</span>
          <span>· 数据 {age(data.latestUpdatedAt, nowMs)}</span>
          <span className={signalsStale ? "text-warning" : undefined}>
            · 信号计算 {data.signals.meta.lastSuccessAt ? age(data.signals.meta.lastSuccessAt, nowMs) : "尚未运行"}
          </span>
          {connection === "retrying" ? <span className="text-warning">· 连接重试中</span> : null}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <div role="group" aria-label="标的类别" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {([["仅加密", "crypto"], ["仅美股", "equity"]] as const).map(([label, value]) => (
              <button key={label} type="button" aria-pressed={assetFilter === value} onClick={() => { setAssetFilter(value); setCardLimit(CARDS_PER_PAGE); setFocusRequest(null); }} className={`rounded px-2.5 py-1 text-xs font-semibold ${assetFilter === value ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div role="group" aria-label="方向" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {([["all", "全部"], ["observation", "爆量观察"], ["up", "涨"], ["down", "跌"], ["squeeze", "轧空"], ["watch", `★ ${watchlist.length}`]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={directionFilter === key} onClick={() => { setDirectionFilter(key); setCardLimit(CARDS_PER_PAGE); setFocusRequest(null); }} className={`rounded px-2.5 py-1 text-xs font-semibold ${directionFilter === key ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div role="group" aria-label="时间范围" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {(["1h", "4h", "24h"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={windowKey === key} onClick={() => { setWindowKey(key); setCardLimit(CARDS_PER_PAGE); setFocusRequest(null); }} className={`rounded px-2.5 py-1 text-xs font-semibold ${windowKey === key ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{key}</button>
            ))}
          </div>
        </div>
      </div>

      {btcWarning ? (
        <p role="status" className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          BTC 24h {pct(btc24h)}，已跌超 {Math.abs(data.signals.rules.btcShortWarningPct)}%。回测中这时追空山寨币两段都亏损，容易追在反弹前。
        </p>
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="回调买点" hint="暴涨后回调再接，不追高">
          {pullbacks.length ? (
            <div className="grid gap-2 p-2.5 sm:grid-cols-2">
              {pullbacks.map((signal) => <PullbackCard key={signal.id} signal={signal} ticker={tickers.get(signal.symbol)} nowMs={nowMs} asset={data.assetClasses?.[signal.symbol]} />)}
            </div>
          ) : (
            <p className="px-3 py-5 text-xs leading-5 text-muted">
              过去 24h 暂无。规则：暴涨触发且触发前 24h 涨幅 &lt;{data.signals.rules.maxPre24hPct}%，之后 12h 内从高点回调 {data.signals.rules.pullbackPct}% 时提示，止损 {data.signals.rules.stopPct}%，持有 24h。
            </p>
          )}
          <StatsLine
            live={stats.pullback_long.n ? `${stats.pullback_long.n} 笔，胜率 ${rate(stats.pullback_long.winRate)}，均值 ${pct(stats.pullback_long.meanReturnPct, 2)}，中位 ${pct(stats.pullback_long.medianReturnPct, 2)}` : "样本积累中"}
            backtest="验证段均值 +3.8%，胜率 35%；靠少数大涨盈利，需严格止损"
          />
        </Section>
        <Section title="蓄力（实验）" hint="OI 大增但价格没动">
          {coils.length ? (
            <ul className="divide-y divide-line/70">{coils.map((signal) => <WatchRow key={signal.id} signal={signal} nowMs={nowMs} asset={data.assetClasses?.[signal.symbol]} />)}</ul>
          ) : (
            <p className="px-3 py-5 text-xs leading-5 text-muted">过去 12h 暂无。条件：OI 24h ≥ +30%，价格 4h 横盘（±3% 内），24h 涨幅 &lt;10%。</p>
          )}
          <StatsLine
            live={stats.coil_watch.n ? `${stats.coil_watch.n} 次，12h 内涨 15% ${rate(stats.coil_watch.launchRate)}，跌 15% ${rate(stats.coil_watch.crashRate)}` : "样本积累中"}
            backtest="样本太少（每段 5–22 个），不推送，先观察"
          />
        </Section>
        <Section title="大波动预警" hint="方向未定，不是做多信号">
          {volatiles.length ? (
            <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">{volatiles.map((signal) => <WatchRow key={signal.id} signal={signal} nowMs={nowMs} asset={data.assetClasses?.[signal.symbol]} />)}</ul>
          ) : (
            <p className="px-3 py-5 text-xs leading-5 text-muted">过去 12h 暂无。条件：资金费率 ≤ -0.1%，或 OI 24h ≥ +30%。</p>
          )}
          <StatsLine
            live={stats.volatile_watch.n ? `${stats.volatile_watch.n} 次，12h 内涨 15% ${rate(stats.volatile_watch.launchRate)}，跌 15% ${rate(stats.volatile_watch.crashRate)}` : "样本积累中"}
            backtest="12h 内涨跌 15% 的概率是平时的 3–9 倍，方向五五开"
          />
        </Section>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section className="min-w-0" aria-label="异动卡片">
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-base font-semibold text-foreground">异动卡片</h2>
            <span className="text-xs text-muted">{windowKey} · {rows.length} 个标的</span>
          </header>
          {rows.length ? (
            <ul className="grid min-w-0 gap-3">
              {visibleRows.map(row => {
                const ticker = tickers.get(row.symbol);
                const hasPullback = activePullback.has(row.symbol) && !activePullback.get(row.symbol)?.outcome;
                const latest = row.events[0];
                let guidance: string | undefined;
                if (hasPullback) guidance = "回调买点";
                else if (coinSymbols.has(row.symbol) && !row.episode && latest) {
                  const direction = directionOf(latest);
                  if (direction === "up") guidance = (ticker?.pct24h ?? 0) >= data.signals.rules.maxPre24hPct ? "暴涨 · 不追" : "暴涨 · 等回调";
                  if (direction === "down" && btcWarning) guidance = "暴跌 · 别追空";
                  if (direction === "squeeze") guidance = "轧空 · 高波动";
                }
                return <SignalCard key={row.symbol} row={row} ticker={ticker} nowMs={nowMs} direction={directionFilter}
                  metrics={data.cardMetrics?.[row.symbol]} candles={data.cardCandles?.[row.symbol] ?? []}
                  expanded={expanded === row.symbol} onToggle={() => setExpanded(current => current === row.symbol ? null : row.symbol)}
                  starred={watchlist.includes(row.symbol)} onStar={() => toggleStar(row.symbol)}
                  asset={data.assetClasses?.[row.symbol]} outcomes={data.signals.recentAlertOutcomes ?? {}} guidance={guidance} />;
              })}
            </ul>
          ) : <p className="rounded-lg border border-line px-3 py-10 text-center text-sm text-muted">当前筛选下没有触发</p>}
          {rows.length > visibleRows.length ? <button type="button" onClick={() => setCardLimit(limit => limit + CARDS_PER_PAGE)}
            className="mt-2 w-full rounded-lg border border-line bg-workspace-surface px-3 py-2 text-xs font-medium text-muted hover:text-foreground">
            显示更多 · 已显示 {visibleRows.length} / {rows.length}
          </button> : null}
        </section>

        <details open className="group min-w-0 rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm lg:sticky lg:top-[5.75rem]">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <span>最新触发</span>
            <ChevronDown aria-hidden className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <ol className="max-h-[70vh] divide-y divide-line/70 overflow-y-auto border-t border-line">
            {feed.length ? feed.map((event) => (
              <li key={event.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs">
                <span className="font-mono text-muted">{cardTime(eventTime(event))}</span>
                <MarketSymbolLink symbol={event.symbol} className="min-w-0 truncate font-mono font-semibold text-foreground" />
                <AssetBadge type={data.assetClasses?.[event.symbol]} />
                <button
                  type="button"
                  aria-label={`展开 ${base(event.symbol)} 的触发记录`}
                  onClick={() => { setExpanded(event.symbol); setFocusRequest({ symbol: event.symbol }); }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded text-left hover:bg-workspace-surface-raised"
                >
                  <span className={directionOf(event) === "up" ? "text-success" : directionOf(event) === "down" ? "text-danger" : "text-warning"}>
                    {event.stage} · L{event.level}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{pct(event.changePct)}</span>
                </button>
              </li>
            )) : <li className="px-3 py-6 text-center text-xs text-muted">暂无</li>}
          </ol>
        </details>
      </div>

      <AlertOutcomeTable groups={assetFilter === "equity" ? data.signals.equityAlertOutcomeGroups : data.signals.cryptoAlertOutcomeGroups} windowDays={data.signals.alertOutcomeStats?.windowDays ?? 14} />

      <p className="text-right text-[11px] text-muted">
        规则依据与回测见 docs/market-signals.md · <Link href="/alerts/legacy" className="underline hover:text-foreground">打开旧版异动页</Link>
      </p>
    </div>
  );
}
