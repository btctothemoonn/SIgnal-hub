import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import { recordStocksPerformanceSnapshot } from "@/lib/stocks-performance-data";
import {
  getCachedStocksMarketSnapshot,
  resolveStocksMarketProvider,
} from "@/lib/stocks-prewarm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("refresh") === "1" || params.get("force") === "1";
  const provider = resolveStocksMarketProvider(process.env);
  const snapshot = await getCachedStocksMarketSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
    force,
    ...(provider ? { provider } : {}),
  });
  try {
    recordStocksPerformanceSnapshot({ snapshot });
  } catch {
    // Performance chart cache is best-effort; quote delivery should stay available.
  }
  return NextResponse.json(snapshot);
}
