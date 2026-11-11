"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import type { MarketSignalsBoardData } from "@/lib/market-signals-view";

type BoardEvent = MarketSignalsBoardData["events"][number];
type BoardSignal = MarketSignalsBoardData["signals"]["signals"][number];
type Ticker = MarketSignalsBoardData["tickers"][number];
type Direction = "up" | "down" | "squeeze";
type DirectionFilter = "all" | Direction | "watch";
type WindowKey = "1h" | "4h" | "24h";

const WATCHLIST_KEY = "market-alert-watchlist";
const WINDOW_MS: Record<WindowKey, number> = { "1h": 3_600_000, "4h": 4 * 3_600_000, "24h": 24 * 3_600_000 };
const HOLD_MS = 24 * 3_600_000;
const WATCH_SHOW_MS = 12 * 3_600_000;
const SIGNALS_STALE_MS = 15 * 60_000;
const REFRESH_MIN_GAP_MS = 15_000;

function directionOf(event: BoardEvent): Direction {
  if (event.type === "short_squeeze") return "squeeze";
  return event.side === "SHORT" ? "down" : "up";
}

function base(symbol: string) {
  return symbol.replace(/USDT$/, "");
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

const DIRECTION_DOT: Record<Direction, string> = {
  up: "bg-success rounded-full",
  down: "bg-danger rounded-full",
  squeeze: "bg-warning rounded-[2px]",
};

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

function PullbackCard({ signal, ticker, nowMs }: { signal: BoardSignal; ticker: Ticker | undefined; nowMs: number }) {
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
        <span className="font-mono text-sm font-bold text-foreground">{base(signal.symbol)}</span>
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

function WatchRow({ signal, nowMs }: { signal: BoardSignal; nowMs: number }) {
  const funding = num(signal.detail, "funding");
  return (
    <li className="px-3 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate font-mono font-semibold text-foreground">{base(signal.symbol)}</span>
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

type CoinRow = {
  symbol: string;
  events: BoardEvent[];
  latest: BoardEvent;
  ticker: Ticker | undefined;
  pullback: BoardSignal | undefined;
};

function rowTag(row: CoinRow, btcWarning: boolean, maxPre24hPct: number) {
  if (row.pullback && !row.pullback.outcome) return { label: "回调买点", className: "bg-success-soft text-success" };
  const direction = directionOf(row.latest);
  if (direction === "squeeze") return { label: "轧空 · 高波动", className: "bg-warning-soft text-warning" };
  if (direction === "up") {
    return (row.ticker?.pct24h ?? 0) >= maxPre24hPct
      ? { label: "暴涨 · 不追", className: "bg-workspace-canvas text-muted" }
      : { label: "暴涨 · 等回调", className: "bg-accent-soft text-accent" };
  }
  return btcWarning
    ? { label: "暴跌 · 别追空", className: "bg-warning-soft text-warning" }
    : { label: "暴跌", className: "bg-danger-soft text-danger" };
}

function Lane({ events, startMs, endMs }: { events: BoardEvent[]; startMs: number; endMs: number }) {
  const span = Math.max(1, endMs - startMs);
  return (
    <div className="relative h-4 w-full min-w-24 border-l border-line bg-[linear-gradient(90deg,transparent_calc(100%-1px),var(--workspace-line-strong)_0)] bg-[length:25%_100%]">
      {events.map((event) => {
        const left = Math.min(100, Math.max(0, ((Date.parse(event.occurredAt) - startMs) / span) * 100));
        const size = event.level >= 2 ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
        return (
          <i
            key={event.id}
            title={`${clock(event.occurredAt)} ${event.stage} L${event.level}`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${size} ${DIRECTION_DOT[directionOf(event)]}`}
            style={{ left: `${left}%` }}
          />
        );
      })}
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[7rem_6rem_minmax(0,1fr)] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_5rem_4.5rem_8rem_minmax(8rem,1.6fr)]";

function CoinRowView({ row, tag, expanded, onToggle, starred, onStar, startMs, endMs }: {
  row: CoinRow;
  tag: { label: string; className: string };
  expanded: boolean;
  onToggle: () => void;
  starred: boolean;
  onStar: () => void;
  startMs: number;
  endMs: number;
}) {
  const chartUrl = row.events.find((event) => event.chartUrl)?.chartUrl ?? null;
  return (
    <li id={`coin-${row.symbol}`} className="border-b border-line/80 last:border-b-0">
      <div className={`${ROW_GRID} px-3 py-2`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" aria-label={starred ? `取消自选 ${base(row.symbol)}` : `加入自选 ${base(row.symbol)}`} aria-pressed={starred} onClick={onStar} className="shrink-0 text-muted hover:text-warning">
            <Star aria-hidden className={`h-3.5 w-3.5 ${starred ? "fill-warning text-warning" : ""}`} />
          </button>
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 items-center gap-1 text-left">
            <span className="truncate font-mono text-sm font-bold text-foreground">{base(row.symbol)}</span>
            <span className="hidden text-[10px] text-muted sm:inline">{row.events.length}次</span>
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        <span className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${tag.className}`}>{tag.label}</span>
        <span className="hidden text-right font-mono text-xs text-foreground sm:block">{price(row.ticker?.price)}</span>
        <span className={`hidden text-right font-mono text-xs sm:block ${tone(row.ticker?.pct24h)}`}>{pct(row.ticker?.pct24h)}</span>
        <span className="hidden truncate text-right font-mono text-[11px] text-muted sm:block">
          {money(row.latest.marketCapUsd ?? row.ticker?.marketCapUsd)} / {money(row.latest.fdvUsd ?? row.ticker?.fdvUsd)}
        </span>
        <Lane events={row.events} startMs={startMs} endMs={endMs} />
      </div>
      {expanded ? (
        <div className="grid gap-3 border-t border-line bg-workspace-canvas/60 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ol className="space-y-1 text-xs">
            {row.events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <i className={`inline-block h-1.5 w-1.5 shrink-0 ${DIRECTION_DOT[directionOf(event)]}`} />
                  <span className="font-mono text-muted">{clock(event.occurredAt)}</span>
                  <span className="truncate text-foreground">{event.trigger} · L{event.level}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  <span className={tone(directionOf(event) === "down" ? -Math.abs(event.changePct ?? 0) : event.changePct)}>{pct(event.changePct)}</span>
                  {event.volumeRatio ? ` · 量比 ${event.volumeRatio.toFixed(1)}x` : ""}
                  {` · ${price(event.price)}`}
                </span>
              </li>
            ))}
          </ol>
          {chartUrl ? (
            <Image unoptimized src={chartUrl} alt={`${base(row.symbol)} 最近触发时的 K 线快照`} width={1200} height={630} className="h-auto w-full rounded border border-line" />
          ) : (
            <p className="self-center text-center text-xs text-muted">暂无 K 线快照</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function MarketSignalsBoard({ initialData }: { initialData: MarketSignalsBoardData }) {
  const [data, setData] = useState(initialData);
  const [nowMs, setNowMs] = useState(() => Date.parse(initialData.generatedAt));
  const [connection, setConnection] = useState<"live" | "retrying">("live");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/market-signals", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as MarketSignalsBoardData);
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
    const stream = new EventSource("/api/market-alerts/stream");
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
        document.getElementById(`coin-${symbol}`)?.scrollIntoView({ block: "start" });
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
  const btc24h = tickers.get("BTCUSDT")?.pct24h ?? null;
  const btcWarning = btc24h !== null && btc24h <= data.signals.rules.btcShortWarningPct;
  const pullbacks = useMemo(() => data.signals.signals.filter((signal) => signal.kind === "pullback_long"), [data.signals.signals]);
  const coils = data.signals.signals.filter((signal) => signal.kind === "coil_watch" && nowMs - Date.parse(signal.signalAt) <= WATCH_SHOW_MS);
  const volatiles = data.signals.signals.filter((signal) => signal.kind === "volatile_watch" && nowMs - Date.parse(signal.signalAt) <= WATCH_SHOW_MS);
  const activePullback = useMemo(() => {
    const map = new Map<string, BoardSignal>();
    for (const signal of pullbacks) if (!map.has(signal.symbol)) map.set(signal.symbol, signal);
    return map;
  }, [pullbacks]);

  const endMs = nowMs;
  const startMs = nowMs - WINDOW_MS[windowKey];
  const rows = useMemo(() => {
    const bySymbol = new Map<string, BoardEvent[]>();
    for (const event of data.events) {
      const t = Date.parse(event.occurredAt);
      if (t < startMs) continue;
      if (directionFilter !== "all" && directionFilter !== "watch" && directionOf(event) !== directionFilter) continue;
      if (directionFilter === "watch" && !watchlist.includes(event.symbol)) continue;
      bySymbol.set(event.symbol, [...(bySymbol.get(event.symbol) ?? []), event]);
    }
    return [...bySymbol.entries()]
      .map(([symbol, events]): CoinRow => {
        const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
        return { symbol, events: sorted, latest: sorted[0], ticker: tickers.get(symbol), pullback: activePullback.get(symbol) };
      })
      .sort((a, b) => {
        const ap = a.pullback && !a.pullback.outcome ? 1 : 0;
        const bp = b.pullback && !b.pullback.outcome ? 1 : 0;
        return bp - ap || b.latest.occurredAt.localeCompare(a.latest.occurredAt);
      });
  }, [data.events, startMs, directionFilter, watchlist, tickers, activePullback]);

  const liveWorkers = Object.values(data.health).filter((heartbeat) => getMarketAlertWorkerView(heartbeat, nowMs).online).length;
  const signalsStale = !data.signals.meta.lastSuccessAt || nowMs - Date.parse(data.signals.meta.lastSuccessAt) > SIGNALS_STALE_MS;
  const stats = data.signals.stats;
  const feed = data.events.filter((event) => Date.parse(event.occurredAt) >= startMs).slice(0, 30);

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
          <div role="group" aria-label="方向" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {([["all", "全部"], ["up", "涨"], ["down", "跌"], ["squeeze", "轧空"], ["watch", `★ ${watchlist.length}`]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={directionFilter === key} onClick={() => setDirectionFilter(key)} className={`rounded px-2.5 py-1 text-xs font-semibold ${directionFilter === key ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div role="group" aria-label="时间范围" className="flex gap-0.5 rounded-md border border-line bg-workspace-canvas p-0.5">
            {(["1h", "4h", "24h"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={windowKey === key} onClick={() => setWindowKey(key)} className={`rounded px-2.5 py-1 text-xs font-semibold ${windowKey === key ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{key}</button>
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
              {pullbacks.map((signal) => <PullbackCard key={signal.id} signal={signal} ticker={tickers.get(signal.symbol)} nowMs={nowMs} />)}
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
            <ul className="divide-y divide-line/70">{coils.map((signal) => <WatchRow key={signal.id} signal={signal} nowMs={nowMs} />)}</ul>
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
            <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">{volatiles.map((signal) => <WatchRow key={signal.id} signal={signal} nowMs={nowMs} />)}</ul>
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
        <Section title={`币种 · ${windowKey}`} hint="一行一个币，点击展开每次触发">
          <div className={`${ROW_GRID} border-b border-line bg-workspace-surface-raised px-3 py-1.5 text-[10px] font-medium text-muted`}>
            <span>币种</span>
            <span>状态</span>
            <span className="hidden text-right sm:block">价格</span>
            <span className="hidden text-right sm:block">24h</span>
            <span className="hidden text-right sm:block">流通 / FDV</span>
            <span className="flex justify-between"><span>触发轴</span><span>现在</span></span>
          </div>
          {rows.length ? (
            <ul>
              {rows.map((row) => (
                <CoinRowView
                  key={row.symbol}
                  row={row}
                  tag={rowTag(row, btcWarning, data.signals.rules.maxPre24hPct)}
                  expanded={expanded === row.symbol}
                  onToggle={() => setExpanded((current) => (current === row.symbol ? null : row.symbol))}
                  starred={watchlist.includes(row.symbol)}
                  onStar={() => toggleStar(row.symbol)}
                  startMs={startMs}
                  endMs={endMs}
                />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-10 text-center text-sm text-muted">当前筛选下没有触发</p>
          )}
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
            圆点 = 暴涨 / 暴跌，方块 = 轧空，大点 = L2 及以上。「暴涨 · 不追」= 24h 已涨超 {data.signals.rules.maxPre24hPct}%，回测中这类追涨 24h 中位回落最深。
          </p>
        </Section>

        <details open className="group min-w-0 rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm lg:sticky lg:top-[5.75rem]">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <span>最新触发</span>
            <ChevronDown aria-hidden className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <ol className="max-h-[70vh] divide-y divide-line/70 overflow-y-auto border-t border-line">
            {feed.length ? feed.map((event) => (
              <li key={event.id}>
                <button type="button" onClick={() => { setExpanded(event.symbol); document.getElementById(`coin-${event.symbol}`)?.scrollIntoView({ block: "center" }); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-workspace-surface-raised">
                  <span className="font-mono text-muted">{clock(event.occurredAt)}</span>
                  <span className="font-mono font-semibold text-foreground">{base(event.symbol)}</span>
                  <span className={directionOf(event) === "up" ? "text-success" : directionOf(event) === "down" ? "text-danger" : "text-warning"}>
                    {event.stage} · L{event.level}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted">{pct(event.changePct)}</span>
                </button>
              </li>
            )) : <li className="px-3 py-6 text-center text-xs text-muted">暂无</li>}
          </ol>
        </details>
      </div>

      <p className="text-right text-[11px] text-muted">
        规则依据与回测见 docs/market-signals.md · <Link href="/alerts/legacy" className="underline hover:text-foreground">打开旧版异动页</Link>
      </p>
    </div>
  );
}
