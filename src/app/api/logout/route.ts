import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    ...buildAdminSessionCookieOptions(),
    maxAge: 0,
  });

  return NextResponse.redirect(new URL("/login", request.url));
}
