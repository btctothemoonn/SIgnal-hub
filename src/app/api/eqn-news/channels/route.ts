import { EQN_CHANNELS } from "../../../../lib/eqn-news-core.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() { return Response.json({ channels: EQN_CHANNELS }, { headers: { "Cache-Control": "private, no-store" } }); }
