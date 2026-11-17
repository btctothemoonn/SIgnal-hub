import { parseEqnFeedQuery } from "../../../../../lib/eqn-news-core.ts";
import { getEqnNewsStore } from "../../../../../lib/eqn-news-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  const params = new URL(request.url).searchParams;
  params.set("coin", symbol);
  const headers = { "Cache-Control": "private, no-store" };
  let query;
  try { query = parseEqnFeedQuery(params); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try { return Response.json(getEqnNewsStore().feed(query), { headers }); }
  catch (error) { return Response.json({ error: /cursor/i.test(String(error)) ? "Invalid news cursor" : "News storage unavailable" }, { status: /cursor/i.test(String(error)) ? 400 : 503, headers }); }
}
