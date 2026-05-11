"use client";

import type { ReactNode } from "react";
import {
  getAlphaResearchSectorById,
  type AlphaCatalystType,
  type AlphaResearchCandle,
  type AlphaResearchEarningsStatus,
  type AlphaResearchSession,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";

type AlphaStockDetailProps = {
  stock: AlphaResearchStock | null;
  marketDataLabel: string;
  marketDataLoading: boolean;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function earningsLabel(status: AlphaResearchEarningsStatus) {
  const labels: Record<AlphaResearchEarningsStatus, string> = {
    recent: "已披露",
    upcoming: "临近",
    watch: "观察",
    quiet: "平静",
  };
  return labels[status];
}

function sessionLabel(session: AlphaResearchSession) {
  const labels: Record<AlphaResearchSession, string> = {
    "pre-market": "盘前",
    regular: "盘中",
    "after-hours": "盘后",
  };
  return labels[session];
}

function catalystLabel(type: AlphaCatalystType) {
  const labels: Record<AlphaCatalystType, string> = {
    earnings: "财报",
    product: "产品",
    "supply-chain": "供应链",
    analyst: "机构",
    macro: "宏观",
    regulatory: "监管",
    "industry-event": "行业事件",
  };
  return labels[type];
}

function impactLabel(impact: "positive" | "neutral" | "negative") {
  const labels = {
    positive: "正向",
    neutral: "中性",
    negative: "负向",
  };
  return labels[impact];
}

function providerTraceLabel(
  trace: AlphaResearchStock["market"]["providerTrace"],
) {
  if (!trace?.length) return "";
  return trace
    .map((item) => {
      const status =
        item.status === "success"
          ? "成功"
          : item.status === "failed"
            ? "失败"
            : "跳过";
      return `${item.provider}: ${status}`;
    })
    .join(" / ");
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-normal text-muted">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <p key={item} className="break-words text-sm leading-6 text-foreground">
          {item}
        </p>
      ))}
    </div>
  );
}

function CandlestickChart({
  candles,
  marketDataIsLive,
  marketDataLabel,
}: {
  candles: AlphaResearchCandle[];
  marketDataIsLive: boolean;
  marketDataLabel: string;
}) {
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const range = Math.max(0.01, maxPrice - minPrice);

  const yFor = (price: number) => 24 + ((maxPrice - price) / range) * 84;
  const xFor = (index: number) => 58 + index * 122;

  return (
    <Section title="近 3 日 K 线">
      <div className="rounded-md border border-line/60 bg-background/35 px-3 py-4">
        {!marketDataIsLive ? (
          <p className="mb-2 rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-warning">
            K 线为本地基线，未获取实时行情。{marketDataLabel}
          </p>
        ) : null}
        <svg
          viewBox="0 0 360 150"
          className="h-[13rem] w-full"
          role="img"
          aria-label="近 3 日 K 线图"
        >
          <line x1="24" x2="338" y1="24" y2="24" className="stroke-line" />
          <line x1="24" x2="338" y1="66" y2="66" className="stroke-line" />
          <line x1="24" x2="338" y1="108" y2="108" className="stroke-line" />
          <text x="28" y="18" className="fill-muted text-[10px]">
            {maxPrice.toFixed(2)}
          </text>
          <text x="28" y="124" className="fill-muted text-[10px]">
            {minPrice.toFixed(2)}
          </text>
          {candles.map((candle, index) => {
            const x = xFor(index);
            const openY = yFor(candle.open);
            const closeY = yFor(candle.close);
            const highY = yFor(candle.high);
            const lowY = yFor(candle.low);
            const rising = candle.close >= candle.open;
            const color = rising ? "var(--success)" : "var(--danger)";
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(3, Math.abs(closeY - openY));

            return (
              <g key={candle.date}>
                <line
                  x1={x}
                  x2={x}
                  y1={highY}
                  y2={lowY}
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <rect
                  x={x - 14}
                  y={bodyY}
                  width="28"
                  height={bodyHeight}
                  rx="3"
                  fill={rising ? "var(--success-soft)" : "var(--danger-soft)"}
                  stroke={color}
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y="134"
                  textAnchor="middle"
                  className="fill-muted text-[11px]"
                >
                  {candle.date}
                </text>
                <text
                  x={x}
                  y="148"
                  textAnchor="middle"
                  className="fill-muted text-[10px]"
                >
                  {candle.volumeLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Section>
  );
}

export function AlphaStockDetail({
  stock,
  marketDataLabel,
  marketDataLoading,
}: AlphaStockDetailProps) {
  if (!stock) {
    return (
      <article className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
        <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
          暂无可展示 ticker
        </div>
      </article>
    );
  }

  const sector = getAlphaResearchSectorById(stock.sectorId);
  const stockMarketIsLive = stock.market.source === "live";
  const stockMarketIsLoading = marketDataLoading && !stockMarketIsLive;
  const stockCandlesAreLive =
    stock.market.source === "live" && stock.market.candlesSource === "live";
  const stockPrePostIsLive =
    stock.market.source === "live" && stock.market.prePostAvailable === true;
  const stockProviderTraceLabel = providerTraceLabel(stock.market.providerTrace);
  const stockMarketLabel = stockMarketIsLive
    ? (stock.market.dataQualityLabel ??
      `${(stock.market.provider ?? "live").toUpperCase()} live`)
    : stockMarketIsLoading
      ? "行情加载中"
      : "未获取实时价";
  const stockPrePostLabel = stockMarketIsLive
    ? "盘前/盘后未获取"
    : marketDataLabel;
  const stockPriceLabel = stockMarketIsLive
    ? formatUsd(stock.market.lastPrice)
    : stockMarketIsLoading
      ? "行情加载中"
      : "未获取实时价";

  return (
    <article className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex flex-col gap-4 border-b border-line/60 pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-2xl font-semibold text-foreground">
              {stock.ticker}
            </h2>
            <span
              className={[
                "rounded-md px-2 py-1 font-mono text-sm font-semibold",
                stockMarketIsLive
                  ? "bg-success-soft text-success"
                  : "bg-warning-soft text-warning",
              ].join(" ")}
            >
              {stockPriceLabel}
            </span>
            <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
              {sector?.name ?? stock.sectorId}
            </span>
            <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
              Priority {stock.priority}
            </span>
            <span
              className={[
                "rounded-md border px-2 py-1 text-xs font-semibold",
                stockMarketIsLive
                  ? "border-success/30 bg-success-soft text-success"
                  : "border-warning/30 bg-warning-soft text-warning",
              ].join(" ")}
              title={stockProviderTraceLabel || stockMarketLabel}
            >
              {stockMarketLabel}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">
            {stock.companyName}
          </p>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-muted">
            {stock.summary}
          </p>
          {stockMarketIsLive ? (
            <p className="mt-2 max-w-5xl text-xs leading-5 text-muted">
              数据链路：{stock.market.dataQualityLabel ?? stockMarketLabel}
              {stockProviderTraceLabel ? ` · ${stockProviderTraceLabel}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stock.businessTags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] font-medium text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            {stockMarketIsLive ? "当前价 / 当日" : "基线价 / 非实时"}
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.dayChangePct,
            )}`}
          >
            {stockMarketIsLive
              ? formatSignedPercent(stock.market.dayChangePct)
              : "n/a"}
          </p>
          <p className="mt-1 text-sm text-muted">
            Last {stockPriceLabel}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            盘前 / 盘后
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.prePostChangePct,
            )}`}
          >
            {stockPrePostIsLive
              ? formatSignedPercent(stock.market.prePostChangePct)
              : "n/a"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {stockPrePostIsLive
              ? sessionLabel(stock.market.marketSession)
              : stockPrePostLabel}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            最近 7 日
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.sevenDayChangePct,
            )}`}
          >
            {stockCandlesAreLive
              ? formatSignedPercent(stock.market.sevenDayChangePct)
              : "n/a"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {stockCandlesAreLive ? stock.market.relativeStrengthLabel : "K 线未获取"}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">财报</p>
          <p className="mt-2 text-lg font-semibold text-warning">
            {earningsLabel(stock.market.earningsStatus)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {stock.financialSnapshot.nextEarningsDate}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <CandlestickChart
          candles={stock.candles3d}
          marketDataIsLive={stockCandlesAreLive}
          marketDataLabel={stockMarketLabel}
        />
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.12fr)_minmax(26rem,0.88fr)]">
        <div className="space-y-5">
          <Section title="催化事件 / 新闻驱动">
            <div className="space-y-3">
              {stock.catalysts.map((catalyst) => (
                <article
                  key={`${catalyst.date}-${catalyst.title}`}
                  className="rounded-lg border border-line/60 bg-panel px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">
                      {catalystLabel(catalyst.type)}
                    </span>
                    <span className="text-[11px] text-muted">
                      {catalyst.date}
                    </span>
                    <span className="text-[11px] text-muted">
                      {impactLabel(catalyst.impact)}
                    </span>
                    {catalyst.source ? (
                      <span className="text-[11px] text-muted">
                        {catalyst.source}
                        {catalyst.author ? ` · ${catalyst.author}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <h4 className="mt-2 text-base font-semibold leading-6 text-foreground">
                    {catalyst.link ? (
                      <a
                        href={catalyst.link}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent"
                      >
                        {catalyst.title}
                      </a>
                    ) : (
                      catalyst.title
                    )}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {catalyst.summary}
                  </p>
                </article>
              ))}
            </div>
          </Section>

          <Section title="财报解读">
            <BulletList items={stock.financialReadthrough} />
          </Section>

          <Section title="研究要点">
            <BulletList items={stock.thesis} />
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="财报速览">
            <div className="grid gap-2 text-sm">
              {[
                ["营收", stock.financialSnapshot.revenue],
                ["营收同比", stock.financialSnapshot.revenueYoY],
                ["EPS", stock.financialSnapshot.eps],
                ["毛利率", stock.financialSnapshot.grossMargin],
                ["自由现金流", stock.financialSnapshot.freeCashFlow],
                ["指引", stock.financialSnapshot.guidance],
                ...(stock.financialSnapshot.periodLabel
                  ? [["期间", stock.financialSnapshot.periodLabel]]
                  : []),
                ...(stock.financialSnapshot.source
                  ? [
                      [
                        "来源",
                        stock.financialSnapshot.source === "live"
                          ? "Yahoo"
                          : "Mock",
                      ],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-2 rounded-md bg-background/45 px-3 py-2"
                >
                  <span className="text-muted">{label}</span>
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="观察点">
            <BulletList items={stock.watchPoints} />
          </Section>

          <Section title="风险">
            <div className="space-y-2">
              {stock.risks.map((risk) => (
                <p key={risk} className="text-sm leading-6 text-warning">
                  {risk}
                </p>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </article>
  );
}
