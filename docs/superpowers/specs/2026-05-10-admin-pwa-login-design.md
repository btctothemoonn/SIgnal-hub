# Admin PWA Login Design

## Scope

Add a single-administrator login gate for Signal Hub before it is exposed as a phone-installable PWA. This protects the existing pages and API routes with one password-backed session. Multi-user accounts, signup, email recovery, and PWA manifest assets are out of scope for this first step.

## Architecture

Authentication is implemented inside the existing Next.js app with no new runtime dependencies. A small `admin-auth` helper owns password comparison, signed session token creation, and session token verification. Next.js 16 `proxy.ts` performs fast request gating before page or API handlers run.

The login flow uses a server action from `/login`. A successful password check sets a signed `HttpOnly` cookie. Protected page requests redirect to `/login`; protected API requests return `401` JSON. Logout clears the same cookie.

## Requirements

- Store the admin password in `ADMIN_PASSWORD`.
- Store the HMAC signing secret in `ADMIN_SESSION_SECRET`.
- Reject login when either environment variable is missing.
- Use a signed session cookie rather than storing the raw password.
- Make the session cookie `HttpOnly`, `SameSite=Lax`, path-wide, and `Secure` outside local development.
- Protect the dashboard pages and `/api/*` routes.
- Allow `/login`, Next.js static assets, icons, and other public metadata files.
- Preserve the original requested URL with `next=` when redirecting a page request to `/login`.
- Return JSON `401` for unauthenticated API requests.
- Keep the implementation dependency-free and small.

## Non-Goals

- No public registration.
- No multi-user authorization model.
- No third-party auth provider.
- No push notifications or service worker work in this step.
- No persistence migration for `.signal-hub` caches in this step.

## Testing

Use the existing `.mjs` assertion-test style. Add coverage for password checks, session token verification, tamper rejection, expiry rejection, and proxy matcher/redirect behavior. Run the focused auth tests, then lint and build.
