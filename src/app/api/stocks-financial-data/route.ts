import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import {
  getCachedStocksFinancialSnapshot,
  resolveStocksFinancialProvider,
} from "@/lib/stocks-prewarm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("refresh") === "1" || params.get("force") === "1";
  const provider = resolveStocksFinancialProvider(process.env);
  const snapshot = await getCachedStocksFinancialSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
    force,
    ...(provider ? { provider } : {}),
  });
  return NextResponse.json(snapshot);
}
