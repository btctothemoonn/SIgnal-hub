import { getMarketAlertsConfig } from "@/lib/market-alerts-config";
import { getMarketAlertsRevision, getMarketAlertsSnapshot } from "@/lib/market-alerts-store";
import { createSnapshotEventStream } from "@/lib/snapshot-event-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const stream = createSnapshotEventStream({
    event: "market-alerts-snapshot",
    pollMs: getMarketAlertsConfig().eventPollMs,
    signal: request.signal,
    getRevision: () => String(getMarketAlertsRevision()),
    getSnapshot: () => getMarketAlertsSnapshot({ limit: 100 }),
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
