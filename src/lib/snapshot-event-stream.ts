type StreamRegistry = { closers: Set<() => void>; listening: boolean };
const globalRegistry = globalThis as typeof globalThis & { signalHubStreams?: StreamRegistry };
const registry = globalRegistry.signalHubStreams ??= { closers: new Set(), listening: false };

export function closeSnapshotEventStreams() {
  for (const close of registry.closers) close();
}

if (!registry.listening) {
  registry.listening = true;
  process.on("SIGTERM", closeSnapshotEventStreams);
  process.on("SIGINT", closeSnapshotEventStreams);
}

export function createSnapshotEventStream({
  event, pollMs, signal, getRevision, getSnapshot,
}: {
  event: string;
  pollMs: number;
  signal?: AbortSignal;
  getRevision: () => string | null;
  getSnapshot: (updatedSince: string | null) => unknown;
}) {
  const encoder = new TextEncoder();
  let dispose = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor: string | null = null;
      let initial = true;
      let closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => {
        if (timer) clearInterval(timer);
        registry.closers.delete(close);
        signal?.removeEventListener("abort", close);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };
      dispose = () => { closed = true; cleanup(); };
      const poll = () => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) { close(); return; }
        try {
          const revision = getRevision();
          const changed = initial || revision !== cursor;
          const payload = changed ? getSnapshot(cursor) : { servedAt: new Date().toISOString() };
          controller.enqueue(encoder.encode(`event: ${changed ? event : "heartbeat"}\ndata: ${JSON.stringify(payload)}\n\n`));
          // Capture the revision before querying so concurrent writes are replayed next poll.
          if (changed) { cursor = revision; initial = false; }
        } catch (error) {
          dispose();
          controller.error(error);
        }
      };
      registry.closers.add(close);
      signal?.addEventListener("abort", close, { once: true });
      if (signal?.aborted) { close(); return; }
      poll();
      if (!closed) timer = setInterval(poll, pollMs);
    },
    cancel() { dispose(); },
  });
}
