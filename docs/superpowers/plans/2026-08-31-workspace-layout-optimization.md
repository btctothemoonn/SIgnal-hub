# Signal Hub Workspace Layout Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every primary dashboard reach its useful content sooner and make Signal route transitions responsive without removing features.

**Architecture:** Keep existing page and API boundaries. Add small pure helpers for navigation selection and progressive feed windows, then consume them from the existing client components. Layout changes remain component-local and use the shared workspace tokens already defined in `globals.css`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Node test scripts, Playwright-backed in-app browser verification.

**Spec:** `docs/superpowers/specs/2026-08-31-workspace-layout-optimization-design.md`

## Global Constraints

- Do not remove product features, data sources, filters, histories, charts, saved-reading actions, or Signal mobile swipe behavior.
- Keep the current neutral dark workspace and gold active accent.
- Preserve existing API response shapes.
- Use existing Lucide icons and workspace color tokens.
- Keep mobile controls readable at 390 px and the desktop dashboard usable at 1280 px and wider.

---

### Task 1: Stabilize the time-dependent earnings baseline

**Files:**
- Modify: `src/lib/stocks-financial-data.ts`
- Test: `src/lib/stocks-financial-quarterly.test.mjs`

**Interfaces:**
- Produces: optional `now?: Date` input on `fetchFmpStocksFinancialSnapshot`, defaulting to the current time.

- [x] **Step 1: Pass a fixed date from the existing public-source recovery test.**
- [x] **Step 2: Run the test and verify the existing function ignores the date and fails with `incomplete` instead of `upcoming`.**
- [x] **Step 3: Add the optional clock input and derive `generatedAt` from it.**
- [x] **Step 4: Run the quarterly transport test and verify it passes.**

### Task 2: Compact mobile application chrome

**Files:**
- Create: `src/lib/app-shell-navigation.ts`
- Test: `src/lib/app-shell-navigation.test.mjs`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.mjs`

**Interfaces:**
- Produces: `primaryMobileNavItems<T extends { key: string }>(items: readonly T[]): T[]`, excluding the Settings destination.

- [x] **Step 1: Add a failing behavior test proving Settings is excluded while all five product destinations keep order.**
- [x] **Step 2: Run the helper test and verify the missing module/function failure.**
- [x] **Step 3: Implement the helper and consume it in AppShell.**
- [x] **Step 4: Convert the mobile header to one row, hide the long subtitle below `sm`, and reduce bottom safe-area padding for five items.**
- [x] **Step 5: Run the helper and AppShell tests.**

### Task 3: Progressive Signal feed rendering

**Files:**
- Create: `src/lib/signal-feed-render-window.ts`
- Test: `src/lib/signal-feed-render-window.test.mjs`
- Modify: `src/components/unified-news-panel.tsx`
- Modify: `src/components/unified-news-panel-mobile.test.mjs`
- Modify: `src/components/unified-news-panel-reading-position.test.mjs`

**Interfaces:**
- Produces: `initialSignalFeedRenderCount(total)`, `nextSignalFeedRenderCount(current, total)`, and `signalFeedRenderCountForTarget(items, targetId, current)`.
- The component initially renders 30 filtered items and grows by 30.

- [x] **Step 1: Add failing tests for initial count, bounded increments, and target reveal.**
- [x] **Step 2: Run the tests and verify the helper is missing.**
- [x] **Step 3: Implement the pure render-window helper.**
- [x] **Step 4: Slice the filtered feed by the render count and reset the count when filters change.**
- [x] **Step 5: Add an intersection sentinel and explicit `继续加载` control.**
- [x] **Step 6: Make saved-position and oldest actions reveal their target before scrolling.**
- [x] **Step 7: Run Signal behavior and reading-position tests.**

### Task 4: Compact Hynix market tool

**Files:**
- Modify: `src/components/stocks-hynix-premium-curve.tsx`
- Modify: `src/components/stocks-hynix-premium-curve.test.mjs`
- Modify: `src/components/signals-responsive-layout.tsx`
- Modify: `src/components/signals-responsive-layout.test.mjs`

**Interfaces:**
- Produces: `compactByDefault?: boolean` prop on `StocksHynixPremiumCurve`.

- [x] **Step 1: Add a failing component contract for compact mode and the expand control.**
- [x] **Step 2: Run the component test and verify it fails because compact mode is absent.**
- [x] **Step 3: Add a compact summary row that retains premium, symbols, alert state, and update/error state.**
- [x] **Step 4: Mount the full interval controls, chart, and funding cards only while expanded.**
- [x] **Step 5: Enable compact mode from the Signal layout and run both component tests.**

### Task 5: Tighten Holding, Stocks, and Daily Brief first screens

**Files:**
- Modify: `src/components/holding-panel.tsx`
- Modify: `src/components/holding-panel.test.mjs`
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-sector-list.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/daily-brief-panel.tsx`
- Modify: `src/components/daily-brief-panel.test.mjs`

**Interfaces:**
- Holding keeps the same three account tabs and data payloads.
- Stocks keeps the same pool, performance, detail, earnings, and summary modes.
- Daily Brief keeps all market pulse and watch-list text in an expandable small-screen region.

- [x] **Step 1: Add failing contracts for the compact section headers and mobile expandable context.**
- [x] **Step 2: Run the affected component tests and verify the new contracts fail.**
- [x] **Step 3: Merge repeated Holding headings and reduce mobile header/KPI spacing.**
- [x] **Step 4: Consolidate Stocks status and mode controls, and reduce repeated loading labels.**
- [x] **Step 5: Clamp Daily Brief market context on mobile with an accessible expand button.**
- [x] **Step 6: Run all affected component tests.**

### Task 6: Verify, commit, deploy, and smoke test

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- No public API changes beyond the optional internal test clock.

- [x] **Step 1: Run `pnpm test` and require all test files to pass.**
- [x] **Step 2: Run `pnpm build` and require exit code 0.**
- [x] **Step 3: Start the local app and verify `/`, `/intel`, `/holding`, `/stocks`, and `/douyin` at desktop and 390 x 844.**
- [x] **Step 4: Confirm Signal initially mounts at most 30 articles and the full feed remains reachable.**
- [ ] **Step 5: Commit in two reviewable batches and push `main` to GitHub.**
- [ ] **Step 6: Deploy to the VPS using the repository deploy script, restart services, and verify the public routes.**
