import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { validWecomDeviceId } from "./wecom-access.ts";
import { WECOM_MAX_BYTES } from "./wecom-contract.ts";
import { WecomError } from "./wecom-errors.ts";
import type { WecomEnv } from "./wecom-types.ts";

export const WECOM_INGEST_PATH = "/api/wecom/ingest";
export function wecomSyncConfigured(env: WecomEnv = process.env): boolean {
  return env.WECOM_SYNC_ENABLED === "true" && validWecomDeviceId(env.WECOM_SYNC_DEVICE_ID?.trim()) &&
    typeof env.WECOM_SYNC_SECRET === "string" && env.WECOM_SYNC_SECRET.length >= 32;
}
export function canonicalWecomSignature(headers: Headers, body: Uint8Array): string {
  return ["POST", WECOM_INGEST_PATH, headers.get("x-wecom-device"), headers.get("x-wecom-timestamp"),
    headers.get("x-wecom-nonce"), createHash("sha256").update(body).digest("hex")].join("\n");
}
export function checkWecomSignatureHeaders(headers: Headers) {
  const deviceId = headers.get("x-wecom-device") ?? "", timestamp = headers.get("x-wecom-timestamp") ?? "";
  const nonce = headers.get("x-wecom-nonce") ?? "", signature = headers.get("x-wecom-signature") ?? "";
  if (!validWecomDeviceId(deviceId) || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new WecomError("invalid_signature", 401);
  }
  return { deviceId, timestamp, nonce, signature };
}
export function verifyWecomSignature(headers: Headers, body: Uint8Array, {
  env = process.env, now = Date.now(),
}: { env?: WecomEnv; now?: number } = {}) {
  const { deviceId, timestamp, nonce, signature } = checkWecomSignatureHeaders(headers);
  if (!wecomSyncConfigured(env)) throw new WecomError("sync_unconfigured", 503);
  if (deviceId !== env.WECOM_SYNC_DEVICE_ID?.trim() || Math.abs(Number(timestamp) * 1000 - now) > 300_000) {
    throw new WecomError("invalid_signature", 401);
  }
  const expected = createHmac("sha256", env.WECOM_SYNC_SECRET!).update(canonicalWecomSignature(headers, body)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new WecomError("invalid_signature", 401);
  return { ownerId: "admin", deviceId, nonce };
}
export async function readWecomBody(request: Request): Promise<Buffer> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || request.headers.has("content-encoding")) {
    throw new WecomError("json_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) throw new WecomError("payload_invalid");
  if (declared !== null && Number(declared) > WECOM_MAX_BYTES) throw new WecomError("payload_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WecomError("payload_invalid");
  const chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > WECOM_MAX_BYTES) throw new WecomError("payload_too_large", 413);
          chunks.push(item.value);
        }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WecomError("body_timeout", 408)), 3000); }),
    ]);
    if (declared !== null && size !== Number(declared)) throw new WecomError("payload_invalid");
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
