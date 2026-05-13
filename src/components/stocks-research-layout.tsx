"use client";

import { useCallback, useRef, useState } from "react";
import { AlphaSectorList } from "@/components/alpha-sector-list";
import { AlphaStockDetail } from "@/components/alpha-stock-detail";
import { StocksPerformanceChart } from "@/components/stocks-performance-chart";
import type {
  AlphaResearchSector,
  AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import type { StocksPerformanceSnapshot } from "@/lib/stocks-performance-data";

type StocksMobilePanel = "pool" | "chart" | "detail";

type StocksResearchLayoutProps = {
  performanceSnapshot: StocksPerformanceSnapshot | null;
  stocks: AlphaResearchStock[];
  selectedStock: AlphaResearchStock | null;
  selectedTicker: string;
  performanceTickers: string[];
  sectors: AlphaResearchSector[];
  activeSectorId: string;
  onSelectSector: (sectorId: string) => void;
  onSelectTicker: (ticker: string) => void;
  marketDataLabel: string;
  marketDataLoading: boolean;
  performanceLoading: boolean;
};

const mobilePanels: Array<{ id: StocksMobilePanel; label: string }> = [
  { id: "pool", label: "股票池" },
  { id: "chart", label: "走势" },
  { id: "detail", label: "详情" },
];

function mobilePanelIndex(panel: StocksMobilePanel) {
  return mobilePanels.findIndex((item) => item.id === panel);
}

function clampPanelIndex(index: number) {
  return Math.min(mobilePanels.length - 1, Math.max(0, index));
}

export function StocksResearchLayout({
  performanceSnapshot,
  stocks,
  selectedStock,
  selectedTicker,
  performanceTickers,
  sectors,
  activeSectorId,
  onSelectSector,
  onSelectTicker,
  marketDataLabel,
  marketDataLoading,
  performanceLoading,
}: StocksResearchLayoutProps) {
  const mobileScrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeMobilePanel, setActiveMobilePanel] =
    useState<StocksMobilePanel>("pool");

  const showMobilePanel = useCallback((panel: StocksMobilePanel) => {
    setActiveMobilePanel(panel);
    const scroller = mobileScrollerRef.current;
    if (!scroller) return;

    scroller.scrollTo({
      left: scroller.clientWidth * mobilePanelIndex(panel),
      behavior: "smooth",
    });
  }, []);

  const handleMobileScroll = useCallback(() => {
    const scroller = mobileScrollerRef.current;
    if (!scroller || scroller.clientWidth <= 0) return;

    const index = clampPanelIndex(
      Math.round(scroller.scrollLeft / scroller.clientWidth),
    );
    const nextPanel = mobilePanels[index]?.id ?? "pool";
    setActiveMobilePanel((current) =>
      current === nextPanel ? current : nextPanel,
    );
  }, []);

  const chart = (
    <StocksPerformanceChart
      snapshot={performanceSnapshot}
      stocks={stocks}
      tickers={performanceTickers}
      sectors={sectors}
      activeSectorId={activeSectorId}
      onSelectSector={onSelectSector}
      loading={performanceLoading}
      compact
    />
  );
  const pool = (
    <AlphaSectorList
      stocks={stocks}
      selectedTicker={selectedTicker}
      onSelectTicker={onSelectTicker}
      marketDataLoading={marketDataLoading}
    />
  );
  const detail = (
    <AlphaStockDetail
      stock={selectedStock}
      marketDataLabel={marketDataLabel}
      marketDataLoading={marketDataLoading}
    />
  );

  return (
    <>
      <section
        data-stocks-desktop-layout
        className="hidden min-h-0 gap-3 lg:grid lg:grid-cols-[minmax(17rem,0.38fr)_minmax(0,1.62fr)] lg:items-start xl:gap-4 2xl:grid-cols-[minmax(18rem,0.34fr)_minmax(0,1.66fr)]"
      >
        <div className="min-w-0">{pool}</div>
        <div className="grid min-w-0 gap-3 xl:gap-4">
          {chart}
          {detail}
        </div>
      </section>

      <section data-mobile-stocks-pager className="min-w-0 lg:hidden">
        <div className="mb-3 rounded-lg border border-line/70 bg-panel-strong/95 p-1 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.7)]">
          <div className="grid grid-cols-3 gap-1">
            {mobilePanels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                aria-pressed={activeMobilePanel === panel.id}
                onClick={() => showMobilePanel(panel.id)}
                className={[
                  "h-9 rounded-md text-sm font-semibold transition-colors",
                  activeMobilePanel === panel.id
                    ? "bg-foreground text-background shadow-[0_14px_30px_-25px_rgba(38,31,27,0.8)]"
                    : "text-muted hover:bg-panel hover:text-foreground",
                ].join(" ")}
              >
                {panel.label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={mobileScrollerRef}
          onScroll={handleMobileScroll}
          className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="w-full shrink-0 snap-start">{pool}</div>
          <div className="w-full shrink-0 snap-start pl-3">{chart}</div>
          <div className="w-full shrink-0 snap-start pl-3">{detail}</div>
        </div>
      </section>
    </>
  );
}
