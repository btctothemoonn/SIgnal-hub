import { NextResponse } from "next/server";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";
import { getStocksFinancialSnapshot } from "@/lib/stocks-financial-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configuredProvider =
    process.env.STOCKS_FINANCIAL_DATA_PROVIDER?.trim().toLowerCase();
  const provider =
    configuredProvider === "mock" ||
    configuredProvider === "yahoo" ||
    configuredProvider === "alpha-vantage" ||
    configuredProvider === "fmp"
      ? configuredProvider
      : undefined;
  const snapshot = await getStocksFinancialSnapshot({
    stocks: ALPHA_RESEARCH_STOCKS,
    ...(provider ? { provider } : {}),
  });
  return NextResponse.json(snapshot);
}
