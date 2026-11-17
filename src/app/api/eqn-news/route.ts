import { parseEqnFeedQuery } from "../../../lib/eqn-news-core.ts";
import { getEqnNewsStore } from "../../../lib/eqn-news-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  let query;
  try { query = parseEqnFeedQuery(new URL(request.url).searchParams); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try { return Response.json(getEqnNewsStore().feed(query), { headers }); }
  catch (error) { return Response.json({ error: /cursor/i.test(String(error)) ? "Invalid news cursor" : "News storage unavailable" }, { status: /cursor/i.test(String(error)) ? 400 : 503, headers }); }
}
