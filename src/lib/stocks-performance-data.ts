import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  StocksMarketFreshness,
  StocksMarketSnapshot,
} from "./stocks-market-data.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;

export type StocksPerformanceConfidence =
  | "high"
  | "medium"
  | "low"
  | "conflict";

export type StocksPerformancePoint = {
  ticker: string;
  capturedAt: string;
  marketDate: string;
  price: number;
  changePct: number;
  provider: string;
  freshness: StocksMarketFreshness;
  confidence: StocksPerformanceConfidence;
};

export type StocksPerformanceSeries = {
  ticker: string;
  provider: string;
  confidence: StocksPerformanceConfidence;
  latestPrice: number;
  latestChangePct: number;
  points: StocksPerformancePoint[];
};

export type StocksPerformanceSnapshot = {
  generatedAt: string;
  marketDate: string;
  marketDates: string[];
  source: "local-cache" | "empty";
  provider: "local-cache";
  series: StocksPerformanceSeries[];
  missingTickers: string[];
  errors: string[];
};

type StockQuoteSnapshotRow = {
  ticker: string;
  market_date: string;
  captured_at: string;
  price: number;
  provider: string;
  freshness: StocksMarketFreshness;
  confidence: StocksPerformanceConfidence;
};

type MarketDateRow = {
  market_date: string;
};

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function percentChange(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  return roundPercent(((current - previous) / previous) * 100);
}

function normalizeMaxPoints(value: number | undefined) {
  const parsed = Math.floor(Number(value ?? 120));
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(2, Math.min(240, parsed));
}

function downsamplePoints<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;

  const lastIndex = points.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;

  for (let index = 0; index < maxPoints; index += 1) {
    const pointIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    if (pointIndex !== previousIndex) {
      sampled.push(points[pointIndex]);
      previousIndex = pointIndex;
    }
  }

  return sampled;
}

function datePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function marketDateInNewYork(value = new Date().toISOString()) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return [
    datePart(parts, "year"),
    datePart(parts, "month"),
    datePart(parts, "day"),
  ].join("-");
}

export function stocksPerformanceDbPath(env: EnvLike = process.env) {
  return (
    env.STOCKS_PERFORMANCE_DB?.trim() ||
    getRuntimeDataPath(env, "stocks-data.sqlite")
  );
}

function openStocksPerformanceDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_quote_snapshots (
      ticker TEXT NOT NULL,
      market_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      price REAL NOT NULL,
      provider TEXT NOT NULL,
      freshness TEXT NOT NULL,
      confidence TEXT NOT NULL,
      PRIMARY KEY (ticker, captured_at)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_quote_snapshots_date_ticker
      ON stock_quote_snapshots (market_date, ticker, captured_at);
  `);
  return db;
}

function quoteConfidence({
  source,
  fallbackUsed,
  freshness,
}: {
  source: string;
  fallbackUsed: boolean;
  freshness: StocksMarketFreshness;
}): StocksPerformanceConfidence {
  if (source !== "live") return "low";
  if (fallbackUsed || freshness === "delayed") return "medium";
  if (freshness === "mock") return "low";
  return "high";
}

function queryPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function latestCachedMarketDate({
  db,
  tickers,
  marketDate,
}: {
  db: DatabaseSync;
  tickers: string[];
  marketDate: string;
}) {
  if (tickers.length === 0) return null;
  const placeholders = queryPlaceholders(tickers.length);
  const current = db
    .prepare(
      `SELECT market_date
       FROM stock_quote_snapshots
       WHERE ticker IN (${placeholders}) AND market_date = ?
       LIMIT 1`,
    )
    .get(...tickers, marketDate) as MarketDateRow | undefined;
  if (current?.market_date) return current.market_date;

  const latestBeforeOrSame = db
    .prepare(
      `SELECT market_date
       FROM stock_quote_snapshots
       WHERE ticker IN (${placeholders}) AND market_date <= ?
       GROUP BY market_date
       ORDER BY market_date DESC
       LIMIT 1`,
    )
    .get(...tickers, marketDate) as MarketDateRow | undefined;
  if (latestBeforeOrSame?.market_date) return latestBeforeOrSame.market_date;

  const latestAny = db
    .prepare(
      `SELECT market_date
       FROM stock_quote_snapshots
       WHERE ticker IN (${placeholders})
       GROUP BY market_date
       ORDER BY market_date DESC
       LIMIT 1`,
    )
    .get(...tickers) as MarketDateRow | undefined;
  return latestAny?.market_date ?? null;
}

function recentCachedMarketDates({
  db,
  tickers,
  marketDate,
  limit,
}: {
  db: DatabaseSync;
  tickers: string[];
  marketDate: string;
  limit: number;
}) {
  if (tickers.length === 0) return [];
  const placeholders = queryPlaceholders(tickers.length);
  const rows = db
    .prepare(
      `SELECT market_date
       FROM stock_quote_snapshots
       WHERE ticker IN (${placeholders}) AND market_date <= ?
       GROUP BY market_date
       ORDER BY market_date DESC
       LIMIT ?`,
    )
    .all(...tickers, marketDate, limit) as MarketDateRow[];
  if (rows.length > 0) {
    return rows.map((row) => row.market_date).reverse();
  }

  return (
    db
      .prepare(
        `SELECT market_date
         FROM stock_quote_snapshots
         WHERE ticker IN (${placeholders})
         GROUP BY market_date
         ORDER BY market_date DESC
         LIMIT ?`,
      )
      .all(...tickers, limit) as MarketDateRow[]
  )
    .map((row) => row.market_date)
    .reverse();
}

function formatMarketDateLabel(marketDates: string[], fallback: string) {
  if (marketDates.length === 0) return fallback;
  const first = marketDates[0];
  const last = marketDates[marketDates.length - 1];
  return first === last ? first : `${first} → ${last}`;
}

export function recordStocksPerformanceSnapshot({
  snapshot,
  env = process.env,
  dbPath = stocksPerformanceDbPath(env),
}: {
  snapshot: StocksMarketSnapshot;
  env?: EnvLike;
  dbPath?: string;
}) {
  if (snapshot.source !== "live") return { recorded: 0 };

  const db = openStocksPerformanceDb(dbPath);
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO stock_quote_snapshots (
        ticker,
        market_date,
        captured_at,
        price,
        provider,
        freshness,
        confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let recorded = 0;
    for (const quote of Object.values(snapshot.quotes)) {
      if (quote.source !== "live") continue;
      const price = numberValue(quote.lastPrice);
      if (price === null || price <= 0) continue;
      const capturedAt = quote.updatedAt || snapshot.generatedAt;
      const provider = quote.provider ?? snapshot.provider;
      const freshness = quote.freshness ?? snapshot.freshness;
      insert.run(
        quote.ticker,
        marketDateInNewYork(capturedAt),
        capturedAt,
        price,
        provider,
        freshness,
        quoteConfidence({
          source: quote.source,
          fallbackUsed: quote.fallbackUsed ?? snapshot.fallbackUsed,
          freshness,
        }),
      );
      recorded += 1;
    }
    return { recorded };
  } finally {
    db.close();
  }
}

export function getStocksPerformanceSnapshot({
  tickers,
  marketDate = marketDateInNewYork(),
  lookbackDays = 1,
  maxPoints,
  env = process.env,
  dbPath = stocksPerformanceDbPath(env),
}: {
  tickers: string[];
  marketDate?: string;
  lookbackDays?: number;
  maxPoints?: number;
  env?: EnvLike;
  dbPath?: string;
}): StocksPerformanceSnapshot {
  const normalizedTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  const db = openStocksPerformanceDb(dbPath);
  try {
    const requestedLookbackDays = Math.max(
      1,
      Math.min(30, Math.floor(lookbackDays)),
    );
    const resolvedMarketDates =
      requestedLookbackDays > 1
        ? recentCachedMarketDates({
            db,
            tickers: normalizedTickers,
            marketDate,
            limit: requestedLookbackDays,
          })
        : [];
    const resolvedMarketDate =
      resolvedMarketDates[resolvedMarketDates.length - 1] ??
      latestCachedMarketDate({
        db,
        tickers: normalizedTickers,
        marketDate,
      }) ??
      marketDate;
    const marketDates =
      resolvedMarketDates.length > 0 ? resolvedMarketDates : [resolvedMarketDate];
    const errors =
      resolvedMarketDate === marketDate
        ? []
        : [
            `No performance cache for ${marketDate}; using latest cached market date ${resolvedMarketDate}.`,
          ];
    const select = db.prepare(`
      SELECT ticker, market_date, captured_at, price, provider, freshness, confidence
      FROM stock_quote_snapshots
      WHERE ticker = ? AND market_date IN (${queryPlaceholders(marketDates.length)})
      ORDER BY captured_at ASC
    `);
    const series: StocksPerformanceSeries[] = [];
    const missingTickers: string[] = [];
    const normalizedMaxPoints = normalizeMaxPoints(maxPoints);

    for (const ticker of normalizedTickers) {
      const rows = select.all(ticker, ...marketDates) as StockQuoteSnapshotRow[];
      const anchor = rows[0]?.price;
      if (!anchor) {
        missingTickers.push(ticker);
        continue;
      }
      const points = rows.map((row) => ({
        ticker,
        capturedAt: row.captured_at,
        marketDate: row.market_date,
        price: row.price,
        changePct: percentChange(row.price, anchor),
        provider: row.provider,
        freshness: row.freshness,
        confidence: row.confidence,
      }));
      const sampledPoints = downsamplePoints(points, normalizedMaxPoints);
      const latest = sampledPoints[sampledPoints.length - 1];
      if (!latest) {
        missingTickers.push(ticker);
        continue;
      }
      series.push({
        ticker,
        provider: latest.provider,
        confidence: latest.confidence,
        latestPrice: latest.price,
        latestChangePct: latest.changePct,
        points: sampledPoints,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      marketDate: formatMarketDateLabel(marketDates, resolvedMarketDate),
      marketDates,
      source: series.length > 0 ? "local-cache" : "empty",
      provider: "local-cache",
      series,
      missingTickers,
      errors,
    };
  } finally {
    db.close();
  }
}
