import type {
  StocksPerformanceConfidence,
  StocksPerformanceSnapshot,
} from "./stocks-performance-data.ts";

export const STOCKS_PERFORMANCE_COMPACT_FORMAT = "compact-v1" as const;

type CompactStocksPerformancePoint = [
  capturedAt: string,
  marketDate: string,
  price: number,
  changePct: number,
  provider: string,
  freshness: StocksPerformanceSnapshot["series"][number]["points"][number]["freshness"],
  confidence: StocksPerformanceConfidence,
];

export type CompactStocksPerformanceSnapshot = Omit<
  StocksPerformanceSnapshot,
  "series"
> & {
  format: typeof STOCKS_PERFORMANCE_COMPACT_FORMAT;
  series: Array<
    Omit<StocksPerformanceSnapshot["series"][number], "points"> & {
      points: CompactStocksPerformancePoint[];
    }
  >;
};

export function compactStocksPerformanceSnapshot(
  snapshot: StocksPerformanceSnapshot,
): CompactStocksPerformanceSnapshot {
  return {
    ...snapshot,
    format: STOCKS_PERFORMANCE_COMPACT_FORMAT,
    series: snapshot.series.map((series) => ({
      ...series,
      points: series.points.map((point) => [
        point.capturedAt,
        point.marketDate,
        point.price,
        point.changePct,
        point.provider,
        point.freshness,
        point.confidence,
      ]),
    })),
  };
}

export function expandCompactStocksPerformanceSnapshot(
  snapshot: StocksPerformanceSnapshot | CompactStocksPerformanceSnapshot,
): StocksPerformanceSnapshot {
  if (!("format" in snapshot) || snapshot.format !== STOCKS_PERFORMANCE_COMPACT_FORMAT) {
    return snapshot;
  }

  return {
    generatedAt: snapshot.generatedAt,
    marketDate: snapshot.marketDate,
    marketDates: snapshot.marketDates,
    source: snapshot.source,
    provider: snapshot.provider,
    missingTickers: snapshot.missingTickers,
    errors: snapshot.errors,
    series: snapshot.series.map((series) => ({
      ...series,
      points: series.points.map(
        ([capturedAt, marketDate, price, changePct, provider, freshness, confidence]) => ({
          ticker: series.ticker,
          capturedAt,
          marketDate,
          price,
          changePct,
          provider,
          freshness,
          confidence,
        }),
      ),
    })),
  };
}
