import { NextResponse } from "next/server";
import { getMarketSignalsBoardData } from "@/lib/market-signals-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getMarketSignalsBoardData(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
