import { NextResponse } from "next/server";
import { getOpportunitySnapshot } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST() {
  try {
    return NextResponse.json(
      getOpportunitySnapshot({ market: "all", sort: "score", status: "active", limit: 10 }),
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to refresh opportunities", success: false },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
