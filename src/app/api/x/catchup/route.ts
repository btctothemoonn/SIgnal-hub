import { NextResponse } from "next/server";
import { getXApiUsageSnapshot } from "@/lib/x-api-usage";
import {
  getXPipelineHealth,
  setXPipelineHealth,
} from "@/lib/x-pipeline-store";
import { runMonitor985ManualCatchup } from "@/lib/monitor985-catchup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_SCOPE = "manual-catchup";

function statusPayload() {
  return {
    success: true,
    running: false,
    pid: null,
    health: getXPipelineHealth(HEALTH_SCOPE),
    usage: getXApiUsageSnapshot(),
  };
}

function numberInput(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readInput(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return {
      limit: numberInput(raw.limit),
    };
  } catch {
    return {};
  }
}

export async function GET() {
  return NextResponse.json(statusPayload());
}

export async function POST(request: Request) {
  setXPipelineHealth({
    scope: HEALTH_SCOPE,
    status: "starting",
    detail: "985 最新流刷新中",
  });

  try {
    const result = await runMonitor985ManualCatchup({
      input: await readInput(request),
    });
    return NextResponse.json({
      ...statusPayload(),
      result,
    });
  } catch (error) {
    const detail = `985 最新流刷新失败：${String(error)}`;
    setXPipelineHealth({
      scope: HEALTH_SCOPE,
      status: "error",
      detail,
    });
    return NextResponse.json(
      {
        ...statusPayload(),
        success: false,
        error: detail,
      },
      { status: 500 },
    );
  }
}
