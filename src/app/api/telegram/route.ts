import { NextResponse } from "next/server";
import {
  getSignalFeedRangeLimit,
  getSignalFeedRangeSince,
  normalizeSignalFeedRange,
} from "@/lib/signal-feed-range";
import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import { getTelegramPipelineSnapshot } from "@/lib/telegram-pipeline-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const range = normalizeSignalFeedRange(new URL(request.url).searchParams.get("range"));
  return NextResponse.json(
    prepareTelegramSnapshotForClient(
      getTelegramPipelineSnapshot(getSignalFeedRangeLimit(range, "telegram"), undefined, {
        since: getSignalFeedRangeSince(range),
      }),
    ),
  );
}
