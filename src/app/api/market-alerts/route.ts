import { NextResponse } from "next/server";
import { getMarketAlertsSnapshot } from "@/lib/market-alerts-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedType = searchParams.get("type");
    const type =
      requestedType === "volatility" || requestedType === "short_squeeze"
        ? requestedType
        : null;
    const levelValue = Number(searchParams.get("level"));
    const snapshot = getMarketAlertsSnapshot({
      type,
      symbol: searchParams.get("symbol"),
      level: Number.isInteger(levelValue) && levelValue > 0 ? levelValue : null,
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      page: positiveInteger(searchParams.get("page"), 1, 10_000),
      limit: positiveInteger(searchParams.get("limit"), 100, 200),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
