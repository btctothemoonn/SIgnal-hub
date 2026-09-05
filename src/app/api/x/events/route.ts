import { getXPipelineConfig } from "@/lib/x-pipeline-config";
import { getXPipelineLatestUpdatedAt, getXPipelineSnapshot } from "@/lib/x-pipeline-store";
import { createSnapshotEventStream } from "@/lib/snapshot-event-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const stream = createSnapshotEventStream({
    event: "x-snapshot",
    pollMs: getXPipelineConfig().eventPollMs,
    signal: request.signal,
    getRevision: getXPipelineLatestUpdatedAt,
    getSnapshot: (updatedSince) => getXPipelineSnapshot(
      updatedSince ? 10_000 : undefined, undefined, { updatedSince },
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
