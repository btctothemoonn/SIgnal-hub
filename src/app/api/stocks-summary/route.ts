import { NextResponse } from "next/server";
import {
  getOrCreateAlphaSummary,
  normalizeAlphaSummaryScope,
} from "@/lib/alpha-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const scope = normalizeAlphaSummaryScope(
    new URL(request.url).searchParams.get("scope"),
  );
  const snapshot = await getOrCreateAlphaSummary({ scope, audience: "stocks" });
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  let force = true;
  let scope = normalizeAlphaSummaryScope(null);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    force = body.force !== false;
    scope = normalizeAlphaSummaryScope(body.scope);
  } catch {}

  const snapshot = await getOrCreateAlphaSummary({
    force,
    scope,
    audience: "stocks",
  });
  return NextResponse.json(snapshot);
}
