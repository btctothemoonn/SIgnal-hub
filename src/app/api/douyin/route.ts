import { NextResponse } from "next/server";
import { getDouyinSnapshot } from "@/lib/douyin-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit"));
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 200)
        : undefined;
    const snapshot = await getDouyinSnapshot({ limit });
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        enabled: false,
        configured: false,
        status: "error",
        generatedAt: new Date().toISOString(),
        lastUpdatedAt: null,
        creators: [],
        videos: [],
        errors: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
