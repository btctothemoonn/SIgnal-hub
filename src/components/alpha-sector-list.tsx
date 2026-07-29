"use client";

import {
  ALPHA_RESEARCH_SECTORS,
  type AlphaResearchEarningsStatus,
  type AlphaResearchSector,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import type {
  StocksResearchState,
  StocksResearchStatus,
} from "@/lib/stocks-research-state";

type ResearchStatusFilter = StocksResearchStatus | "all";

type AlphaSectorListProps = {
  stocks: AlphaResearchStock[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  marketDataLoading: boolean;
  researchStates?: Record<string, StocksResearchState>;
  researchStatusFilter?: ResearchStatusFilter;
  onResearchStatusFilterChange?: (filter: ResearchStatusFilter) => void;
};

const RESEARCH_STATUS_FILTERS: Array<{
  value: ResearchStatusFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "watch", label: "观察" },
  { value: "waiting", label: "等待" },
  { value: "holding", label: "持有" },
  { value: "avoid", label: "回避" },
];

export function filterResearchPoolSectors({
  sectors,
  stocks,
  researchStates,
  researchStatusFilter,
}: {
  sectors: AlphaResearchSector[];
  stocks: AlphaResearchStock[];
  researchStates: Record<string, Pick<StocksResearchState, "status">>;
  researchStatusFilter: ResearchStatusFilter;
}) {
  return sectors.flatMap((sector) => {
    const rank = new Map(
      sector.tickers.map((ticker, index) => [ticker, index]),
    );
    const sectorStocks = stocks
      .filter((stock) => {
        if (stock.sectorId !== sector.id) return false;
        const status = researchStates[stock.ticker]?.status ?? "watch";
        return researchStatusFilter === "all" || status === researchStatusFilter;
      })
      .sort(
        (left, right) =>
          (rank.get(left.ticker) ?? 0) - (rank.get(right.ticker) ?? 0),
      );

    return sectorStocks.length > 0 ? [{ ...sector, stocks: sectorStocks }] : [];
  });
}

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

function earningsTone(status: AlphaResearchEarningsStatus) {
  if (status === "upcoming") return "bg-warning-soft text-warning";
  if (status === "recent") return "bg-success-soft text-success";
  if (status === "watch") return "bg-info-soft text-info";
  return "bg-panel text-muted";
}

export function AlphaSectorList({
  stocks,
  selectedTicker,
  onSelectTicker,
  marketDataLoading,
  researchStates = {},
  researchStatusFilter = "all",
  onResearchStatusFilterChange = () => {},
}: AlphaSectorListProps) {
  const visibleSectors = filterResearchPoolSectors({
    sectors: ALPHA_RESEARCH_SECTORS,
    stocks,
    researchStates,
    researchStatusFilter,
  });

  return (
    <aside
      data-stocks-pool
      className="min-w-0 rounded-[6px] border border-line/70 bg-panel-strong p-3 lg:sticky lg:top-[11.75rem] lg:max-h-[calc(100vh-12.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">产业链股票池</h2>
        <p className="mt-1 text-xs text-muted">
          按板块分组，组内保留固定产业链顺序。
        </p>
        <div
          className="mt-2 flex flex-wrap gap-1"
          role="group"
          aria-label="研究状态筛选"
        >
          {RESEARCH_STATUS_FILTERS.map((filter) => {
            const selected = filter.value === researchStatusFilter;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onResearchStatusFilterChange(filter.value)}
                className={[
                  "min-h-8 rounded-[6px] border px-2.5 py-1 text-xs font-semibold transition-colors",
                  selected
                    ? "border-info/45 bg-info-soft text-info"
                    : "border-line/60 bg-background/35 text-muted hover:text-foreground",
                ].join(" ")}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {visibleSectors.map((sector) => (
          <section key={sector.id}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-foreground">
                  {sector.name}
                </h3>
                <p className="mt-0.5 text-[11px] leading-4 text-muted">
                  {sector.description}
                </p>
              </div>
              <span className="shrink-0 rounded-[6px] bg-accent-soft px-2 py-1 font-mono text-[11px] font-semibold text-accent">
                {sector.themeScore}
              </span>
            </div>

            <div className="space-y-1.5">
              {sector.stocks.map((stock) => {
                const selected = stock.ticker === selectedTicker;
                const stockMarketIsLive = stock.market.source === "live";
                const stockMarketIsLoading =
                  marketDataLoading && !stockMarketIsLive;
                const stockMarketLabel = stockMarketIsLive
                  ? `${(stock.market.provider ?? "live").toUpperCase()} live`
                  : stockMarketIsLoading
                    ? "行情加载中"
                    : "未获取实时价";
                const stockPriceLabel = stockMarketIsLive
                  ? formatUsd(stock.market.lastPrice)
                  : stockMarketIsLoading
                    ? "加载中"
                    : "未获取";
                const stockFallbackLabel = stockMarketIsLoading
                  ? "加载中"
                  : "非实时";
                return (
                  <button
                    key={stock.ticker}
                    type="button"
                    onClick={() => onSelectTicker(stock.ticker)}
                    className={[
                      "grid w-full min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-1.5 rounded-[6px] border px-2 py-2 text-left transition-colors",
                      selected
                        ? "border-accent/45 bg-accent-soft"
                        : "border-line/60 bg-panel-strong/70 hover:border-line hover:bg-panel-strong",
                    ].join(" ")}
                  >
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {stock.ticker}
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-xs font-medium text-foreground"
                        title={`${stock.companyNameZh} · ${stock.companyName}`}
                      >
                        {stock.companyNameZh}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] font-medium text-muted"
                        title={stock.companyName}
                      >
                        {stock.companyName}
                      </span>
                      <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                        {stock.businessTags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-[6px] bg-background/55 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="grid justify-items-end gap-1">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {stockPriceLabel}
                      </span>
                      <span
                        className={`font-mono text-xs font-semibold ${changeTone(
                          stock.market.dayChangePct,
                        )}`}
                      >
                        {stockMarketIsLive
                          ? formatSignedPercent(stock.market.dayChangePct)
                          : "n/a"}
                      </span>
                      <span
                        className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold ${earningsTone(
                          stock.market.earningsStatus,
                        )}`}
                      >
                        {earningsLabel(stock.market.earningsStatus)}
                      </span>
                      {!stockMarketIsLive ? (
                        <span
                          className="max-w-full truncate text-[10px] font-medium text-warning"
                          title={stockMarketLabel}
                        >
                          {stockFallbackLabel}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
