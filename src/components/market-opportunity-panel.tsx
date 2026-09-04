"use client";

import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Crosshair,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState, type UIEvent } from "react";
import type { getMarketAlertsSnapshot } from "@/lib/market-alerts-store";

type MarketAlertsSnapshot = ReturnType<typeof getMarketAlertsSnapshot>;
type MarketOpportunity = MarketAlertsSnapshot["opportunities"][number];

type MarketOpportunityPanelProps = {
  opportunities: MarketAlertsSnapshot["opportunities"];
  meta: MarketAlertsSnapshot["opportunityMeta"];
  heartbeat: MarketAlertsSnapshot["health"]["opportunity"];
  nowMs: number;
};

function tokenSymbol(symbol: string) {
  return symbol.replace(/USDT$/i, "") || symbol;
}

function signedPercent(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function ratio(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}x`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function directionTone(item: MarketOpportunity) {
  if (item.decision === "禁止追单") {
    return {
      border: "border-warning/35",
      soft: "bg-warning-soft text-warning",
      text: "text-warning",
    };
  }
  if (item.direction === "SHORT") {
    return {
      border: "border-danger/35",
      soft: "bg-danger-soft text-danger",
      text: "text-danger",
    };
  }
  return {
    border: "border-success/30",
    soft: "bg-success-soft text-success",
    text: "text-success",
  };
}

function leadingMetrics(item: MarketOpportunity) {
  if (item.model === "distribution_short") {
    return [
      ["15m", signedPercent(item.metrics.pct15m)],
      ["距高点", signedPercent(item.metrics.distanceFromHighPct)],
      ["OI 15m", signedPercent(item.metrics.oiGrowth15m)],
      ["主动买卖", ratio(item.metrics.takerBuySellRatio)],
    ] as const;
  }
  if (item.model === "short_squeeze") {
    return [
      ["15m", signedPercent(item.metrics.pct15m)],
      ["OI 15m", signedPercent(item.metrics.oiGrowth15m)],
      ["资金费率", signedPercent(
        item.metrics.funding === null ? null : item.metrics.funding * 100,
        3,
      )],
      ["多空比", ratio(item.metrics.globalLongShortRatio)],
    ] as const;
  }
  return [
    ["5m", signedPercent(item.metrics.pct5m)],
    ["15m", signedPercent(item.metrics.pct15m)],
    ["量比", ratio(item.metrics.volumeRatio5m)],
    ["OI 15m", signedPercent(item.metrics.oiGrowth15m)],
  ] as const;
}

function BulletList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "success" | "danger";
}) {
  const dot = tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <div className="min-w-0">
      <h4 className="text-[11px] font-semibold text-muted">{title}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {items.length ? items.slice(0, 4).map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-foreground/90">
            <span aria-hidden className={`mt-2 h-1 w-1 shrink-0 rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        )) : (
          <li className="text-xs leading-5 text-muted">暂无</li>
        )}
      </ul>
    </div>
  );
}

function OpportunityDetail({
  item,
  aiError,
  mobile = false,
}: {
  item: MarketOpportunity;
  aiError: string | null;
  mobile?: boolean;
}) {
  const tone = directionTone(item);
  const metrics = leadingMetrics(item);
  return (
    <article
      data-opportunity-detail={!mobile ? item.symbol : undefined}
      className={`${mobile ? "min-h-[31rem]" : ""} rounded-md border ${tone.border} bg-workspace-surface-raised p-3 sm:p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-foreground">{item.symbol}</span>
            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${tone.soft}`}>
              {item.stage}
            </span>
          </div>
          <div className={`mt-1.5 flex items-center gap-1.5 text-sm font-semibold ${tone.text}`}>
            {item.direction === "SHORT" ? (
              <TrendingDown aria-hidden className="h-4 w-4" />
            ) : (
              <TrendingUp aria-hidden className="h-4 w-4" />
            )}
            {item.decision}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl font-bold text-foreground">{item.score}</div>
          <div className="text-[10px] text-muted">置信 {item.confidence} · 覆盖 {item.dataCoverage}%</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-workspace-surface px-2.5 py-2">
            <div className="text-[10px] text-muted">{label}</div>
            <div className="mt-0.5 truncate font-mono text-xs font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      <div className={`mt-4 grid gap-4 ${mobile ? "sm:grid-cols-2" : "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(15rem,1.2fr)]"}`}>
        <div className="space-y-4">
          <BulletList title="规则依据" items={item.evidence} tone="success" />
          <BulletList title="等待确认" items={item.confirmations} />
        </div>
        <div className="space-y-4">
          <BulletList title="失效条件" items={item.invalidations} tone="danger" />
          <BulletList title="主要风险" items={item.risks} tone="danger" />
        </div>

        <div className={`${mobile ? "border-t pt-3 sm:col-span-2" : "border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"} border-line`}>
          <div className="flex items-center gap-2">
            <BrainCircuit aria-hidden className="h-4 w-4 text-accent" />
            <h4 className="text-xs font-semibold text-foreground">AI 解释</h4>
            {item.ai ? (
              <span className="text-[10px] text-muted">缓存结果</span>
            ) : null}
          </div>
          {item.ai ? (
            <div className="mt-2 space-y-2 text-xs leading-5">
              <p className="font-medium text-foreground">{item.ai.summary}</p>
              <p className="text-muted">{item.ai.rationale}</p>
              <div className="grid gap-1 text-[11px] text-muted">
                <span><strong className="text-foreground/80">确认：</strong>{item.ai.confirmation}</span>
                <span><strong className="text-foreground/80">失效：</strong>{item.ai.invalidation}</span>
                <span><strong className="text-foreground/80">风险：</strong>{item.ai.risk}</span>
                <span><strong className="text-foreground/80">有效期：</strong>{item.ai.validFor}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-dashed border-line bg-workspace-surface px-3 py-2.5 text-xs text-muted">
              <strong className="text-foreground/80">AI 解释暂不可用</strong>
              {aiError ? "，当前仍按规则结果展示。" : "，正在等待缓存生成。"}
            </div>
          )}
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[10px] text-muted">
        <span>观测 {formatTime(item.observedAt)}</span>
        <span>有效至 {formatTime(item.expiresAt)}</span>
      </footer>
    </article>
  );
}

function CompactItems({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "success" | "danger";
}) {
  const titleTone = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className="min-w-0">
      <h4 className={`text-[10px] font-semibold ${titleTone}`}>{title}</h4>
      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-foreground/85">
        {items.length ? items.slice(0, 4).join("；") : "暂无"}
      </p>
    </div>
  );
}

function OpportunityDesktopDetail({
  item,
  aiError,
}: {
  item: MarketOpportunity;
  aiError: string | null;
}) {
  const tone = directionTone(item);
  const metrics = leadingMetrics(item);
  return (
    <article
      data-opportunity-detail={item.symbol}
      className={`rounded-md border ${tone.border} bg-workspace-surface-raised px-3 py-2.5`}
    >
      <div className="grid items-center gap-3 xl:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <strong className="truncate font-mono text-base text-foreground">{item.symbol}</strong>
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${tone.soft}`}>{item.stage}</span>
            </div>
            <div className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
              {item.direction === "SHORT" ? <TrendingDown aria-hidden className="h-3.5 w-3.5" /> : <TrendingUp aria-hidden className="h-3.5 w-3.5" />}
              {item.decision}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <strong className="block font-mono text-xl text-foreground">{item.score}</strong>
            <span className="text-[9px] text-muted">置信 {item.confidence}% · 覆盖 {item.dataCoverage}%</span>
          </div>
        </div>

        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-line bg-line">
          {metrics.map(([label, value]) => (
            <div key={label} className="min-w-0 bg-workspace-surface px-2 py-1.5">
              <dt className="truncate text-[9px] text-muted">{label}</dt>
              <dd className="mt-0.5 truncate font-mono text-[11px] font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-2.5 grid gap-3 border-t border-line pt-2.5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(15rem,1.2fr)]">
        <div className="grid content-start gap-2.5">
          <CompactItems title="规则依据" items={item.evidence} tone="success" />
          <CompactItems title="等待确认" items={item.confirmations} />
        </div>
        <div className="grid content-start gap-2.5">
          <CompactItems title="失效条件" items={item.invalidations} tone="danger" />
          <CompactItems title="主要风险" items={item.risks} tone="danger" />
        </div>
        <div className="min-w-0 border-l border-line pl-3">
          <div className="flex items-center gap-2">
            <BrainCircuit aria-hidden className="h-3.5 w-3.5 text-accent" />
            <h4 className="text-[10px] font-semibold text-foreground">AI 解释</h4>
            {item.ai ? <span className="text-[9px] text-muted">缓存结果</span> : null}
          </div>
          {item.ai ? (
            <div className="mt-1.5 text-[11px] leading-5">
              <p className="line-clamp-2 font-medium text-foreground">{item.ai.summary}</p>
              <p className="mt-1 line-clamp-2 text-muted">{item.ai.rationale}</p>
              <p className="mt-1 truncate text-[10px] text-muted">有效期：{item.ai.validFor}</p>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] leading-5 text-muted">
              <strong className="text-foreground/80">AI 解释暂不可用</strong>
              {aiError ? "，按规则结果展示。" : "，等待缓存生成。"}
            </p>
          )}
        </div>
      </div>

      <details data-opportunity-full-detail={item.symbol} className="mt-2 border-t border-line pt-2 text-xs">
        <summary className="cursor-pointer select-none font-medium text-muted hover:text-foreground">
          展开完整判断依据
        </summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <BulletList title="规则依据" items={item.evidence} tone="success" />
            <BulletList title="等待确认" items={item.confirmations} />
          </div>
          <div className="space-y-4">
            <BulletList title="失效条件" items={item.invalidations} tone="danger" />
            <BulletList title="主要风险" items={item.risks} tone="danger" />
          </div>
          <div className="border-l border-line pl-4">
            <h4 className="font-semibold text-foreground">AI 完整解释</h4>
            {item.ai ? (
              <div className="mt-2 grid gap-1.5 leading-5 text-muted">
                <p className="font-medium text-foreground">{item.ai.summary}</p>
                <p>{item.ai.rationale}</p>
                <span><strong className="text-foreground/80">确认：</strong>{item.ai.confirmation}</span>
                <span><strong className="text-foreground/80">失效：</strong>{item.ai.invalidation}</span>
                <span><strong className="text-foreground/80">风险：</strong>{item.ai.risk}</span>
                <span><strong className="text-foreground/80">有效期：</strong>{item.ai.validFor}</span>
              </div>
            ) : (
              <p className="mt-2 text-muted">暂无 AI 完整解释，当前按规则结果展示。</p>
            )}
          </div>
        </div>
      </details>

      <footer className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-1.5 text-[9px] text-muted">
        <span>观测 {formatTime(item.observedAt)}</span>
        <span>有效至 {formatTime(item.expiresAt)}</span>
      </footer>
    </article>
  );
}

export function MarketOpportunityPanel({
  opportunities,
  meta,
  heartbeat,
  nowMs,
}: MarketOpportunityPanelProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(
    opportunities[0]?.symbol ?? null,
  );
  const [mobileIndex, setMobileIndex] = useState(0);
  const effectiveSelectedSymbol =
    selectedSymbol && opportunities.some((item) => item.symbol === selectedSymbol)
      ? selectedSymbol
      : opportunities[0]?.symbol ?? null;
  const selected = useMemo(
    () => opportunities.find((item) => item.symbol === effectiveSelectedSymbol) ?? null,
    [effectiveSelectedSymbol, opportunities],
  );
  const visibleMobileIndex = Math.min(mobileIndex, Math.max(0, opportunities.length - 1));
  const heartbeatAt = Date.parse(heartbeat?.updatedAt ?? "");
  const heartbeatStale =
    heartbeat?.status === "error" ||
    (opportunities.length > 0 &&
      (!Number.isFinite(heartbeatAt) || nowMs - heartbeatAt > 3 * 60_000));
  const stale = meta.stale || heartbeatStale;

  const handleMobileScroll = (event: UIEvent<HTMLDivElement>) => {
    const width = event.currentTarget.clientWidth;
    if (!width) return;
    const next = Math.round(event.currentTarget.scrollLeft / width);
    setMobileIndex(Math.max(0, Math.min(opportunities.length - 1, next)));
  };

  return (
    <section className="overflow-hidden rounded-lg border border-workspace-line-strong bg-workspace-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft text-accent">
            <Crosshair aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">做单决策 · Top 5</h2>
              {stale ? (
                <span aria-live="polite" className="inline-flex items-center gap-1 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                  <ShieldAlert aria-hidden className="h-3 w-3" />
                  数据可能已过期
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">12h 内 · 规则确认优先</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{opportunities.length} 个候选</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock3 aria-hidden className="h-3.5 w-3.5" />
            {formatTime(meta.lastSuccessAt ?? meta.lastScanAt)}
          </span>
        </div>
      </header>

      {!opportunities.length ? (
        <div className="flex min-h-56 items-center justify-center px-5 py-12 text-center">
          <div>
            <CheckCircle2 aria-hidden className="mx-auto h-7 w-7 text-muted" />
            <p className="mt-3 text-sm font-semibold text-foreground">暂无满足条件的短线机会</p>
            <p className="mt-1 text-xs text-muted">系统继续扫描，不会为了凑满 5 个而降低标准。</p>
          </div>
        </div>
      ) : (
        <>
          <div className="hidden p-3 lg:block">
            <div data-opportunity-strip={true} className="grid grid-cols-5 gap-2">
              {opportunities.map((item, index) => {
                const active = item.symbol === selected?.symbol;
                const tone = directionTone(item);
                const firstMetric = leadingMetrics(item)[0];
                return (
                  <button
                    key={item.symbol}
                    type="button"
                    data-opportunity-selector={item.symbol}
                    aria-pressed={active}
                    onClick={() => setSelectedSymbol(item.symbol)}
                    className={`min-h-[5.5rem] min-w-0 rounded-md border px-2.5 py-2 text-left transition-colors ${active ? `${tone.border} bg-workspace-surface-raised shadow-sm` : "border-line bg-workspace-canvas hover:border-workspace-line-strong hover:bg-workspace-surface-raised"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-mono text-[10px] font-semibold text-muted">#{index + 1}</span>
                        <strong className="mt-0.5 block truncate font-mono text-sm text-foreground">{tokenSymbol(item.symbol)}</strong>
                      </span>
                      <strong className="shrink-0 font-mono text-xl text-foreground">{item.score}</strong>
                    </span>
                    <span className={`mt-1.5 block truncate text-xs font-semibold ${tone.text}`}>
                      {item.decision}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted">{firstMetric[0]} {firstMetric[1]} · {item.confidence}%</span>
                  </button>
                );
              })}
            </div>
            {selected ? (
              <div className="mt-2">
                <OpportunityDesktopDetail item={selected} aiError={meta.aiError} />
              </div>
            ) : null}
          </div>

          <div className="lg:hidden">
            <div
              onScroll={handleMobileScroll}
              role="region"
              aria-label="做单决策 Top 5，可左右滑动切换"
              tabIndex={0}
              className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth"
            >
              {opportunities.map((item) => (
                <div
                  key={item.symbol}
                  data-opportunity-card={true}
                  className="min-w-full snap-start p-3"
                >
                  <OpportunityDetail item={item} aiError={meta.aiError} mobile />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span className="font-mono font-semibold text-foreground">{visibleMobileIndex + 1} / {opportunities.length}</span>
              <span>{opportunities[visibleMobileIndex]?.symbol}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
