import { NextResponse } from "next/server.js";
import {
  BINANCE_HYNIX_PREMIUM_DEFAULT_START_TIME_MS,
  fetchBinanceHynixPremiumSnapshot,
  type BinanceHynixPremiumInterval,
} from "../../../lib/binance-hynix-premium.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestedLimit(url: URL) {
  const parsed = Number(url.searchParams.get("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1500) : 1500;
}

function requestedInterval(url: URL): BinanceHynixPremiumInterval {
  const interval = url.searchParams.get("interval");
  return interval === "1m" ||
    interval === "5m" ||
    interval === "1h" ||
    interval === "1d"
    ? interval
    : "1m";
}

function requestedTimestamp(url: URL, key: string, fallback?: number) {
  const parsed = Number(url.searchParams.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = await fetchBinanceHynixPremiumSnapshot({
    interval: requestedInterval(url),
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
