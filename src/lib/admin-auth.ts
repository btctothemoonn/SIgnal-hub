import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "signal_hub_admin";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type AdminAuthEnv = Record<string, string | undefined>;

type AdminSessionPayload = {
  exp: number;
  iat: number;
  v: 1;
};

function envText(env: AdminAuthEnv, key: string): string {
  return env[key]?.trim() || "";
}

function envFlag(env: AdminAuthEnv, key: string): boolean | null {
  const value = envText(env, key).toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodePayload(payload: AdminSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(payload: string): AdminSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      parsed?.v !== 1 ||
      !Number.isFinite(parsed.iat) ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }
    return parsed as AdminSessionPayload;
  } catch {
    return null;
  }
}

export function isAdminAuthConfigured(env: AdminAuthEnv = process.env): boolean {
  return Boolean(envText(env, "ADMIN_PASSWORD") && envText(env, "ADMIN_SESSION_SECRET"));
}

export function verifyAdminPassword(
  password: unknown,
  env: AdminAuthEnv = process.env,
): boolean {
  const expected = envText(env, "ADMIN_PASSWORD");
  if (!isAdminAuthConfigured(env) || typeof password !== "string") return false;
  return constantTimeEqual(password, expected);
}

export function createAdminSessionToken(
  env: AdminAuthEnv = process.env,
  nowMs = Date.now(),
): string {
  const secret = envText(env, "ADMIN_SESSION_SECRET");
  if (!isAdminAuthConfigured(env)) {
    throw new Error("Admin authentication is not configured.");
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const payload = encodePayload({
    exp: nowSeconds + ADMIN_SESSION_TTL_SECONDS,
    iat: nowSeconds,
    v: 1,
  });
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyAdminSessionToken(
  token: string | null | undefined,
  env: AdminAuthEnv = process.env,
  nowMs = Date.now(),
): boolean {
  const secret = envText(env, "ADMIN_SESSION_SECRET");
  if (!secret || typeof token !== "string") return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;

  if (!constantTimeEqual(signature, signPayload(payload, secret))) return false;

  const decoded = decodePayload(payload);
  if (!decoded) return false;

  const nowSeconds = Math.floor(nowMs / 1000);
  return decoded.exp > nowSeconds;
}

export function buildAdminSessionCookieOptions(env: AdminAuthEnv = process.env) {
  const configuredSecure = envFlag(env, "ADMIN_COOKIE_SECURE");

  return {
    httpOnly: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: configuredSecure ?? envText(env, "NODE_ENV") === "production",
  };
}

export function normalizeAdminNextPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(nextPath, "https://signal-hub.local");
    if (url.origin !== "https://signal-hub.local") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
