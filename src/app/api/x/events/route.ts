import { getXPipelineConfig } from "@/lib/x-pipeline-config";
import {
  getXPipelineLatestUpdatedAt,
  getXPipelineSnapshot,
} from "@/lib/x-pipeline-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  let lastUpdatedAt: string | null = null;
  let sentInitial = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendSnapshotIfChanged = () => {
        const updatedAt = getXPipelineLatestUpdatedAt();
        if (!sentInitial || (updatedAt && updatedAt !== lastUpdatedAt)) {
          sentInitial = true;
          lastUpdatedAt = updatedAt;
          controller.enqueue(
            encoder.encode(encodeEvent("x-snapshot", getXPipelineSnapshot())),
          );
          return;
        }

        controller.enqueue(
          encoder.encode(
            encodeEvent("heartbeat", { servedAt: new Date().toISOString() }),
          ),
        );
      };

      sendSnapshotIfChanged();
      timer = setInterval(
        sendSnapshotIfChanged,
        getXPipelineConfig().eventPollMs,
      );
    },
    cancel() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
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
