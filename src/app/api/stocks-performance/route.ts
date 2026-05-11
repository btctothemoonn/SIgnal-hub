import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCK_UNIVERSE } from "@/lib/alpha-research-pool";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const marketDate = url.searchParams.get("marketDate")?.trim() || undefined;
  const snapshot = getStocksPerformanceSnapshot({
    tickers: requestedTickers(url),
    ...(marketDate ? { marketDate } : {}),
  });
  return NextResponse.json(snapshot);
}
