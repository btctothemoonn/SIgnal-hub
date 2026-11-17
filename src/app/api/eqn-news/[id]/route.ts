import { getEqnNewsDetail, parseEqnDetailQuery } from "../../../../lib/eqn-news-detail.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^(?:[1-9]\d{0,15}|ws:[a-f0-9]{64})$/.test(id)) return Response.json({ error: "Invalid news id" }, { status: 400, headers });
  let selection;
  try { selection = parseEqnDetailQuery(new URL(request.url).searchParams); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
  try {
    const detail = await getEqnNewsDetail(id, selection);
    return detail ? Response.json(detail, { headers }) : Response.json({ error: "News not found" }, { status: 404, headers });
  } catch { return Response.json({ error: "News detail unavailable" }, { status: 503, headers }); }
}
