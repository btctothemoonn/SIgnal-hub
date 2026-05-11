import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import { getStocksCatalystSnapshot } from "@/lib/stocks-catalyst-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getStocksCatalystSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
  });
  return NextResponse.json(snapshot);
}
