import { ADMIN_SESSION_COOKIE, isAdminAuthConfigured, verifyAdminSessionToken } from "./admin-auth.ts";
import { WecomError } from "./wecom-errors.ts";
import type { WecomAccess, WecomEnv } from "./wecom-types.ts";

export function validWecomDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function authorizeWecomRead(request: Request, env: WecomEnv = process.env): WecomAccess {
  const header = request.headers.get("cookie") ?? "";
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  const token = matches.length === 1 ? matches[0].slice(ADMIN_SESSION_COOKIE.length + 1) : null;
  if (header.length > 8192 || !isAdminAuthConfigured(env) || !verifyAdminSessionToken(token, env)) {
    throw new WecomError("unauthorized", 401);
  }
  const deviceId = env.WECOM_SYNC_DEVICE_ID?.trim();
  // A shared administrator password cannot identify an individual owner. Keep this opt-in.
  if (env.WECOM_OWNER_ADMIN_ONLY !== "true" || !validWecomDeviceId(deviceId)) {
    throw new WecomError("device_forbidden", 403);
  }
  const selectors = new URL(request.url).searchParams.getAll("deviceId");
  const headerDevice = request.headers.get("x-wecom-device");
  if (selectors.some(value => value !== deviceId) || (headerDevice !== null && headerDevice !== deviceId)) {
    throw new WecomError("device_forbidden", 403);
  }
  return { ownerId: "admin", deviceId };
}

export function wecomPrivateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}

export function wecomErrorResponse(error: unknown): Response {
  return error instanceof WecomError
    ? wecomPrivateJson({ error: error.message }, error.status)
    : wecomPrivateJson({ error: "service_unavailable" }, 503);
}
