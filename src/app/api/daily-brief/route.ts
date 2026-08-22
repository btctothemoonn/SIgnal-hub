import { NextResponse } from "next/server";
import {
  getLatestDailyInvestmentBrief,
  getOrCreateDailyInvestmentBrief,
} from "@/lib/daily-investment-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getLatestDailyInvestmentBrief();
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  let force = true;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    force = body.force !== false;
  } catch {}

  const snapshot = await getOrCreateDailyInvestmentBrief({ force });
  return NextResponse.json(snapshot);
}
