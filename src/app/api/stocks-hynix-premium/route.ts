import { NextResponse } from "next/server";
import { fetchBinanceHynixPremiumSnapshot } from "@/lib/binance-hynix-premium";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestedLimit(url: URL) {
  const parsed = Number(url.searchParams.get("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 288) : 144;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = await fetchBinanceHynixPremiumSnapshot({
    limit: requestedLimit(url),
  });
  return NextResponse.json(snapshot);
}
