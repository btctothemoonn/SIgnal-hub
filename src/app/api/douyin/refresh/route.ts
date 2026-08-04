import { NextResponse } from "next/server";
import { refreshDouyinMonitor } from "@/lib/douyin-monitor";
import { loadRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const config = await loadRuntimeConfig();
    if (!config.douyinEnabled) {
      return NextResponse.json(
        { success: false, error: "抖音模块已暂停，请先打开页面顶部的总开关。" },
        { status: 409 },
      );
    }
    const snapshot = await refreshDouyinMonitor();
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
