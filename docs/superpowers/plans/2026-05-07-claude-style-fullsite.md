# Claude-Style Full-Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Signal Hub's full UI to a Claude-inspired warm, paper-like design system while preserving existing behavior.

**Architecture:** Centralize the redesign in Tailwind CSS variables and shared AppShell structure, then update settings and high-impact dashboard surfaces that own explicit styles. Use a UI theme contract test to catch old style regressions and verify that the core style markers are present.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, TypeScript, Node `.mjs` smoke tests.

---

### Task 1: Add UI Theme Contract Test

**Files:**
- Create: `src/lib/ui-theme-contract.test.mjs`

- [ ] **Step 1: Write the failing test**

Create a Node test that reads `src/app/globals.css`, `src/components/app-shell.tsx`, and `src/app/settings/page.tsx`. Assert that the new warm background token, terracotta accent token, serif font token, AppShell accent active state, AppShell serif heading, and settings page redesigned max width are present.

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/lib/ui-theme-contract.test.mjs`

Expected before implementation: FAIL because the old CSS and components do not contain the new contract markers.

### Task 2: Redesign Global Theme

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace light and dark CSS variables**

Use warm paper colors for `--background`, `--panel`, `--panel-strong`, `--muted`, `--line`, and terracotta for `--accent`. Keep semantic colors for success, warning, danger, and info.

- [ ] **Step 2: Add serif font token**

Add `--app-font-serif` and expose it in `@theme inline` as `--font-serif`.

- [ ] **Step 3: Replace grid background**

Use a simple warm paper gradient and remove the old grid pattern.

### Task 3: Redesign App Shell

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/theme-toggle.tsx`

- [ ] **Step 1: Update navigation active state**

Change active nav from blue `info` styling to accent styling with restrained borders and paper surfaces.

- [ ] **Step 2: Update logo, sidebar, header, status pills, and page title**

Use low-radius paper surfaces, ink logo, serif title, and subtle warm shadows.

- [ ] **Step 3: Update theme toggle**

Replace the old pill styling with a compact paper button using clear theme labels.

### Task 4: Redesign Full-Site Page Surfaces

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/holding-panel.tsx`
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-summary-card.tsx`
- Modify: `src/components/unified-news-panel.tsx`

- [ ] **Step 1: Settings page**

Apply the same warm shell style to settings: max width, serif title, low-radius panels, rectangular inputs/buttons, and paper list rows.

- [ ] **Step 2: Holding page**

Tune chart colors and summary surfaces to match the warm semantic palette.

- [ ] **Step 3: Stocks and signals pages**

Adjust top-level panels and AI summary surfaces so they read as paper sections instead of glass/blue dashboard widgets.

### Task 5: Clean Preview Artifact and Verify

**Files:**
- Delete: `public/claude-style-options.html`

- [ ] **Step 1: Remove temporary mockup route**

Delete the preview HTML from `public`.

- [ ] **Step 2: Run contract test**

Run: `node src/lib/ui-theme-contract.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run lint/build**

Run the available project verification commands through bundled Node/pnpm. Expected: no TypeScript, lint, or build errors caused by the UI changes.

- [ ] **Step 4: Browser check**

Open the local app and inspect the main pages for coherent Claude-style surfaces, no obvious text overlap, and no stale preview route.
