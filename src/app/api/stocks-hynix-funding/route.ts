import { NextResponse } from "next/server.js";
import {
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  fetchBinanceHynixFundingSnapshot,
} from "../../../lib/binance-hynix-premium.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestedLimit(url: URL) {
  const parsed = Number(url.searchParams.get("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1500) : 1000;
}

function requestedTimestamp(url: URL, key: string, fallback?: number) {
  const parsed = Number(url.searchParams.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = await fetchBinanceHynixFundingSnapshot({
    startTime: requestedTimestamp(
      url,
      "startTime",
      BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
    ),
    endTime: requestedTimestamp(url, "endTime"),
    limit: requestedLimit(url),
  });
  return NextResponse.json(snapshot);
}
