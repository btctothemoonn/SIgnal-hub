import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../src/lib/admin-auth.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const base = "http://127.0.0.1:3000";
const cookie = `${ADMIN_SESSION_COOKIE}=${createAdminSessionToken()}`;
let lastError;
for (let attempt = 0; attempt < 15; attempt += 1) {
  try {
    const response = await fetch(`${base}/api/x`, {
      headers: { cookie }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`readiness HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.feed)) throw new Error("readiness response missing feed");
    const login = await fetch(`${base}/login`, { signal: AbortSignal.timeout(5000) });
    if (!login.ok) throw new Error(`login HTTP ${login.status}`);
    console.log("Deployment ready: authenticated feed and login page respond successfully.");
    process.exit(0);
  } catch (error) {
    lastError = error;
    await setTimeout(2000);
  }
}
console.error(String(lastError));
process.exit(1);
