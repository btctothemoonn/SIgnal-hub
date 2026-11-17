import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/admin-auth.ts";
import { getEqnNewsStore } from "../../../../lib/eqn-news-store.ts";
import { getPushRequestOrigin } from "../../../../lib/web-push-api.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
function signedIn(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))?.slice(ADMIN_SESSION_COOKIE.length + 1);
  return verifyAdminSessionToken(token);
}
function snapshot() {
  const store = getEqnNewsStore();
  return { sources: store.sources(), blocked: store.blockedSources() };
}

export async function GET(request: Request) {
  if (!signedIn(request)) return reply({ error: "Unauthorized" }, 401);
  try { return reply(snapshot()); }
  catch { return reply({ error: "News storage unavailable" }, 503); }
}

export async function PUT(request: Request) {
  if (!signedIn(request)) return reply({ error: "Unauthorized" }, 401);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== getPushRequestOrigin(request) || (fetchSite && fetchSite !== "same-origin")) return reply({ error: "Same-origin request required" }, 403);
  if (Number(request.headers.get("content-length")) > 16384) return reply({ error: "Request too large" }, 413);
  let blocked: unknown;
  try {
    const text = await request.text();
    if (text.length > 16384) return reply({ error: "Request too large" }, 413);
    blocked = (JSON.parse(text) as { blocked?: unknown }).blocked;
  } catch { return reply({ error: "Invalid JSON" }, 400); }
  try { getEqnNewsStore().setBlockedSources(blocked); }
  catch (error) {
    if (/Invalid blocked sources/.test(String(error))) return reply({ error: "Invalid blocked sources" }, 400);
    return reply({ error: "News storage unavailable" }, 503);
  }
  try { return reply(snapshot()); }
  catch { return reply({ error: "News storage unavailable" }, 503); }
}
