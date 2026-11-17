import { load } from "cheerio";
import { eqnArray, eqnObject, eqnText, normalizeEqnNews } from "./eqn-news-core.ts";
import type { openEqnNewsStore } from "./eqn-news-store.ts";

type Store = ReturnType<typeof openEqnNewsStore>;
export type EqnPage = { items: unknown[]; next_cursor: string | null };
export type EqnListArgs = { channel: string; limit?: number; before?: string; coin?: string; query?: string };
export interface EqnClient {
  listNews(args: EqnListArgs): Promise<EqnPage>;
  getNews(no: number): Promise<unknown>;
  rss(channel: string): Promise<unknown[]>;
  augment(channel: string): Promise<unknown[]>;
}
type Runtime = {
  fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal; store?: Pick<Store, "getState" | "setState">;
};
export class EqnUpstreamError extends Error {
  constructor(message: string, public status = 502, public retryAt: number | null = null) { super(message); }
}
export function eqnRetryDelay(value: string | null, now: number) {
  if (!value) return 15000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.min(86400000, Math.max(1000, delay)) : 15000;
}
export function eqnWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error("Aborted")); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error("Aborted")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// Abort covers headers AND body. Never buffer an unbounded upstream response/SSE stream.
export async function eqnFetchText(url: string, init: RequestInit = {}, runtime: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; rpcId?: number } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(runtime.signal?.reason);
  runtime.signal?.addEventListener("abort", abort, { once: true });
  if (runtime.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Upstream timeout")), runtime.timeoutMs ?? 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (runtime.fetch ?? fetch)(url, { ...init, cache: "no-store", signal: controller.signal, redirect: "error" });
    if (response.status === 304 || response.status === 202 || !response.ok) {
      await response.body?.cancel();
      return { response, text: "" };
    }
    reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    const sse = response.headers.get("content-type")?.includes("text/event-stream");
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > (runtime.maxBytes ?? 4_000_000)) throw new EqnUpstreamError("Upstream response too large");
      text += decoder.decode(chunk.value, { stream: true });
      if (sse && runtime.rpcId !== undefined) {
        const frames = text.replace(/\r\n/g, "\n").split("\n\n");
        for (const frame of frames.slice(0, -1)) {
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          const message = eqnObject(JSON.parse(data));
          if (message.id === runtime.rpcId) return { response, text: JSON.stringify(message) };
        }
      }
    }
    text += decoder.decode();
    if (sse) throw new EqnUpstreamError("MCP stream ended without matching response");
    return { response, text };
  } catch (error) {
    if (controller.signal.aborted && !runtime.signal?.aborted) throw new EqnUpstreamError("Upstream timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
    runtime.signal?.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
  }
}

export function createEqnClient(runtime: Runtime = {}): EqnClient {
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? ((ms) => eqnWait(ms, runtime.signal));
  let gate = Promise.resolve();
  let nextAt = 0;
  let blockedUntil = Number(runtime.store?.getState("eqnBlockedUntil") ?? 0);
  let session = "";
  let protocol = "2024-11-05";
  let seq = 0;
  let initialization: Promise<void> | undefined;
  const etags = new Map<string, string>();
  async function request(url: string, init: RequestInit, rpcId?: number) {
    const run = gate.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (runtime.signal?.aborted) throw new Error("Aborted");
        const wait = Math.max(nextAt, blockedUntil) - now();
        if (wait > 30000) throw new EqnUpstreamError("News upstream rate limited; retry later", 429, blockedUntil);
        if (wait > 0) await sleep(wait);
        nextAt = now() + 500; // <=20 / 10s including initialization, details, RSS and v1.
        const result = await eqnFetchText(url, init, { ...runtime, rpcId });
        if (result.response.status === 429) {
          blockedUntil = now() + eqnRetryDelay(result.response.headers.get("retry-after"), now());
          runtime.store?.setState("eqnBlockedUntil", blockedUntil);
          if (attempt === 2) throw new EqnUpstreamError("News upstream rate limited", 429, blockedUntil);
          continue;
        }
        if (!result.response.ok && result.response.status !== 304) throw new EqnUpstreamError(`News upstream HTTP ${result.response.status}`, result.response.status);
        return result;
      }
      throw new EqnUpstreamError("News request budget exhausted");
    });
    gate = run.then(() => {}, () => {});
    return run;
  }
  async function rpc(method: string, params?: unknown, notification = false): Promise<Record<string, unknown>> {
    const id = notification ? undefined : ++seq;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol };
    if (session) headers["Mcp-Session-Id"] = session;
    const { response, text } = await request("https://api.eqn.news/public/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params }) }, id);
    const newSession = response.headers.get("mcp-session-id");
    if (newSession) session = newSession;
    if (notification) return {};
    const message = eqnObject(JSON.parse(text));
    if (message.id !== id || message.jsonrpc !== "2.0") throw new EqnUpstreamError("Invalid MCP response identity");
    if (message.error) throw new EqnUpstreamError(`MCP error ${eqnText(eqnObject(message.error).message, 200)}`);
    return eqnObject(message.result);
  }
  async function initialize() {
    if (!initialization) initialization = (async () => {
      const result = await rpc("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "signal-hub-eqn-news", version: "1" } });
      protocol = eqnText(result.protocolVersion, 40) || protocol;
      await rpc("notifications/initialized", undefined, true);
    })().catch((error) => { initialization = undefined; throw error; });
    await initialization;
  }
  async function tool(name: string, args: unknown): Promise<unknown> {
    await initialize();
    let result: Record<string, unknown>;
    try { result = await rpc("tools/call", { name, arguments: args }); }
    catch (error) {
      if (!(error instanceof EqnUpstreamError) || error.status !== 404 || !session) throw error;
      session = ""; initialization = undefined;
      await initialize();
      result = await rpc("tools/call", { name, arguments: args });
    }
    if (result.isError) throw new EqnUpstreamError("MCP tool returned an error");
    if (result.structuredContent) return result.structuredContent;
    const text = eqnArray(result.content).map(eqnObject).filter((x) => x.type === "text").map((x) => eqnText(x.text, 4_000_000)).join("\n");
    return JSON.parse(text);
  }
  return {
    async listNews(args) {
      const result = eqnObject(await tool("list_news", { ...args, limit: Math.min(50, Math.max(1, args.limit ?? 50)) }));
      if (!Array.isArray(result.items)) throw new EqnUpstreamError("MCP list_news schema changed");
      return { items: result.items.slice(0, 50), next_cursor: eqnText(result.next_cursor, 500) || null };
    },
    getNews: (no) => tool("get_news", { no }),
    async rss(channel) {
      const headers: Record<string, string> = { Accept: "application/rss+xml" };
      if (etags.has(channel)) headers["If-None-Match"] = etags.get(channel)!;
      const { response, text } = await request(`https://api.eqn.news/public/rss?ch=${encodeURIComponent(channel)}&lang=zh`, { headers });
      if (response.status === 304) return [];
      const etag = response.headers.get("etag");
      if (etag) etags.set(channel, etag);
      const $ = load(text, { xml: true });
      return $("item").slice(0, 50).toArray().map((node) => {
        const link = $(node).find("link").text();
        return { no: Number(/\/(\d+)\/?$/.exec(link)?.[1]) || null, time: $(node).find("pubDate").text(), zh: $(node).find("title").text(), url: link, source: $(node).find("source").text() || "EquationNews RSS", channels: [channel] };
      });
    },
    async augment(channel) {
      const { text } = await request(`https://eqn.news/api/v1/news?limit=100&ch=${encodeURIComponent(channel)}`, { headers: { Accept: "application/json" } });
      const result = eqnObject(JSON.parse(text));
      return eqnArray(result.items).slice(0, 100);
    },
  };
}

type Watermark = { no: number | null; time: number };
type Scan = { before?: string; head: Watermark | null; boundary: Watermark | null; startedAt: number };
export async function fillEqnChannelGap(store: Store, client: Pick<EqnClient, "listNews">, channel: string, options: { maxPages?: number; now?: number; signal?: AbortSignal } = {}) {
  const now = options.now ?? Date.now();
  const scan: Scan = store.getState<Scan>(`scan:${channel}`) ?? { head: null, boundary: store.getState<Watermark>(`watermark:${channel}`), startedAt: now };
  const seen = new Set<string>();
  let inserted = 0;
  for (let page = 0; page < Math.min(100, options.maxPages ?? 5); page++) {
    if (options.signal?.aborted) throw new Error("Aborted");
    const result = await client.listNews({ channel, limit: 50, ...(scan.before ? { before: scan.before } : {}) });
    let reached = false;
    for (const value of result.items) {
      const item = normalizeEqnNews(value, "mcp", now);
      if (!item) throw new EqnUpstreamError("MCP record schema changed; watermark held");
      if (!scan.head) scan.head = { no: item.no, time: item.publishedAt };
      if (item.publishedAt < now - 30 * 86400000) { reached = true; continue; }
      inserted += Number(store.upsert(item));
      if (scan.boundary && (item.no === scan.boundary.no && item.no !== null || item.publishedAt < scan.boundary.time)) reached = true;
    }
    if (reached || !result.next_cursor || !result.items.length) {
      // Checkpoint is advanced only after a complete scan to the OLD watermark, never per page.
      if (scan.head) store.setState(`watermark:${channel}`, scan.head);
      store.setState(`scan:${channel}`, null);
      return { complete: true, inserted };
    }
    if (result.next_cursor === scan.before || seen.has(result.next_cursor)) throw new EqnUpstreamError("MCP pagination cursor repeated; watermark held");
    seen.add(result.next_cursor);
    scan.before = result.next_cursor;
    store.setState(`scan:${channel}`, scan);
  }
  return { complete: false, inserted };
}
