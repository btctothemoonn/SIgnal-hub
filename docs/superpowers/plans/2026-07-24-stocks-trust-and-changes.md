# Stocks Trust And Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stocks data freshness trustworthy and add a compact queue that highlights material changes across the research pool.

**Architecture:** Keep the existing market, financial, catalyst, report, and summary APIs. Add pure rule helpers for dynamic earnings state and change ranking, make snapshot cache reads refresh stale data with stale fallback, and expose cache health in existing snapshots so the UI can show actionable status.

**Tech Stack:** Next.js App Router, React, TypeScript, Node SQLite/cache files, Node assertion tests.

## Global Constraints

- Do not remove existing Stocks features or change Signal Flow.
- Do not add paid providers or trigger bulk historical API backfills.
- Keep deterministic ranking rules independent from AI availability.
- Preserve stale data as a fallback when upstream refresh fails.

---

### Task 1: Dynamic earnings state

**Files:**
- Modify: `src/lib/stocks-intelligence.ts`
- Modify: `src/lib/stocks-financial-data.ts`
- Test: `src/lib/stocks-intelligence.test.mjs`
- Test: `src/lib/stocks-financial-data.test.mjs`

**Interfaces:**
- Produces: `resolveEarningsStatus(nextEarningsDate, now)` returning the existing `AlphaResearchEarningsStatus`.
- Consumes: financial `nextEarningsDate` and current time.

- [x] Add failing tests for upcoming, recent, watch, quiet, and invalid dates.
- [x] Run the focused tests and confirm they fail because the resolver is missing.
- [x] Implement the resolver and apply it when live financial data is merged.
- [x] Run focused tests and confirm they pass.

### Task 2: Stale cache self-healing and health metadata

**Files:**
- Modify: `src/lib/stocks-prewarm.ts`
- Test: `src/lib/stocks-prewarm.test.mjs`

**Interfaces:**
- Produces: stale-aware `getCachedStocksSnapshot()` behavior.
- Produces: `getStocksSnapshotHealth(kind, snapshot, env, now)` with age, stale state, and max age.

- [x] Add failing tests proving fresh cache avoids a loader call, stale cache refreshes, and stale cache survives an upstream failure.
- [x] Run the focused test and confirm stale cache currently skips refresh.
- [x] Implement age-aware reads and fallback behavior without changing API response structures.
- [x] Run the focused test and confirm it passes.

### Task 3: Today changes queue

**Files:**
- Create: `src/lib/stocks-changes.ts`
- Create: `src/lib/stocks-changes.test.mjs`
- Create: `src/components/stocks-today-changes.tsx`
- Create: `src/components/stocks-today-changes.test.mjs`
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`

**Interfaces:**
- Produces: `buildStocksTodayChanges(stocks, options)` returning ranked deterministic change items.
- Consumes: merged market, financial, catalyst, and subscription data already present on `AlphaResearchStock`.
- Produces: `StocksTodayChanges` UI with ticker navigation into the existing research detail.

- [x] Add failing rules tests for new catalyst, earnings proximity, strong move, risk move, and data staleness.
- [x] Add failing component contract tests for rendering and ticker navigation.
- [x] Implement the pure ranking helper with a capped result list and reason labels.
- [x] Implement the compact queue above the existing research layout.
- [x] Run focused tests and confirm they pass.

### Task 4: Verification

**Files:**
- Verify only.

- [x] Run all Stocks and alpha summary tests.
- [x] Run `npm run build`.
- [x] Start the local app and verify desktop and mobile Stocks layouts.
- [x] Review the diff for accidental Signal Flow or secret changes.
- [ ] Commit, push GitHub, deploy VPS, and verify the public Stocks page.
