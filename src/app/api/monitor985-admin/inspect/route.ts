import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function disabled() {
  return NextResponse.json(
    { success: false, error: "monitor985 admin inspector is disabled" },
    { status: 404 },
  );
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}
