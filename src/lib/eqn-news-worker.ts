import { EQN_CHANNELS, normalizeEqnNews } from "./eqn-news-core.ts";
import { createEqnClient, fillEqnChannelGap, eqnWait } from "./eqn-news-client.ts";
import type { EqnClient } from "./eqn-news-client.ts";
import { eqnNewsEnabled, openEqnNewsStore } from "./eqn-news-store.ts";
import type { NewsWorkerStatus } from "./news-terminal-types.ts";

type Store = ReturnType<typeof openEqnNewsStore>;
type Socket = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener" | "removeEventListener">;
type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};
export function eqnReconnectDelay(attempt: number, code = 1006, random = Math.random) {
  const base = code === 1008 || code === 1013 ? 30000 : Math.min(30000, 1000 * 2 ** Math.min(5, attempt));
  return Math.min(30000, base + Math.floor(random() * 500));
}
export function startEqnNewsSocket(options: {
  store: Store; signal?: AbortSignal; onReconnect?: () => void; onState?: (connected: boolean, error: string | null) => void;
  createSocket?: () => Socket; timers?: Timers; now?: () => number; random?: () => number;
}) {
  const timers = options.timers ?? defaultTimers;
  const now = options.now ?? Date.now;
  let socket: Socket | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: unknown;
  let beat: unknown;
  let handshake: unknown;
  let lastPong = 0;
  let detach = () => {};
  const clearConnection = () => { if (beat !== undefined) timers.clearInterval(beat); if (handshake !== undefined) timers.clearTimeout(handshake); beat = handshake = undefined; };
  const schedule = (code: number) => {
    clearConnection(); detach();
    if (stopped) return;
    options.onState?.(false, `News socket disconnected (${code}); MCP polling active`);
    retry = timers.setTimeout(connect, eqnReconnectDelay(attempt++, code, options.random));
  };
  function connect() {
    retry = undefined;
    if (stopped) return;
    try { socket = options.createSocket?.() ?? new WebSocket("wss://api.eqn.news/public/ws"); }
    catch { schedule(1006); return; }
    const current = socket;
    const onOpen = () => {
      if (handshake !== undefined) timers.clearTimeout(handshake);
      handshake = undefined;
      lastPong = now();
      options.onState?.(true, null);
      options.onReconnect?.();
      beat = timers.setInterval(() => {
        if (current.readyState !== 1 || now() - lastPong > 65000) { current.close(1000, "heartbeat timeout"); return; }
        try { current.send("ping"); } catch { current.close(); }
      }, 30000);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data === "pong") { lastPong = now(); attempt = 0; return; }
      if (typeof event.data !== "string" || event.data.length > 200000) return;
      try {
        const item = normalizeEqnNews(JSON.parse(event.data), "ws", now());
        if (item) {
          options.store.upsert(item);
          options.store.setState("lastMessageAt", now());
        }
      } catch { /* Bad frames must not kill ingestion or the heartbeat. */ }
    };
    const onClose = (event: CloseEvent) => schedule(event.code);
    const onError = () => { options.onState?.(false, "News socket error; MCP polling active"); current.close(); };
    current.addEventListener("open", onOpen);
    current.addEventListener("message", onMessage as EventListener);
    current.addEventListener("close", onClose as EventListener);
    current.addEventListener("error", onError);
    detach = () => {
      current.removeEventListener("open", onOpen);
      current.removeEventListener("message", onMessage as EventListener);
      current.removeEventListener("close", onClose as EventListener);
      current.removeEventListener("error", onError);
    };
    handshake = timers.setTimeout(() => { detach(); current.close(); schedule(1006); }, 10000);
  }
  const stop = () => {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener("abort", stop);
    if (retry !== undefined) timers.clearTimeout(retry);
    clearConnection(); detach(); socket?.close();
  };
  if (!options.signal?.aborted) { options.signal?.addEventListener("abort", stop, { once: true }); connect(); }
  return stop;
}

export async function runEqnNewsWorker(options: {
  enabled?: boolean; once?: boolean; doctor?: boolean; store?: Store; client?: EqnClient; signal?: AbortSignal;
  channels?: string[]; rssFallback?: boolean; augmentation?: boolean;
} = {}): Promise<NewsWorkerStatus> {
  const enabled = options.enabled ?? eqnNewsEnabled();
  const store = options.store ?? openEqnNewsStore();
  const signal = options.signal;
  const client = options.client ?? createEqnClient({ store, signal });
  let connected = false;
  let socketError: string | null = null;
  let errors: string[] = [];
  let stopSocket = () => {};
  const snapshot = (): NewsWorkerStatus => ({ enabled, connected, updatedAt: Date.now(), lastMessageAt: store.getState<number>("lastMessageAt"), error: errors.length ? errors.join("; ").slice(0, 700) : socketError });
  const publish = () => { const status = snapshot(); store.setState("status", status); return status; };
  if (!enabled) {
    errors = ["News worker disabled"];
    const status = publish();
    if (!options.store) store.close();
    return status;
  }
  if (options.doctor) {
    try {
      const page = await client.listNews({ channel: "main", limit: 1 });
      for (const row of page.items.slice(0, 1)) {
        const item = normalizeEqnNews(row, "mcp");
        if (!item) throw new Error("Invalid public record");
        store.upsert(item);
        if (item.no !== null) {
          const full = normalizeEqnNews(await client.getNews(item.no), "mcp");
          if (!full || full.no !== item.no) throw new Error("Invalid public detail");
          full.detail = true; store.upsert(full);
        }
      }
      connected = true; store.setState("lastMessageAt", Date.now());
    } catch { errors = ["Official MCP read/detail probe failed"]; }
    const status = publish();
    if (!options.store) store.close();
    return status;
  }
  const heartbeat = setInterval(publish, 15000);
  let lastPrune = 0;
  let augmentationAfter = 0;
  let augmentationFailures = 0;
  let channelOffset = 0;
  try {
    if (!options.once && !options.doctor) stopSocket = startEqnNewsSocket({ store, signal, onReconnect: () => { store.setState("socketGapRequestedAt", Date.now()); }, onState: (isConnected, error) => { connected = isConnected; socketError = error; publish(); } });
    do {
      errors = [];
      const started = Date.now();
      const channels = options.channels ?? EQN_CHANNELS.filter((ch) => ch !== "all");
      // Rotate non-main channels so an upstream failure cannot permanently starve the last channel.
      const others = channels.filter((ch) => ch !== "main");
      const ordered = channels.includes("main") ? ["main", ...others.slice(channelOffset), ...others.slice(0, channelOffset)] : channels;
      channelOffset = (channelOffset + 1) % Math.max(1, others.length);
      for (const channel of ordered) {
        if (signal?.aborted) break;
        try {
          const outcome = await fillEqnChannelGap(store, client, channel, { maxPages: options.doctor ? 1 : 2, signal });
          if (!outcome.complete) errors.push(`${channel} backfill pending`);
          store.setState(`poll:${channel}`, Date.now());
          store.setState("lastMessageAt", Date.now());
          if (options.once || options.doctor) connected = true;
        } catch {
          errors.push(`${channel} MCP unavailable; persisted watermark held`);
          if ((options.rssFallback ?? /^(1|true)$/i.test(process.env.EQN_NEWS_RSS_FALLBACK || "")) && Date.now() - (store.getState<number>(`rss:${channel}`) ?? 0) > 60000) {
            store.setState(`rss:${channel}`, Date.now());
            try {
              for (const row of await client.rss(channel)) { const item = normalizeEqnNews(row, "rss"); if (item) store.upsert(item); }
            } catch { errors.push(`${channel} RSS unavailable`); }
          }
          // 429 is global. Avoid repeatedly spending the same cooldown across every channel.
          if (Number(store.getState("eqnBlockedUntil") ?? 0) > Date.now()) break;
        }
      }
      for (const pending of store.pendingDetails(options.doctor ? 1 : 8)) {
        if (signal?.aborted) break;
        try {
          const full = normalizeEqnNews(await client.getNews(pending.no!), "mcp");
          if (!full || full.no !== pending.no) throw new Error("Invalid detail");
          full.detail = true;
          store.upsert(full);
        } catch { store.setState(`detailRetry:${pending.id}`, Date.now() + 60000); errors.push("Detail enrichment pending"); }
      }
      if ((options.augmentation ?? /^(1|true)$/i.test(process.env.EQN_NEWS_V1_AUGMENT || "")) && Date.now() >= augmentationAfter) {
        try {
          for (const row of await client.augment("all")) store.augment(row);
          augmentationFailures = 0; augmentationAfter = Date.now() + 30000;
        } catch {
          augmentationFailures++; augmentationAfter = Date.now() + (augmentationFailures >= 5 ? 600000 : 30000);
          errors.push("Optional v1 augmentation unavailable");
        }
      }
      if (Date.now() - lastPrune > 86400000) { store.prune(); lastPrune = Date.now(); }
      const status = publish();
      if (options.once || options.doctor || signal?.aborted) return status;
      await eqnWait(Math.max(1000, 15000 - (Date.now() - started)), signal);
    } while (!signal?.aborted);
    return snapshot();
  } catch (error) {
    if (!signal?.aborted) throw error;
    return snapshot();
  } finally {
    clearInterval(heartbeat); stopSocket();
    if (!options.once) { connected = false; publish(); }
    if (!options.store) store.close();
  }
}
