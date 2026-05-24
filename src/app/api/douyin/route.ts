import { NextResponse } from "next/server";
import { getDouyinSnapshot } from "@/lib/douyin-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await getDouyinSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
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
