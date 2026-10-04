import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../src/lib/admin-auth.ts";
import { webPushHealthItem } from "../src/lib/system-health.ts";
import { evaluateOwnedReaderReadiness } from "./owned-reader-readiness.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const base = "http://127.0.0.1:3000";
const cookie = `${ADMIN_SESSION_COOKIE}=${createAdminSessionToken()}`;
const ownedEnabled = ["1", "true", "yes", "on"].includes((process.env.X_OWNED_READER_ENABLED || "").trim().toLowerCase());
const activatedAt = process.env.SIGNAL_HUB_DEPLOY_ACTIVATED_AT || new Date().toISOString();
const readinessDeadline = Date.now() + (ownedEnabled ? 210_000 : 60_000);
async function waitForOwnedReader() {
  if (!ownedEnabled) return;
  for (let attempt = 0; attempt < 90 && Date.now() < readinessDeadline; attempt += 1) {
    const response = await fetch(`${base}/api/x/coverage`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`owned_readiness_http_${response.status}`);
    const result = evaluateOwnedReaderReadiness(await response.json(), activatedAt);
    if (result.ready) { console.log("Owned reader trial ready: assigned authors completed first checks."); return; }
    if (result.fatal) throw new Error(`owned_readiness_${result.reason}`);
    await setTimeout(2000);
  }
  throw new Error("owned_readiness_first_check_timeout");
}
let lastError;
for (let attempt = 0; attempt < 15 && Date.now() < readinessDeadline; attempt += 1) {
  try {
    const response = await fetch(`${base}/api/x`, {
      headers: { cookie }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`readiness HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.feed)) throw new Error("readiness response missing feed");
    const login = await fetch(`${base}/login`, { signal: AbortSignal.timeout(5000) });
    if (!login.ok) throw new Error(`login HTTP ${login.status}`);
    if (process.env.WEB_PUSH_ENABLED === "true" && webPushHealthItem().status !== "ok") throw new Error("push_readiness_failed");
    await waitForOwnedReader();
    console.log("Deployment ready: authenticated feed and login page respond successfully.");
    process.exit(0);
  } catch (error) {
    lastError = error;
    await setTimeout(2000);
  }
}
console.error(String(lastError));
process.exit(1);
