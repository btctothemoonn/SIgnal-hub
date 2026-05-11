import { NextResponse } from "next/server";
import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import { getTelegramPipelineSnapshot } from "@/lib/telegram-pipeline-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    prepareTelegramSnapshotForClient(getTelegramPipelineSnapshot()),
  );
}
