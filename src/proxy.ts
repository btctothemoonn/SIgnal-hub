import { NextResponse, type NextRequest } from "next/server.js";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/admin-auth.ts";

const PUBLIC_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/manifest.json",
  "/manifest.webmanifest",
  "/robots.txt",
]);

function isPublicPath(pathname: string): boolean {
  if (pathname === "/api/login") return true;
  if (pathname.startsWith("/api/")) return false;

  return (
    pathname === "/login" ||
    pathname.startsWith("/_next/") ||
    PUBLIC_PATHS.has(pathname) ||
    /\.[^/]+$/.test(pathname)
  );
}

function nextPath(request: NextRequest): string {
  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return path || "/";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (verifyAdminSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", success: false },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath(request));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
