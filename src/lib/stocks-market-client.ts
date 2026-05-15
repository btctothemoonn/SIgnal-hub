import type {
  AlphaResearchMarket,
  AlphaResearchStock,
} from "./alpha-research-pool";
import type { StocksMarketSnapshot } from "./stocks-market-data";

export type { StocksMarketSnapshot } from "./stocks-market-data";

function providerLabel(provider: NonNullable<AlphaResearchMarket["provider"]>) {
  const labels: Record<NonNullable<AlphaResearchMarket["provider"]>, string> = {
    finnhub: "Finnhub",
    massive: "Massive",
    fmp: "FMP",
    eodhd: "EODHD",
    "alpha-vantage": "Alpha Vantage",
    naver: "Naver",
    yahoo: "Yahoo",
    mock: "Mock",
  };
  return labels[provider];
}

function freshnessLabel(freshness: NonNullable<AlphaResearchMarket["freshness"]>) {
  if (freshness === "realtime") return "实时";
  if (freshness === "delayed") return "延迟";
  return "Mock";
}

function fallbackDataQualityLabel({
  provider,
  freshness,
  fallbackUsed,
}: {
  provider: NonNullable<AlphaResearchMarket["provider"]>;
  freshness: NonNullable<AlphaResearchMarket["freshness"]>;
  fallbackUsed: boolean;
}) {
  const prefix = fallbackUsed ? `回落到 ${providerLabel(provider)}` : providerLabel(provider);
  return `${prefix} / ${freshnessLabel(freshness)}`;
}

export function mergeStocksMarketSnapshot(
  stocks: AlphaResearchStock[],
  snapshot: StocksMarketSnapshot | null,
): AlphaResearchStock[] {
  if (!snapshot) return stocks;
  return stocks.map((stock) => {
    const quote = snapshot.quotes[stock.ticker];
    if (!quote) return stock;
    const provider = quote.provider ?? snapshot.provider;
    const freshness = quote.freshness ?? snapshot.freshness ?? "mock";
    const fallbackUsed = quote.fallbackUsed ?? snapshot.fallbackUsed ?? false;
    const market: AlphaResearchMarket = {
      ...stock.market,
      lastPrice: quote.lastPrice,
      dayChangePct: quote.dayChangePct,
      prePostChangePct: quote.prePostChangePct,
      sevenDayChangePct: quote.sevenDayChangePct,
      relativeStrengthLabel: quote.relativeStrengthLabel,
      marketSession: quote.marketSession,
      source: quote.source,
      provider,
      freshness,
      fallbackUsed,
      dataQualityLabel:
        quote.dataQualityLabel ??
        fallbackDataQualityLabel({ provider, freshness, fallbackUsed }),
      providerTrace: quote.trace ?? snapshot.trace,
      updatedAt: quote.updatedAt,
      candlesSource: quote.candles3d.length > 0 ? quote.source : "mock",
    };
    return {
      ...stock,
      market,
      candles3d: quote.candles3d.length > 0 ? quote.candles3d : stock.candles3d,
    };
  });
}
