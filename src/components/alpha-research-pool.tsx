"use client";

import { AlphaSectorList } from "@/components/alpha-sector-list";
import { AlphaStockDetail } from "@/components/alpha-stock-detail";
import type { AlphaResearchStock } from "@/lib/alpha-research-pool";

type AlphaResearchPoolProps = {
  stocks: AlphaResearchStock[];
  selectedStock: AlphaResearchStock | null;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  marketDataLabel: string;
  marketDataLoading: boolean;
};

export function AlphaResearchPool({
  stocks,
  selectedStock,
  selectedTicker,
  onSelectTicker,
  marketDataLabel,
  marketDataLoading,
}: AlphaResearchPoolProps) {
  return (
    <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(17rem,0.55fr)_minmax(0,1.45fr)] 2xl:grid-cols-[minmax(18rem,0.5fr)_minmax(0,1.5fr)]">
      <AlphaSectorList
        stocks={stocks}
        selectedTicker={selectedTicker}
        onSelectTicker={onSelectTicker}
        marketDataLoading={marketDataLoading}
      />
      <AlphaStockDetail
        stock={selectedStock}
        marketDataLabel={marketDataLabel}
        marketDataLoading={marketDataLoading}
      />
    </section>
  );
}
