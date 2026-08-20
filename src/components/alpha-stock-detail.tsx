"use client";

import type { ReactNode } from "react";
import {
  getAlphaResearchSectorById,
  type AlphaResearchEarningsStatus,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import { buildStocksIntelligence } from "@/lib/stocks-intelligence";
import { StocksEarningsBrief } from "@/components/stocks-earnings-brief";

type AlphaStockDetailProps = {
  stock: AlphaResearchStock | null;
  marketDataLabel: string;
  marketDataLoading: boolean;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
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

function compactTrackingPoints(stock: AlphaResearchStock) {
  return [...new Set([...stock.watchPoints, ...stock.risks])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-line/60 bg-panel-strong/80 p-4">
      <h3 className="text-[13px] font-semibold text-muted">{title}</h3>
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

function MetricTile({
  label,
  value,
  note,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-line/60 bg-background/35 p-3">
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <p
        className={`mt-2 min-w-0 break-words font-mono text-xl font-semibold ${tone}`}
      >
        {value}
      </p>
      <p className="mt-1 min-w-0 break-words text-xs leading-5 text-muted">
        {note}
      </p>
    </div>
  );
}

export function AlphaStockDetail({
  stock,
  marketDataLabel,
  marketDataLoading,
}: AlphaStockDetailProps) {
  if (!stock) {
    return (
      <article className="rounded-md border border-line/70 bg-panel-strong p-5">
        <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
          暂无可展示 ticker
        </div>
      </article>
    );
  }

  const sector = getAlphaResearchSectorById(stock.sectorId);
  const { tickerContext } = buildStocksIntelligence(stock);
  const stockMarketIsLive = stock.market.source === "live";
  const stockMarketIsLoading = marketDataLoading && !stockMarketIsLive;
  const stockCandlesAreLive =
    stock.market.source === "live" && stock.market.candlesSource === "live";
  const stockPriceLabel = stockMarketIsLoading
    ? "行情加载中"
    : tickerContext.price.value;
  const dayChangeLabel = stockMarketIsLive
    ? formatSignedPercent(stock.market.dayChangePct)
    : marketDataLabel;
  const strengthLabel = stockCandlesAreLive
    ? formatSignedPercent(stock.market.sevenDayChangePct)
    : "K 线待补";
  const strengthNote = stockCandlesAreLive
    ? stock.market.relativeStrengthLabel
    : "暂无可用 7 日走势";
  const businessTags = stock.businessTags.slice(0, 3);
  const trackingPoints = compactTrackingPoints(stock);

  return (
    <article className="rounded-md border border-line/70 bg-panel-strong p-5">
      <div
        data-stock-primary-context
        className="grid gap-5 border-b border-line/60 pb-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-start"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <h2 className="font-mono text-2xl font-semibold text-foreground">
              {stock.ticker}
            </h2>
            <span className="text-lg font-semibold text-foreground">
              {stock.companyNameZh}
            </span>
            <span className="pb-0.5 text-xs font-medium text-muted">
              {stock.companyName}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
              {sector?.name ?? stock.sectorId}
            </span>
            <span className="rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-warning">
              财报{earningsLabel(stock.market.earningsStatus)}
            </span>
            {businessTags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] font-medium text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <MetricTile
            label="价格 / 今日"
            value={stockPriceLabel}
            note={dayChangeLabel}
            tone={
              stockMarketIsLive
                ? changeTone(stock.market.dayChangePct)
                : "text-muted"
            }
          />
          <MetricTile
            label="7 日强弱"
            value={strengthLabel}
            note={strengthNote}
            tone={
              stockCandlesAreLive
                ? changeTone(stock.market.sevenDayChangePct)
                : "text-muted"
            }
          />
          <MetricTile
            label="财报窗口"
            value={earningsLabel(stock.market.earningsStatus)}
            note={stock.financialSnapshot.nextEarningsDate || "n/a"}
            tone="text-warning"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)]">
        <div className="space-y-5">
          <StocksEarningsBrief
            items={stock.financialSnapshot.calendarYearEarnings ?? []}
            insight={stock.financialSnapshot.earningsInsight ?? null}
            updatedAt={stock.financialSnapshot.updatedAt}
            source={stock.financialSnapshot.source}
          />

          <Section title="研究结论">
            <p className="text-sm leading-6 text-foreground">
              {stock.summary}
            </p>
            <div className="mt-3 border-t border-line/60 pt-3">
              <BulletList items={stock.thesis.slice(0, 2)} />
            </div>
          </Section>
        </div>

        <Section title="跟踪要点">
          <BulletList items={trackingPoints} />
        </Section>
      </div>
    </article>
  );
}
