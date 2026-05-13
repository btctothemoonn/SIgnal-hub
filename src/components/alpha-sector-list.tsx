"use client";

import {
  ALPHA_RESEARCH_SECTORS,
  type AlphaResearchEarningsStatus,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";

type AlphaSectorListProps = {
  stocks: AlphaResearchStock[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
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
}: AlphaSectorListProps) {
  const stocksForSector = (sectorId: string) => {
    const sector = ALPHA_RESEARCH_SECTORS.find((item) => item.id === sectorId);
    const rank = new Map(
      (sector?.tickers ?? []).map((ticker, index) => [ticker, index]),
    );
    return stocks
      .filter((stock) => stock.sectorId === sectorId)
      .sort(
        (left, right) =>
          (rank.get(left.ticker) ?? 0) - (rank.get(right.ticker) ?? 0),
      );
  };

  return (
    <aside className="rounded-lg border border-line/70 bg-panel-strong p-3 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)] lg:sticky lg:top-[11.75rem] lg:max-h-[calc(100vh-12.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">产业链股票池</h2>
        <p className="mt-1 text-xs text-muted">
          按板块分组，组内保留固定产业链顺序。
        </p>
      </div>

      <div className="space-y-4">
        {ALPHA_RESEARCH_SECTORS.map((sector) => (
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
              <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 font-mono text-[11px] font-semibold text-accent">
                {sector.themeScore}
              </span>
            </div>

            <div className="space-y-1.5">
              {stocksForSector(sector.id).map((stock) => {
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
                      "grid w-full grid-cols-[3.75rem_minmax(8rem,1fr)_5.25rem] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                      selected
                        ? "border-accent/45 bg-accent-soft shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
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
                            className="rounded bg-background/55 px-1.5 py-0.5 text-[10px] font-medium text-muted"
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
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${earningsTone(
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
