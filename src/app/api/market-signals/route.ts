import { NextResponse } from "next/server";
import { getMarketSignalsBoardData } from "@/lib/market-signals-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") ?? "crypto";
  if (market !== "crypto" && market !== "equities") {
    return NextResponse.json({ error: "Unknown market" }, { status: 400 });
  }
  return NextResponse.json(getMarketSignalsBoardData(undefined, market), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
