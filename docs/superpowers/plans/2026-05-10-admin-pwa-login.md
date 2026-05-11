# Admin PWA Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-admin password login gate that protects Signal Hub before PWA deployment.

**Architecture:** The feature adds dependency-free HMAC session helpers, a Next.js 16 `proxy.ts` guard, a `/login` page with a server action, and a logout route. The guard redirects unauthenticated page requests and returns `401` for unauthenticated API requests.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node `crypto`, existing `.mjs` assertion tests.

---

## File Structure

- Create `src/lib/admin-auth.ts`: owns constants, environment validation, password comparison, signed token creation, token verification, and cookie option helpers.
- Create `src/lib/admin-auth.test.mjs`: tests helper behavior before implementation.
- Create `src/proxy.ts`: checks `SIGNAL_HUB_ADMIN_SESSION` and gates pages/API routes.
- Create `src/proxy.test.mjs`: tests matcher and request handling behavior.
- Create `src/app/login/page.tsx`: renders the admin login form.
- Create `src/app/login/actions.ts`: validates the password and sets the session cookie.
- Create `src/app/api/logout/route.ts`: clears the session cookie and redirects to login.
- Modify `.env.example`: documents `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`.

## Tasks

### Task 1: Auth Helper

- [ ] Write `src/lib/admin-auth.test.mjs` with assertions for valid login, invalid login, missing env rejection, token verification, tamper rejection, and expiry rejection.
- [ ] Run `node --experimental-strip-types --experimental-transform-types src/lib/admin-auth.test.mjs` and confirm it fails because `admin-auth.ts` does not exist.
- [ ] Create `src/lib/admin-auth.ts` with HMAC-SHA256 signed sessions.
- [ ] Run the focused auth test and confirm it passes.

### Task 2: Proxy Guard

- [ ] Write `src/proxy.test.mjs` with assertions that public assets/login are allowed, pages redirect to `/login?next=...`, unauthenticated API requests return `401`, and authenticated requests pass through.
- [ ] Run `node --experimental-strip-types --experimental-transform-types src/proxy.test.mjs` and confirm it fails because `src/proxy.ts` does not exist.
- [ ] Create `src/proxy.ts` using Next.js 16 `proxy` convention.
- [ ] Run the proxy test and confirm it passes.

### Task 3: Login UI And Server Action

- [ ] Create `src/app/login/actions.ts` with a `loginAdmin` server action that checks `ADMIN_PASSWORD`, creates a session token, sets the auth cookie, and redirects to the validated `next` path.
- [ ] Create `src/app/login/page.tsx` with a compact password form using the existing warm Signal Hub visual system.
- [ ] Ensure the form has no visible implementation instructions or debug text.

### Task 4: Logout Route And Environment Docs

- [ ] Create `src/app/api/logout/route.ts` that clears the auth cookie and redirects to `/login`.
- [ ] Add `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` examples to `.env.example`.

### Task 5: Verification

- [ ] Run `node --experimental-strip-types --experimental-transform-types src/lib/admin-auth.test.mjs`.
- [ ] Run `node --experimental-strip-types --experimental-transform-types src/proxy.test.mjs`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] If build fails on missing local secrets, verify that the failure is environmental and document the exact blocker.
