import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import { getTelegramPipelineLatestUpdatedAt, getTelegramPipelineSnapshot } from "@/lib/telegram-pipeline-store";
import { createSnapshotEventStream } from "@/lib/snapshot-event-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const stream = createSnapshotEventStream({
    event: "telegram-snapshot",
    pollMs: 3000,
    signal: request.signal,
    getRevision: getTelegramPipelineLatestUpdatedAt,
    getSnapshot: (updatedSince) => prepareTelegramSnapshotForClient(
      getTelegramPipelineSnapshot(updatedSince ? 10_000 : undefined, undefined, { updatedSince }),
    ),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
