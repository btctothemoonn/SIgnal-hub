import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import {
  getTelegramPipelineLatestUpdatedAt,
  getTelegramPipelineSnapshot,
} from "@/lib/telegram-pipeline-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  let lastUpdatedAt: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendSnapshotIfChanged = () => {
        const updatedAt = getTelegramPipelineLatestUpdatedAt();
        if (updatedAt && updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = updatedAt;
          controller.enqueue(
            encoder.encode(
              encodeEvent(
                "telegram-snapshot",
                prepareTelegramSnapshotForClient(getTelegramPipelineSnapshot()),
              ),
            ),
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
      timer = setInterval(sendSnapshotIfChanged, 3000);
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
    },
  });
}
