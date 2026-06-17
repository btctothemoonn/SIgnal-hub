import { NextResponse } from "next/server";
import {
  ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
} from "@/lib/alpha-research-pool";
import { getStocksPerformanceSnapshot } from "@/lib/stocks-performance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestedTickers(url: URL) {
  const raw = url.searchParams.get("tickers");
  if (!raw) return ALPHA_RESEARCH_STOCK_UNIVERSE;
  const allowed = new Set(ALPHA_RESEARCH_STOCK_UNIVERSE);
  const tickers = raw
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => allowed.has(ticker));
  return tickers.length > 0 ? Array.from(new Set(tickers)) : ALPHA_RESEARCH_STOCK_UNIVERSE;
}

function requestedLookbackDays(url: URL) {
  const parsed = Number(url.searchParams.get("lookbackDays"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 30) : 7;
}

function requestedMaxPoints(url: URL) {
  const parsed = Number(url.searchParams.get("maxPoints"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 240) : 120;
}

function requestedStartDate(url: URL) {
  const raw = url.searchParams.get("startDate")?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : ALPHA_RESEARCH_POOL_TRACKING_START_DATE;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const marketDate = url.searchParams.get("marketDate")?.trim() || undefined;
  const snapshot = getStocksPerformanceSnapshot({
    tickers: requestedTickers(url),
    lookbackDays: requestedLookbackDays(url),
    startDate: requestedStartDate(url),
    maxPoints: requestedMaxPoints(url),
    ...(marketDate ? { marketDate } : {}),
  });
  return NextResponse.json(snapshot);
}
