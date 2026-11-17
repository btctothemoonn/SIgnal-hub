import { getEqnNewsStore } from "../../../../lib/eqn-news-store.ts";
import { createSnapshotEventStream } from "../../../../lib/snapshot-event-stream.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const store = getEqnNewsStore();
    const stream = createSnapshotEventStream({ event: "message", pollMs: 1000, signal: request.signal,
      getRevision: () => `${store.revision()}:${Math.floor(Date.now() / 30000)}`,
      getSnapshot: () => ({ type: "update", status: store.status() }),
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch { return Response.json({ error: "News stream unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
