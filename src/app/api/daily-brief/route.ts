import { NextResponse } from "next/server";
import {
  getDailyInvestmentBriefByDate,
  getDailyInvestmentBriefHistory,
  getLatestDailyInvestmentBrief,
  getOrCreateDailyInvestmentBrief,
} from "@/lib/daily-investment-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const dateKey = searchParams.get("date")?.trim();
  if (dateKey) {
    const snapshot = await getDailyInvestmentBriefByDate({ dateKey });
    if (!snapshot) {
      return NextResponse.json(
        { error: "没有找到该日期的简报" },
        { status: 404 },
      );
    }
    return NextResponse.json(snapshot);
  }
  if (searchParams.get("history") === "1") {
    const items = await getDailyInvestmentBriefHistory({ days: 15 });
    return NextResponse.json({ items });
  }
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
