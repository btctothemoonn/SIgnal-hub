"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Search, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBoardWorkerHealth } from "@/lib/market-alerts-health";
import type { MarketSignalsBoardData } from "@/lib/market-signals-view";
import { MarketSignalCardChart, cardTime } from "./market-signal-card-chart";
import { findMarketSymbols } from "./market-symbol-search";
import {
  buildCardRows, directionOf, eventTime, lifecycleLabels, triggerLabel, type CardRow,
} from "./market-signal-card-model";

type Ticker = MarketSignalsBoardData["tickers"][number];
type RecentOutcomes = MarketSignalsBoardData["signals"]["recentAlertOutcomes"];
type WindowKey = "1h" | "4h" | "24h";

const WATCHLIST_KEY = "market-alert-watchlist";
const WINDOW_MS: Record<WindowKey, number> = { "1h": 3_600_000, "4h": 4 * 3_600_000, "24h": 24 * 3_600_000 };
const SIGNALS_STALE_MS = 15 * 60_000;
const REFRESH_MIN_GAP_MS = 15_000;
const INITIAL_CARD_LIMITS = { special: 2, startup: 2, weakening: 2, up: 2, down: 2 };
const SEARCH_PAGE_SIZE = 12;
const FOCUS_GROUPS = [
  { key: "special", label: "突发异动" },
  { key: "startup", label: lifecycleLabels.startup },
  { key: "weakening", label: lifecycleLabels.weakening },
] as const;

const EQUITY_GROUPS = [
  { key: "up", label: "强暴涨" },
  { key: "down", label: "强暴跌" },
] as const;

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

const OUTCOME_HORIZONS = ["1h", "4h", "24h"] as const;

const badgeStyles = {
  up: "bg-info-soft text-info", down: "bg-danger-soft text-danger", squeeze: "bg-warning-soft text-warning",
  startup: "bg-info-soft text-info", pumped: "bg-warning-soft text-warning", weakening: "bg-danger-soft text-danger",
};

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

function SignalCard({ row, ticker, candles, metrics, nowMs, expanded, onToggle, starred, onStar, outcomes, equities }: {
  row: CardRow; ticker?: Ticker; candles: MarketSignalsBoardData["cardCandles"][string];
  metrics?: MarketSignalsBoardData["cardMetrics"][string]; nowMs: number; expanded: boolean; onToggle: () => void;
  starred: boolean; onStar: () => void; outcomes: RecentOutcomes; equities: boolean;
}) {
  const { symbol, episode, focus } = row;
  const last = row.events[0];
  const phase = focus.kind === "special" ? undefined : focus.phase;
  const special = focus.kind === "special" ? focus.event : undefined;
  const label = focus.kind === "special"
    ? `${focus.event.type === "short_squeeze" ? "轧空" : focus.event.side === "SHORT" ? "突发暴跌" : "突发暴涨"} L${focus.event.level}`
    : lifecycleLabels[focus.kind];
  const style = badgeStyles[focus.kind === "special" ? directionOf(focus.event) : focus.kind];
  const signalPrice = focus.kind === "special" ? focus.event.price : focus.phase.price;
  const secondaryPhase = special ? row.lifecycleEvents[0] : undefined;
  const bar = candles.at(-1);
  const lastCloseMs = bar ? bar.at + 60_000 : 0;
  const useClose = bar && (!ticker || lastCloseMs > Date.parse(ticker.updatedAt));
  const current = useClose ? bar.close : ticker?.price;
  const since = current != null && signalPrice > 0 ? (current / signalPrice - 1) * 100 : null;
  const chartUrl = row.events.find(event => event.chartUrl)?.chartUrl;
  const timeline = row.events.map(event => ({
    id: event.id, at: eventTime(event), color: directionOf(event) === "down" ? "text-danger" : directionOf(event) === "squeeze" ? "text-warning" : "text-info",
    title: triggerLabel(event),
    detail: [event.trigger, `触发价 ${price(event.price)}`, event.changePct == null ? null : pct(event.changePct), event.volumeRatio == null ? null : `量比 ${event.volumeRatio.toFixed(2)} 倍`].filter(Boolean).join(" · "),
    outcome: outcomes[event.id] as RecentOutcomes[string] | undefined,
  }));
  for (const item of row.lifecycleEvents) {
    timeline.push({ id: item.id, at: item.at, color: item.kind === "weakening" ? "text-danger" : "text-info",
      title: lifecycleLabels[item.kind], detail: `收盘价 ${price(item.price)} USDT`, outcome: undefined });
    if (item.kind === "weakening") {
      if (!row.lifecycleEvents.some(prior => prior.kind === "pumped" && prior.at === item.pumpAt)) {
        timeline.push({ id: `pump-${item.id}`, at: item.pumpAt, color: "text-warning", title: "已大涨", detail: "进入跟踪", outcome: undefined });
      }
      if (expanded && item.retestAt != null && item.retestPrice != null) {
        timeline.push({ id: `retest-${item.id}`, at: item.retestAt, color: "text-muted",
          title: "反抽失败", detail: `收盘价 ${price(item.retestPrice)} USDT`, outcome: undefined });
      }
    }
  }
  if (episode) timeline.push({ id: "first-burst", at: episode.firstAt, color: "text-muted",
    title: "首次爆量", detail: `${episode.firstRatio.toFixed(2)} 倍 · 1 分钟成交额 ${quoteVolume(episode.firstQuoteVolume)}`, outcome: undefined });
  timeline.sort((a, b) => a.at - b.at);
  const preview = timeline.filter(item => item.id !== "first-burst").slice(-2);
  const detailsId = `details-${symbol}`;
  const funding = metrics?.fundingRate;
  const strength = special?.metrics?.strengthPct;
  return (
    <li id={`coin-${symbol}`} className="@container min-w-0 scroll-mt-24 rounded-xl border border-workspace-line-strong bg-workspace-surface px-3.5 py-3 sm:px-5 sm:py-4">
      <header className="grid min-w-0 gap-x-3 gap-y-2 @min-[520px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <MarketSymbolLink symbol={symbol} className="max-w-full truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl" />
          <span className="hidden text-xs text-muted @min-[520px]:inline">USDT 永续</span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${style}`}>{label}</span>
          {phase && last ? <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">{cardTime(eventTime(last))} {triggerLabel(last)}</span> : null}
          {secondaryPhase ? <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">{cardTime(secondaryPhase.at)} {lifecycleLabels[secondaryPhase.kind]}</span> : null}
          <button type="button" aria-pressed={starred} aria-label={`${starred ? "取消自选" : "加入自选"} ${base(symbol)}`} onClick={onStar}
            className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-workspace-canvas @min-[520px]:ml-0">
            <Star aria-hidden className={`size-4 ${starred ? "fill-warning text-warning" : ""}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 @min-[520px]:row-span-2 @min-[520px]:flex-col @min-[520px]:items-end">
          <span title={`最近报价 · ${useClose ? cardTime(lastCloseMs) : clock(ticker?.updatedAt)}`} className="font-mono text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl"><span className="sr-only">最新价格 </span>{price(current)}</span>
          <span className={`text-xs font-semibold ${tone(since)}`}>触发后 {pct(since, 2)}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
          <span>重点触发 <b className="font-mono font-medium text-foreground">{cardTime(row.latestAt)}</b> · {price(signalPrice)} USDT</span>
          {equities ? <span>24h 涨跌 {pct(ticker?.pct24h, 2)}</span> : <span className="font-mono text-[10px]">FDV {money(ticker?.fdvUsd ?? last?.fdvUsd)}</span>}
        </div>
      </header>

      <div className="mt-3 grid gap-3 border-t border-line pt-3 @min-[580px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] @min-[580px]:gap-4">
        <MarketSignalCardChart row={row} candles={candles} endMs={nowMs} />
        <dl className="grid grid-cols-2 content-start gap-x-2 gap-y-3 border-t border-line pt-2 @min-[580px]:border-l @min-[580px]:border-t-0 @min-[580px]:pl-4 @min-[580px]:pt-0">
          {phase?.kind === "startup" ? <>
            <Metric label="1h 涨幅" value={pct(phase.hourPct, 2)} />
            <Metric label="1h 领先市场" value={`${phase.relativePct.toFixed(2)} 个百分点`} compact />
            <Metric label="距 24h 低位" value={pct(phase.gainFromLowPct, 2)} />
          </> : phase?.kind === "weakening" ? <>
            <Metric label="本轮最高涨幅" value={pct(phase.peakGainPct, 2)} />
            <Metric label="距高位回撤" value={pct(-Math.abs(phase.drawdownPct), 2)} />
            <Metric label="失守支撑价" value={price(phase.supportPrice)} />
          </> : special?.type === "volatility" ? <>
            <Metric label="触发时近 25m 涨跌" value={pct(special.changePct, 2)} />
            <Metric label="触发强度" title="快速变动与近 25 分钟滚动变动中，幅度较大的一项"
              value={typeof strength === "number" && Number.isFinite(strength) ? `${Math.abs(strength).toFixed(2)}%` : "—"} />
            <Metric label="触发量比" value={special.volumeRatio == null ? "—" : `${special.volumeRatio.toFixed(2)} 倍`} />
          </> : special?.type === "short_squeeze" ? <Metric label="轧空阶段" value={special.stage} /> : null}
          {episode ? <Metric label="首爆量比" value={`${episode.firstRatio.toFixed(2)} 倍`} title={`首爆 ${cardTime(episode.firstAt)}`} /> : null}
          {equities ? <Metric label="24h 合约成交额" value={quoteVolume(ticker?.quoteVolume)} compact /> :
            <Metric label="1h 持仓量变化" value={pct(metrics?.oi1hPct, 2)} title="最近两个已完成整点之间，未平仓合约数量的变化" />}
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
        {expanded && !equities ? <p className="mt-2 text-[10px] text-muted">24h {pct(ticker?.pct24h)} · 流通市值 {money(ticker?.marketCapUsd ?? last?.marketCapUsd)}</p> : null}
        {expanded && chartUrl ? <Image unoptimized src={chartUrl} alt={`${base(symbol)} 最近触发时的 K 线快照`} width={1200} height={630} className="mt-2 h-auto w-full max-w-lg rounded border border-line" /> : null}
      </div>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
          {expanded ? "收起详情" : "查看触发记录"}
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
  const market = initialData.market;
  const equities = market === "equities";
  const [nowMs, setNowMs] = useState(() => Date.parse(initialData.generatedAt));
  const [connection, setConnection] = useState<"live" | "retrying">("live");
  const [watchOnly, setWatchOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE_SIZE);
  const searchInput = useRef<HTMLInputElement>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [cardLimits, setCardLimits] = useState(INITIAL_CARD_LIMITS);
  const [focusRequest, setFocusRequest] = useState<{ symbol: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/market-signals?market=${market}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as MarketSignalsBoardData;
      setData(next);
      setNowMs(Date.parse(next.generatedAt));
      setConnection("live");
    } catch {
      setConnection("retrying");
    }
  }, [market]);

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
    if (symbol) {
      queueMicrotask(() => {
        setExpanded(symbol);
        setFocusRequest({ symbol });
      });
    }
  }, []);

  const toggleStar = useCallback((symbol: string) => {
    setWatchlist((current) => {
      const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol];
      try { window.localStorage?.setItem(WATCHLIST_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, []);

  const tickers = useMemo(() => new Map(data.tickers.map((ticker) => [ticker.symbol, ticker])), [data.tickers]);
  const rows = useMemo(() => buildCardRows(data, {
    startMs: nowMs - WINDOW_MS[windowKey], endMs: nowMs,
  }), [data, nowMs, windowKey]);
  const searching = query.trim().length > 0;
  const searchLabel = data.market === "equities" ? "搜索股票代码" : "搜索币种";
  const hasMarketFavorites = watchlist.some(symbol => data.searchSymbols.includes(symbol));
  const searchMatches = useMemo(() => {
    if (!searching) return [];
    const symbols = watchOnly ? data.searchSymbols.filter(symbol => watchlist.includes(symbol)) : data.searchSymbols;
    return findMarketSymbols(symbols, query);
  }, [data.searchSymbols, watchOnly, watchlist, query, searching]);
  const rowsBySymbol = new Map(rows.map(row => [row.symbol, row]));
  const filtered = searching ? searchMatches.flatMap(symbol => rowsBySymbol.get(symbol) ?? [])
    : watchOnly ? rows.filter(row => watchlist.includes(row.symbol)) : rows;
  const otherMatches = searchMatches.filter(symbol => !rowsBySymbol.has(symbol));
  function updateSearch(value: string) {
    setQuery(value);
    setSearchLimit(SEARCH_PAGE_SIZE);
    setFocusRequest(null);
  }
  const groups = (equities ? EQUITY_GROUPS : FOCUS_GROUPS).map(group => ({
    ...group,
    rows: filtered.filter(({ focus }) => group.key === (equities && focus.kind === "special" ? directionOf(focus.event) : focus.kind)),
  }));
  const visibleGroups = groups.map(group => {
    const visibleRows = group.rows.slice(0, cardLimits[group.key]);
    const target = expanded && group.rows.find(row => row.symbol === expanded);
    if (target && !visibleRows.includes(target)) visibleRows.push(target);
    return { ...group, visibleRows };
  });
  const canScroll = !!focusRequest && visibleGroups.some(group => group.visibleRows.some(row => row.symbol === focusRequest.symbol));
  useEffect(() => {
    if (focusRequest && canScroll) document.getElementById(`coin-${focusRequest.symbol}`)?.scrollIntoView({ block: "center" });
  }, [focusRequest, canScroll]);

  const { online, total } = getBoardWorkerHealth(data.health, market, nowMs);
  const signalsStale = !equities && (!data.signals.meta.lastSuccessAt || nowMs - Date.parse(data.signals.meta.lastSuccessAt) > SIGNALS_STALE_MS);
  const btc24h = tickers.get("BTCUSDT")?.pct24h;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${connection === "live" && online === total && !signalsStale ? "bg-success" : "bg-warning"}`} />
          <span>行情 {online}/{total} 在线</span>
          <span>· 数据 {age(data.latestUpdatedAt, nowMs)}</span>
          {!equities ? <span className={signalsStale ? "text-warning" : undefined}>
            · 信号计算 {data.signals.meta.lastSuccessAt ? age(data.signals.meta.lastSuccessAt, nowMs) : "尚未运行"}
          </span> : null}
          {connection === "retrying" ? <span className="text-warning">· 连接重试中</span> : null}
        </p>
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-md border border-line bg-workspace-surface px-2 focus-within:border-accent">
            <Search aria-hidden="true" size={14} className="text-muted" />
            <input ref={searchInput} type="text" role="searchbox" aria-label={searchLabel} placeholder={searchLabel}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} value={query}
              onChange={event => updateSearch(event.target.value)}
              onKeyDown={event => { if (event.key === "Escape") updateSearch(""); }}
              className="w-24 bg-transparent py-1.5 text-xs text-foreground outline-none placeholder:text-muted" />
            {query ? <button type="button" aria-label="清空搜索" onClick={() => { updateSearch(""); searchInput.current?.focus(); }}
              className="rounded p-1 text-muted hover:text-foreground"><X aria-hidden="true" size={13} /></button> : null}
          </div>
          {hasMarketFavorites || watchOnly ? <button type="button" aria-pressed={watchOnly}
            onClick={() => { setWatchOnly(current => !current); setFocusRequest(null); }}
            className={`rounded-md border border-line px-2.5 py-1 text-xs font-semibold ${watchOnly ? "bg-workspace-surface text-foreground" : "text-muted"}`}>
            仅自选
          </button> : null}
          <div role="group" aria-label="时间范围" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {(["1h", "4h", "24h"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={windowKey === key} onClick={() => { setWindowKey(key); setCardLimits(INITIAL_CARD_LIMITS); setFocusRequest(null); }} className={`rounded px-2.5 py-1 text-xs font-semibold ${windowKey === key ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{key}</button>
            ))}
          </div>
        </div>
      </div>

      {!equities && btc24h != null && btc24h <= data.signals.rules.btcShortWarningPct ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          BTC 24h {pct(btc24h)}，已触及 {pct(data.signals.rules.btcShortWarningPct)} 警戒线。历史回测中，这种行情下追空山寨币在前后两个时段均亏损。
        </p>
      ) : null}
      <div className={`grid min-w-0 items-start gap-3 lg:grid-cols-2 ${equities ? "" : "2xl:grid-cols-3"}`}>
        {visibleGroups.filter(group => !searching || group.rows.length > 0).map(({ key: groupKey, label: groupLabel, rows: groupRows, visibleRows }) => <section key={groupLabel} className="min-w-0" aria-label={groupLabel}>
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-base font-semibold text-foreground">{groupLabel}</h2>
            <span className="text-xs text-muted">{windowKey} · {groupRows.length} 个标的</span>
          </header>
          {groupRows.length ? (
            <ul className="grid min-w-0 gap-3">
              {visibleRows.map(row => {
                const ticker = tickers.get(row.symbol);
                return <SignalCard key={row.symbol} equities={equities} row={row} ticker={ticker} nowMs={nowMs}
                  metrics={data.cardMetrics?.[row.symbol]} candles={data.cardCandles?.[row.symbol] ?? []}
                  expanded={expanded === row.symbol} onToggle={() => setExpanded(current => current === row.symbol ? null : row.symbol)}
                  starred={watchlist.includes(row.symbol)} onStar={() => toggleStar(row.symbol)}
                  outcomes={data.signals.recentAlertOutcomes ?? {}} />;
              })}
            </ul>
          ) : <p className="rounded-lg border border-line px-3 py-10 text-center text-sm text-muted">当前筛选下没有触发</p>}
          {groupRows.length > visibleRows.length ? <button type="button" onClick={() => setCardLimits(limits => ({ ...limits, [groupKey]: limits[groupKey] + INITIAL_CARD_LIMITS[groupKey] }))}
            className="mt-2 w-full rounded-lg border border-line bg-workspace-surface px-3 py-2 text-xs font-medium text-muted hover:text-foreground">
            显示更多 · 已显示 {visibleRows.length} / {groupRows.length}
          </button> : null}
        </section>)}
      </div>
      {searching && !searchMatches.length ? <p role="status" className="rounded-lg border border-line px-3 py-8 text-center text-sm text-muted">
        {watchOnly ? "自选中没有匹配的标的" : "当前市场没有匹配的标的"}
      </p> : null}
      {otherMatches.length > 0 ? <section className="rounded-lg border border-line bg-workspace-surface p-3" aria-label="其他匹配标的">
        <h2 className="mb-1 text-sm font-semibold text-foreground">{windowKey} 内没有重点异动的匹配标的 <span className="text-xs font-normal text-muted">({otherMatches.length})</span></h2>
        <ul className="divide-y divide-line">
          {otherMatches.slice(0, searchLimit).map(symbol => {
            const ticker = tickers.get(symbol);
            return <li key={symbol} className="flex items-center justify-between gap-3 py-2 text-sm">
              <MarketSymbolLink symbol={symbol} className="font-semibold text-accent" />
              {ticker ? <span className="flex gap-3 font-mono tabular-nums"><span>{price(ticker.price)}</span><span className={tone(ticker.pct24h)}>{pct(ticker.pct24h)}</span></span> : null}
            </li>;
          })}
        </ul>
        {otherMatches.length > searchLimit ? <button type="button" onClick={() => setSearchLimit(limit => limit + SEARCH_PAGE_SIZE)}
          className="mt-1 rounded-md border border-line px-3 py-1.5 text-xs text-muted">更多匹配标的</button> : null}
      </section> : null}
    </div>
  );
}
