import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  buildAdminSessionCookieOptions,
  createAdminSessionToken,
  isAdminAuthConfigured,
  normalizeAdminNextPath,
  verifyAdminPassword,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function formText(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

function requestOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ||
      new URL(request.url).protocol.replace(/:$/, "") ||
      "http";
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function redirectUrl(request: Request, path: string) {
  return new URL(path, requestOrigin(request));
}

function loginRedirectUrl(request: Request, error: "config" | "invalid", nextPath: string) {
  const url = redirectUrl(request, "/login");
  url.searchParams.set("error", error);
  if (nextPath !== "/") url.searchParams.set("next", nextPath);
  return url;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = normalizeAdminNextPath(formText(formData.get("next")));

  if (!isAdminAuthConfigured()) {
    return NextResponse.redirect(loginRedirectUrl(request, "config", nextPath), 303);
  }

  if (!verifyAdminPassword(formData.get("password"))) {
    return NextResponse.redirect(loginRedirectUrl(request, "invalid", nextPath), 303);
  }

  const response = NextResponse.redirect(redirectUrl(request, nextPath), 303);
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    createAdminSessionToken(),
    buildAdminSessionCookieOptions(),
  );
  return response;
}
