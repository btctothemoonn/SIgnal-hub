import { NextResponse } from "next/server";
import {
  BinanceConfigError,
  BinanceNetworkError,
  BinanceUpstreamError,
  getBinanceConfig,
  resolveBinanceConfig,
  resetBinanceHoldingRuntimeHints,
  saveStoredBinanceCredentials,
} from "@/lib/binance-holdings";
import {
  getCachedBinanceHoldingSnapshot,
  invalidateCachedBinanceHoldingSnapshot,
  readPersistedBinanceFuturesEquityHistory,
} from "@/lib/binance-holdings-cache";
import {
  attachBinancePositionPeakTrackings,
  clearPersistedBinancePositionPeakTrackings,
  getCachedBinancePositionPeakTrackings,
} from "@/lib/binance-position-drawdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let credentialUpdates: Promise<void> = Promise.resolve();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const snapshot = await getCachedBinanceHoldingSnapshot({ force });
    const [equityHistory, peakTrackings] = await Promise.all([
      readPersistedBinanceFuturesEquityHistory(),
      getCachedBinancePositionPeakTrackings(snapshot, { force }).catch(
        () => [],
      ),
    ]);
    return NextResponse.json({
      success: true,
      snapshot: attachBinancePositionPeakTrackings(snapshot, peakTrackings),
      equityHistory,
    });
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

    const update = credentialUpdates.then(async () => {
      const previousConfig = await getBinanceConfig().catch((error) => {
        if (error instanceof BinanceConfigError) return null;
        throw error;
      });
      const currentConfig = resolveBinanceConfig({
        storedCredentials: { apiKey, apiSecret },
      });
      if (previousConfig?.apiKey !== currentConfig.apiKey) {
        await invalidateCachedBinanceHoldingSnapshot(async () => {
          await clearPersistedBinancePositionPeakTrackings();
          await saveStoredBinanceCredentials({ apiKey, apiSecret });
          resetBinanceHoldingRuntimeHints();
        });
      } else {
        await saveStoredBinanceCredentials({ apiKey, apiSecret });
        resetBinanceHoldingRuntimeHints();
      }
    });
    credentialUpdates = update.catch(() => undefined);
    await update;
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
