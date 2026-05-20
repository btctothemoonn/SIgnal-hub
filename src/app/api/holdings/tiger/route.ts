import { NextResponse } from "next/server";
import {
  TigerConfigError,
  TigerSdkError,
  TigerUpstreamError,
} from "@/lib/tiger-holdings";
import {
  getCachedTigerHoldingData,
  invalidateCachedTigerHoldingData,
  readPersistedTigerEquityHistory,
} from "@/lib/tiger-holdings-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const data = await getCachedTigerHoldingData({ force });
    const equityHistory = await readPersistedTigerEquityHistory();
    return NextResponse.json({
      success: true,
      snapshot: data.snapshot,
      equityHistory: equityHistory.length ? equityHistory : data.equityHistory,
    });
  } catch (error) {
    if (error instanceof TigerConfigError) {
      return NextResponse.json(
        {
          success: false,
          error: "请先配置 Tiger OpenAPI 只读配置文件。",
        },
        { status: 400 },
      );
    }

    if (error instanceof TigerSdkError) {
      return NextResponse.json(
        {
          success: false,
          error: "Tiger OpenAPI SDK 未安装或不可用。",
        },
        { status: 500 },
      );
    }

    if (error instanceof TigerUpstreamError) {
      return NextResponse.json(
        {
          success: false,
          error: `Tiger OpenAPI 请求失败：${error.message}`,
          upstreamStatus: error.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Tiger 持仓数据刷新失败。",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  invalidateCachedTigerHoldingData();
  return NextResponse.json({ success: true });
}
