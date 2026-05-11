import assert from "node:assert/strict";

const {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  buildAdminSessionCookieOptions,
  createAdminSessionToken,
  isAdminAuthConfigured,
  normalizeAdminNextPath,
  verifyAdminPassword,
  verifyAdminSessionToken,
} = await import("./admin-auth.ts");

const env = {
  ADMIN_PASSWORD: "correct horse battery staple",
  ADMIN_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  NODE_ENV: "production",
};

const nowMs = Date.UTC(2026, 4, 10, 9, 30, 0);

assert.equal(ADMIN_SESSION_COOKIE, "signal_hub_admin");
assert.equal(ADMIN_SESSION_TTL_SECONDS, 60 * 60 * 24 * 30);

assert.equal(isAdminAuthConfigured(env), true);
assert.equal(isAdminAuthConfigured({ ADMIN_PASSWORD: "", ADMIN_SESSION_SECRET: "" }), false);

assert.equal(verifyAdminPassword("correct horse battery staple", env), true);
assert.equal(verifyAdminPassword("wrong password", env), false);
assert.equal(verifyAdminPassword("correct horse battery staple", { ...env, ADMIN_PASSWORD: "" }), false);
assert.equal(verifyAdminPassword(null, env), false);

const token = createAdminSessionToken(env, nowMs);
assert.equal(verifyAdminSessionToken(token, env, nowMs), true);
assert.equal(
  verifyAdminSessionToken(token, env, nowMs + ADMIN_SESSION_TTL_SECONDS * 1000 - 1000),
  true,
);
assert.equal(
  verifyAdminSessionToken(token, env, nowMs + ADMIN_SESSION_TTL_SECONDS * 1000),
  false,
);
assert.equal(verifyAdminSessionToken(`${token.slice(0, -1)}x`, env, nowMs), false);
assert.equal(
  verifyAdminSessionToken(token, { ...env, ADMIN_SESSION_SECRET: "different-secret" }, nowMs),
  false,
);
assert.equal(verifyAdminSessionToken("", env, nowMs), false);

assert.deepEqual(buildAdminSessionCookieOptions(env), {
  httpOnly: true,
  maxAge: ADMIN_SESSION_TTL_SECONDS,
  path: "/",
  sameSite: "lax",
  secure: true,
});
assert.equal(buildAdminSessionCookieOptions({ ...env, NODE_ENV: "development" }).secure, false);

assert.equal(normalizeAdminNextPath("/settings?tab=telegram"), "/settings?tab=telegram");
assert.equal(normalizeAdminNextPath("/"), "/");
assert.equal(normalizeAdminNextPath("https://evil.example/settings"), "/");
assert.equal(normalizeAdminNextPath("//evil.example/settings"), "/");
assert.equal(normalizeAdminNextPath(null), "/");

console.log("ok - admin auth helpers");
