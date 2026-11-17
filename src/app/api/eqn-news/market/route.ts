import { getEqnMarketClient, parseEqnMarketQuery } from "../../../../lib/eqn-news-market.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  let query;
  try { query = parseEqnMarketQuery(new URL(request.url).searchParams); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try { return Response.json(await getEqnMarketClient().getMarket(query), { headers }); }
  catch { return Response.json({ error: "Market unavailable" }, { status: 503, headers }); }
}
