import { NextResponse } from "next/server";
import {
  authorizeXApiUsageToday,
  getXApiUsageSnapshot,
} from "@/lib/x-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActionBody = {
  action: "authorize.today";
};

export async function GET() {
  return NextResponse.json({
    success: true,
    usage: getXApiUsageSnapshot(),
  });
}

export async function POST(request: Request) {
  let body: ActionBody;

  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (body.action !== "authorize.today") {
    return NextResponse.json(
      { success: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    usage: authorizeXApiUsageToday(),
  });
}
