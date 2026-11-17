import { getEqnMarketClient, parseEqnMarketQuery } from "../../../../lib/eqn-news-market.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  let query;
  const params = new URL(request.url).searchParams;
  const view = params.get("view") || "full";
  if (view !== "full" && view !== "chart" && view !== "stats") return Response.json({ error: "Invalid view" }, { status: 400, headers });
  try { query = parseEqnMarketQuery(params); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try { return Response.json(await getEqnMarketClient().getMarket(query, view), { headers }); }
  catch { return Response.json({ error: "Market unavailable" }, { status: 503, headers }); }
}
