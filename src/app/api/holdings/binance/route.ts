import { NextResponse } from "next/server";
import {
  BinanceConfigError,
  BinanceNetworkError,
  BinanceUpstreamError,
  resetBinanceHoldingRuntimeHints,
  saveStoredBinanceCredentials,
} from "@/lib/binance-holdings";
import {
  getCachedBinanceHoldingSnapshot,
  invalidateCachedBinanceHoldingSnapshot,
  readPersistedBinanceFuturesEquityHistory,
} from "@/lib/binance-holdings-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const snapshot = await getCachedBinanceHoldingSnapshot({ force });
    const equityHistory = await readPersistedBinanceFuturesEquityHistory();
    return NextResponse.json({ success: true, snapshot, equityHistory });
  } catch (error) {
    if (error instanceof BinanceConfigError) {
      return NextResponse.json(
        {
          success: false,
          error: "请先配置 Binance 只读 API Key。",
        },
        { status: 400 },
      );
    }

    if (error instanceof BinanceUpstreamError) {
      return NextResponse.json(
        {
          success: false,
          error: `Binance 请求失败：${error.message}`,
          upstreamStatus: error.status,
        },
        { status: 502 },
      );
    }

    if (error instanceof BinanceNetworkError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "持仓数据刷新失败。",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      apiKey?: unknown;
      apiSecret?: unknown;
    };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const apiSecret =
      typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          success: false,
          error: "API Key 和 Secret 不能为空。",
        },
        { status: 400 },
      );
    }

    await saveStoredBinanceCredentials({ apiKey, apiSecret });
    resetBinanceHoldingRuntimeHints();
    invalidateCachedBinanceHoldingSnapshot();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof BinanceConfigError) {
      return NextResponse.json(
        {
          success: false,
          error: "API Key 和 Secret 不能为空。",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "API 保存失败。",
      },
      { status: 500 },
    );
  }
}
