import type {
  AlphaResearchCatalyst,
  AlphaResearchStock,
} from "./alpha-research-pool.ts";

export type StocksSubscriptionReport = AlphaResearchCatalyst & {
  id: string;
  tickers: string[];
};

function reportKey(catalyst: AlphaResearchCatalyst) {
  return catalyst.link || `${catalyst.title}:${catalyst.date}:${catalyst.summary}`;
}

function tickerRank(stocks: AlphaResearchStock[]) {
  return new Map(stocks.map((stock, index) => [stock.ticker, index]));
}

export function buildStocksSubscriptionReports(
  stocks: Pick<AlphaResearchStock, "ticker" | "catalysts">[],
  limit = 25,
): StocksSubscriptionReport[] {
  const rank = tickerRank(stocks as AlphaResearchStock[]);
  const reports = new Map<string, StocksSubscriptionReport>();

  for (const stock of stocks) {
    for (const catalyst of stock.catalysts) {
      if (catalyst.sourceRole !== "subscription") continue;
      const key = reportKey(catalyst);
      const current =
        reports.get(key) ??
        ({
          ...catalyst,
          id: key,
          tickers: [],
        } satisfies StocksSubscriptionReport);
      if (!current.tickers.includes(stock.ticker)) {
        current.tickers.push(stock.ticker);
      }
      reports.set(key, current);
    }
  }

  return [...reports.values()]
    .map((report) => ({
      ...report,
      tickers: [...report.tickers].sort(
        (left, right) =>
          (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
      ),
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}
