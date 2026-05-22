import { NextResponse } from "next/server";
import {
  getTrackedHoldingSnapshot,
  TrackedHoldingUpstreamError,
} from "@/lib/tracked-holdings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profile") || "alex";
    const snapshot = await getTrackedHoldingSnapshot({ profileId });
    return NextResponse.json({ success: true, snapshot });
  } catch (error) {
    if (error instanceof TrackedHoldingUpstreamError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          upstreamStatus: error.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "跟踪账户数据刷新失败。",
      },
      { status: 500 },
    );
  }
}
