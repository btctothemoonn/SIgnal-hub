import { NextResponse } from "next/server";
import {
  getOrCreateAlphaSummary,
  normalizeAlphaSummaryAudience,
  normalizeAlphaSummaryScope,
} from "@/lib/alpha-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = normalizeAlphaSummaryScope(params.get("scope"));
  const audience = normalizeAlphaSummaryAudience(params.get("audience"));
  const snapshot = await getOrCreateAlphaSummary({ scope, audience });
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  let force = true;
  let scope = normalizeAlphaSummaryScope(null);
  let audience = normalizeAlphaSummaryAudience(null);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    force = body.force !== false;
    scope = normalizeAlphaSummaryScope(body.scope);
    audience = normalizeAlphaSummaryAudience(body.audience);
  } catch {}

  const snapshot = await getOrCreateAlphaSummary({ force, scope, audience });
  return NextResponse.json(snapshot);
}
