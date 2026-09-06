import { createServer } from "node:http";
import { Readable } from "node:stream";
import { wecomErrorResponse, wecomPrivateJson } from "./wecom-access.ts";
import { parseWecomPacket } from "./wecom-contract.ts";
import { WecomError } from "./wecom-errors.ts";
import { checkWecomSignatureHeaders, readWecomBody, verifyWecomSignature, wecomSyncConfigured, WECOM_INGEST_PATH } from "./wecom-signature.ts";
import { ingestWecomPacket } from "./wecom-store.ts";
import type { WecomEnv, WecomPacket } from "./wecom-types.ts";

export function wecomReceiverPort(env: WecomEnv = process.env): number {
  const value = env.WECOM_RECEIVER_PORT ?? "3041";
  if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new WecomError("sync_unconfigured", 503);
  return Number(value);
}
function boundPacketDevice(packet: WecomPacket, device: string) {
  if (packet.type === "heartbeat") return;
  const id = packet.type === "report" ? packet.report.id : packet.alert.id;
  const prefix = packet.type === "report" ? "wecom" : "wecom-ca";
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== prefix || parts[1] !== device || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[2]) ||
    !(packet.type === "report" ? /^[a-f0-9]{64}$/.test(parts[3]) : /^[1-9]\d*$/.test(parts[3]))) throw new WecomError("device_id_mismatch");
}
async function accept(request: Request, env: WecomEnv, now: number): Promise<Response> {
  try {
    checkWecomSignatureHeaders(request.headers);
    if (!wecomSyncConfigured(env)) throw new WecomError("sync_unconfigured", 503);
    const body = await readWecomBody(request);
    const access = verifyWecomSignature(request.headers, body, { env, now });
    const packet = parseWecomPacket(body);
    boundPacketDevice(packet, access.deviceId);
    return wecomPrivateJson(ingestWecomPacket(packet, { ...access, body, now, env }));
  } catch (error) { return wecomErrorResponse(error); }
}

export function createWecomReceiver({ env = process.env, now = Date.now }: { env?: WecomEnv; now?: () => number } = {}) {
  let inFlight = 0;
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    let response: Response;
    if (req.url === "/health" && req.method === "GET") response = wecomPrivateJson({ ok: true });
    else if (req.url !== WECOM_INGEST_PATH) response = wecomPrivateJson({ error: "not_found" }, 404);
    else if (req.method !== "POST") response = wecomPrivateJson({ error: "method_not_allowed" }, 405);
    else if (inFlight >= 8) {
      response = wecomPrivateJson({ error: "busy" }, 429); response.headers.set("Retry-After", "5");
    } else {
      inFlight++;
      try {
        const headers = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
        const request = new Request(`http://127.0.0.1${WECOM_INGEST_PATH}`, {
          method: "POST", headers, body: Readable.toWeb(req), duplex: "half",
        } as RequestInit);
        response = await accept(request, env, now());
      } catch { response = wecomPrivateJson({ error: "payload_invalid" }, 400); }
      finally { inFlight--; }
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    if (!req.complete) res.once("finish", () => req.destroy());
  });
  server.maxConnections = 16;
  server.keepAliveTimeout = 1000;
  server.setTimeout(5000, socket => socket.destroy());
  return server;
}

let forwards = 0;
export async function forwardWecomIngest(request: Request, {
  env = process.env, now = Date.now(), fetchImpl = fetch,
}: { env?: WecomEnv; now?: number; fetchImpl?: typeof fetch } = {}): Promise<Response> {
  let entered = false;
  try {
    checkWecomSignatureHeaders(request.headers);
    if (!wecomSyncConfigured(env)) throw new WecomError("sync_unconfigured", 503);
    if (forwards >= 8) {
      const response = wecomPrivateJson({ error: "busy" }, 429); response.headers.set("Retry-After", "5"); return response;
    }
    forwards++; entered = true;
    const body = await readWecomBody(request);
    verifyWecomSignature(request.headers, body, { env, now });
    const port = wecomReceiverPort(env), headers = new Headers({ "content-type": "application/json" });
    for (const key of ["device", "timestamp", "nonce", "signature"]) headers.set(`x-wecom-${key}`, request.headers.get(`x-wecom-${key}`)!);
    const upstream = await fetchImpl(`http://127.0.0.1:${port}${WECOM_INGEST_PATH}`, {
      method: "POST", headers, body: new Uint8Array(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    const reader = upstream.body?.getReader();
    if (!reader) throw new WecomError("receiver_unavailable", 503);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 16384) throw new WecomError("receiver_unavailable", 503);
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const ack = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (upstream.status === 200) {
      const packet = parseWecomPacket(body);
      const item = packet.type === "report" ? packet.report : packet.type === "ca_alert" ? packet.alert : null;
      if (!ack || ack.ok !== true || (item && (ack.id !== item.id || ack.revision !== item.revision || !["stored", "duplicate", "stale"].includes(ack.disposition)))) {
        throw new WecomError("receiver_unavailable", 503);
      }
      return wecomPrivateJson(item ? { ok: true, id: item.id, revision: item.revision, disposition: ack.disposition } : { ok: true });
    }
    const allowed = ["payload_invalid", "payload_sensitive", "unsupported_schema", "duplicate_json_key", "device_id_mismatch", "invalid_signature", "json_required", "payload_too_large", "body_timeout", "sync_unconfigured", "replay", "revision_conflict", "storage_unavailable", "disk_limit", "busy"];
    if (![400, 401, 408, 409, 413, 415, 429, 503].includes(upstream.status) || !allowed.includes(ack?.error)) throw new WecomError("receiver_unavailable", 503);
    const response = wecomPrivateJson({ error: ack.error }, upstream.status);
    if (upstream.status === 429) response.headers.set("Retry-After", "5");
    return response;
  } catch (error) { return wecomErrorResponse(error instanceof WecomError ? error : new WecomError("receiver_unavailable", 503)); }
  finally { if (entered) forwards--; }
}
