import { getMarketAlertsConfig } from "@/lib/market-alerts-config";
import {
  getMarketAlertsLatestUpdatedAt,
  getMarketAlertsSnapshot,
} from "@/lib/market-alerts-store";

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
        const updatedAt = getMarketAlertsLatestUpdatedAt();
        if (!sentInitial || (updatedAt && updatedAt !== lastUpdatedAt)) {
          sentInitial = true;
          lastUpdatedAt = updatedAt;
          controller.enqueue(
            encoder.encode(
              encodeEvent(
                "market-alerts-snapshot",
                getMarketAlertsSnapshot({ limit: 100 }),
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
      timer = setInterval(sendSnapshotIfChanged, getMarketAlertsConfig().eventPollMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = null;
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
