import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import { getStocksMarketSnapshot } from "@/lib/stocks-market-data";
import { recordStocksPerformanceSnapshot } from "@/lib/stocks-performance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configuredProvider =
    process.env.STOCKS_MARKET_DATA_PROVIDER?.trim().toLowerCase();
  const provider =
    configuredProvider === "mock" ||
    configuredProvider === "finnhub" ||
    configuredProvider === "massive" ||
    configuredProvider === "yahoo" ||
    configuredProvider === "alpha-vantage" ||
    configuredProvider === "fmp"
      ? configuredProvider
      : undefined;
  const snapshot = await getStocksMarketSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
    ...(provider ? { provider } : {}),
  });
  try {
    recordStocksPerformanceSnapshot({ snapshot });
  } catch {
    // Performance chart cache is best-effort; quote delivery should stay available.
  }
  return NextResponse.json(snapshot);
}
