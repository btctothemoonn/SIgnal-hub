import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";

import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
} from "./lib/admin-auth.ts";

const { config, proxy } = await import("./proxy.ts");

const env = {
  ADMIN_PASSWORD: "correct horse battery staple",
  ADMIN_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};
process.env.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
process.env.ADMIN_SESSION_SECRET = env.ADMIN_SESSION_SECRET;

function request(path, token = null) {
  const headers = new Headers();
  if (token) headers.set("cookie", `${ADMIN_SESSION_COOKIE}=${token}`);
  return new NextRequest(`https://hub.example${path}`, { headers });
}

assert.deepEqual(config, {
  matcher: ["/((?!_next/static|_next/image).*)"],
});

const loginResponse = proxy(request("/login?next=%2Fsettings"));
assert.equal(loginResponse.status, 200);
assert.equal(loginResponse.headers.get("x-middleware-next"), "1");

const loginApiResponse = proxy(request("/api/login"));
assert.equal(loginApiResponse.status, 200);
assert.equal(loginApiResponse.headers.get("x-middleware-next"), "1");

const assetResponse = proxy(request("/favicon.ico"));
assert.equal(assetResponse.status, 200);
assert.equal(assetResponse.headers.get("x-middleware-next"), "1");

const pageRedirect = proxy(request("/settings?tab=telegram"));
assert.equal(pageRedirect.status, 307);
assert.equal(
  pageRedirect.headers.get("location"),
  "https://hub.example/login?next=%2Fsettings%3Ftab%3Dtelegram",
);

const apiResponse = proxy(request("/api/settings"));
assert.equal(apiResponse.status, 401);
assert.deepEqual(await apiResponse.json(), {
  error: "Unauthorized",
  success: false,
});

const dottedApiResponse = proxy(request("/api/telegram/media/channel-1/file.jpg"));
assert.equal(dottedApiResponse.status, 401);

const token = createAdminSessionToken(env);
const authenticatedResponse = proxy(request("/settings", token));
assert.equal(authenticatedResponse.status, 200);
assert.equal(authenticatedResponse.headers.get("x-middleware-next"), "1");

console.log("ok - admin proxy guard");
