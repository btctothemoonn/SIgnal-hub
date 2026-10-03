import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPushRequestOrigin, revokePushForLogout } from "../../../lib/web-push-api.ts";
import {
  ADMIN_SESSION_COOKIE,
  buildAdminSessionCookieOptions,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "Use POST to sign out.", success: false },
    { status: 405 },
  );
}

export async function POST(request: Request) {
  const rejected = await revokePushForLogout(request);
  if (rejected) return rejected;
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    ...buildAdminSessionCookieOptions(),
    maxAge: 0,
  });

  return NextResponse.redirect(new URL("/login", getPushRequestOrigin(request) || request.url), { status: 303, headers: { "Cache-Control": "private, no-store" } });
}
