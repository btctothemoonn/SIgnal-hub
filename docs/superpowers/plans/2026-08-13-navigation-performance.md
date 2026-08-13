# Signal Hub Navigation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four primary workspace transitions responsive without removing features or historical data.

**Architecture:** Add opt-in compact/paginated transport at API boundaries, preserve existing default contracts, and reduce initial client work through deferred requests, native off-screen rendering containment, and shared route loading fallbacks. Each optimization is independently testable and falls back to existing cached data.

**Tech Stack:** Next.js App Router, React, TypeScript, Node contract tests, Tailwind CSS.

## Global Constraints

- Do not remove Signal Flow, Holding, Stocks, Douyin, live streams, AI summaries, or historical access.
- Existing API response shapes remain the default unless a new query option is requested.
- Do not add a new runtime dependency.
- Preserve current browser cache and error fallback behavior.

---

### Task 1: Compact Stocks Performance Transport

**Files:**
- Modify: `src/lib/stocks-performance-data.ts`
- Modify: `src/app/api/stocks-performance/route.ts`
- Modify: `src/components/alpha-research-page.tsx`
- Test: `src/lib/stocks-performance-data.test.mjs`
- Test: `src/app/api/stocks-performance/route.test.mjs`

**Interfaces:**
- Produces `compactStocksPerformanceSnapshot(snapshot)` and
  `expandCompactStocksPerformanceSnapshot(snapshot)`.
- `/api/stocks-performance?format=compact` returns tuple points while the
  existing endpoint remains unchanged.

- [ ] Write failing tests for round-trip compact encoding and the opt-in route.
- [ ] Run both tests and confirm failures identify the missing compact behavior.
- [ ] Implement compact encoding, route selection, and browser expansion.
- [ ] Change the Stocks client request to `format=compact`.
- [ ] Run both tests and confirm they pass.

### Task 2: Defer Secondary Stocks Requests

**Files:**
- Create: `src/lib/deferred-browser-task.ts`
- Test: `src/lib/deferred-browser-task.test.mjs`
- Modify: `src/components/alpha-research-page.tsx`
- Test: `src/components/alpha-research-page.test.mjs`

**Interfaces:**
- Produces `scheduleDeferredBrowserTask(callback, delayMs)` returning a cleanup
  function.

- [ ] Write failing helper and component contract tests.
- [ ] Run tests and confirm the helper and deferred calls are missing.
- [ ] Implement idle-callback scheduling with timeout fallback.
- [ ] Defer financial and catalyst initial requests while retaining their
  refresh intervals.
- [ ] Run tests and confirm they pass.

### Task 3: Remove Initial Signal Refetch And Contain Feed Rendering

**Files:**
- Create: `src/lib/signal-initial-refresh.ts`
- Test: `src/lib/signal-initial-refresh.test.mjs`
- Modify: `src/components/unified-news-panel.tsx`
- Test: `src/lib/unified-news-panel-contract.test.mjs`

**Interfaces:**
- Produces `shouldRefreshSignalSnapshotsOnEffect(previousRange, nextRange)`.

- [ ] Write failing tests for initial latest mount and subsequent range changes.
- [ ] Run tests and confirm the initial-refresh policy is absent.
- [ ] Implement the policy and skip only the first duplicate latest refresh.
- [ ] Add `content-visibility-auto` and stable intrinsic sizing to feed cards.
- [ ] Run Signal contract tests and confirm live/range behavior remains covered.

### Task 4: Paginate Douyin Initial Data

**Files:**
- Modify: `src/lib/douyin-monitor.ts`
- Test: `src/lib/douyin-monitor.test.mjs`
- Modify: `src/app/api/douyin/route.ts`
- Test: `src/app/api/douyin/route.test.mjs`
- Modify: `src/app/douyin/page.tsx`
- Modify: `src/components/douyin-monitor-panel.tsx`
- Test: `src/components/douyin-monitor-panel.test.mjs`

**Interfaces:**
- Produces `paginateDouyinSnapshot(snapshot, limit)` with optional pagination
  metadata.
- `/api/douyin?limit=10` returns the first ten videos and `hasMore` metadata;
  no-limit calls keep returning all videos.

- [ ] Write failing pagination, API, and panel contract tests.
- [ ] Run tests and confirm pagination is missing.
- [ ] Implement snapshot pagination and query parsing.
- [ ] Request ten items on the page and add a load-more command in the panel.
- [ ] Keep one-minute refresh scoped to the currently requested limit.
- [ ] Run tests and confirm they pass.

### Task 5: Route Loading Feedback

**Files:**
- Create: `src/components/workspace-route-loading.tsx`
- Create: `src/app/loading.tsx`
- Create: `src/app/holding/loading.tsx`
- Create: `src/app/stocks/loading.tsx`
- Create: `src/app/douyin/loading.tsx`
- Test: `src/components/workspace-route-loading.test.mjs`

**Interfaces:**
- Produces `WorkspaceRouteLoading` with stable panel skeletons.

- [ ] Write a failing contract test for all route fallbacks.
- [ ] Run it and confirm loading files are missing.
- [ ] Implement the shared fallback and four route files.
- [ ] Run the contract test and confirm it passes.

### Task 6: Full Verification And Deployment

**Files:**
- Verify all modified files.

- [ ] Run targeted tests for Tasks 1-5.
- [ ] Run `node scripts/run-tests.mjs` and confirm all files pass.
- [ ] Run ESLint and confirm zero errors.
- [ ] Run the production Next.js build and confirm success.
- [ ] Commit and push the implementation.
- [ ] Deploy through `ssh signal-hub-vps`.
- [ ] Re-measure production page/API payloads and verify service health.
