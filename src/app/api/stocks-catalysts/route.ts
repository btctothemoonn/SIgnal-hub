import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import { getCachedStocksCatalystSnapshot } from "@/lib/stocks-prewarm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("refresh") === "1" || params.get("force") === "1";
  const snapshot = await getCachedStocksCatalystSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
    force,
  });
  return NextResponse.json(snapshot);
}
