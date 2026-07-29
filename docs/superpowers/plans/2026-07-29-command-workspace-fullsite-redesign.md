# Signal Hub Command Workspace Full-Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every Signal Hub route to the approved Command Workspace design while preserving all existing features, data contracts, state behavior, and background services.

**Architecture:** Establish semantic theme tokens and a compact shared AppShell first, then migrate each route's layout without moving business logic out of its existing feature components. Use source-contract tests to lock the intended visual structure, preserve existing behavioral tests, and complete the release with dark/light desktop/mobile browser verification.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, `lucide-react`, Node source-contract tests, ESLint, existing browser verification tooling.

## Global Constraints

- Preserve all existing routes, data sources, workers, caches, APIs, authentication behavior, and business logic.
- Do not remove navigation destinations, filters, refresh actions, reports, charts, translations, holdings sources, or failure fallbacks.
- Use the Command Workspace visual direction with adaptive density by page.
- Dark theme is primary; light theme remains complete and functional.
- Signal and Holding use compact density; Stocks uses medium density; reports, long summaries, and settings retain readable spacing.
- Standard card radius is `6px`.
- Do not place cards inside cards or style full page sections as floating cards.
- Use `lucide-react` for navigation and interface icons; it is the only permitted new presentation dependency.
- Keep letter spacing at zero and do not scale font size with viewport width.
- Mobile page-level horizontal overflow is forbidden; horizontal movement is allowed only in explicit module pagers and tab strips.
- Do not deploy a partially restyled production site.
- Design specification: `docs/superpowers/specs/2026-07-29-command-workspace-fullsite-redesign-design.md`.

---

### Task 1: Add The Command Workspace Design Foundation

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app/globals.css`
- Modify: `src/lib/ui-theme-contract.test.mjs`
- Modify: `src/app/mobile-command-theme.test.mjs`

**Interfaces:**
- Consumes: existing Tailwind theme aliases such as `bg-background`, `bg-panel`, `border-line`, `text-muted`, and `text-accent`.
- Produces: semantic CSS tokens `--workspace-canvas`, `--workspace-rail`, `--workspace-surface`, `--workspace-surface-raised`, `--workspace-toolbar`, `--workspace-line-strong`, `--workspace-radius`, `--workspace-gutter`, and their Tailwind color aliases.

- [ ] **Step 1: Add failing design-token assertions**

Add these assertions to `src/lib/ui-theme-contract.test.mjs`:

```js
await test("command workspace tokens define dark and light operational surfaces", () => {
  assert.match(globals, /--workspace-canvas:/);
  assert.match(globals, /--workspace-rail:/);
  assert.match(globals, /--workspace-surface:/);
  assert.match(globals, /--workspace-surface-raised:/);
  assert.match(globals, /--workspace-toolbar:/);
  assert.match(globals, /--workspace-line-strong:/);
  assert.match(globals, /--workspace-radius:\s*6px;/);
  assert.match(globals, /--workspace-gutter:/);
  assert.match(
    globals,
    /html\.dark\s*\{[\s\S]*--workspace-canvas:/,
  );
  assert.match(globals, /--color-workspace-canvas:/);
  assert.doesNotMatch(globals, /letter-spacing:\s*-/);
});
```

Update `src/app/mobile-command-theme.test.mjs` to assert the new canvas and rail
tokens while retaining the existing no-gradient and no-warm-beige checks.

- [ ] **Step 2: Run the theme tests and verify RED**

Run:

```powershell
node src/lib/ui-theme-contract.test.mjs
node src/app/mobile-command-theme.test.mjs
```

Expected: FAIL because the workspace tokens do not exist.

- [ ] **Step 3: Install Lucide and define the semantic theme**

Run:

```powershell
pnpm add lucide-react
```

In `src/app/globals.css`:

- Define all produced tokens in `:root` for the light theme.
- Override each token in `html.dark` for the primary dark theme.
- Map the surface tokens in `@theme inline`.
- Preserve existing status tokens and fonts.
- Keep `body { overflow-x: hidden; letter-spacing: 0; }`.
- Do not add gradients, decorative blobs, negative letter spacing, or viewport-scaled font sizes.

- [ ] **Step 4: Run the foundation tests**

Run:

```powershell
node src/lib/ui-theme-contract.test.mjs
node src/app/mobile-command-theme.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Lint the changed foundation files**

Run:

```powershell
pnpm exec eslint src/app/globals.css src/lib/ui-theme-contract.test.mjs src/app/mobile-command-theme.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml src/app/globals.css src/lib/ui-theme-contract.test.mjs src/app/mobile-command-theme.test.mjs
git commit -m "Build command workspace design foundation"
```

---

### Task 2: Redesign The Shared AppShell

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/theme-toggle.tsx`
- Modify: `src/components/app-shell.test.mjs`
- Modify: `src/lib/ui-theme-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 workspace tokens and `lucide-react`.
- Produces: stable attributes `data-workspace-shell`, `data-workspace-rail`, `data-workspace-topbar`, and the existing `data-mobile-command-shell`.
- Preserves: `AppShellNavKey`, `AppShellStatusPill`, `pendingNav`, route prefetch, mobile bottom navigation, theme toggle, and POST logout.

- [ ] **Step 1: Update AppShell contract tests before implementation**

Add assertions to `src/components/app-shell.test.mjs`:

```js
assert.match(source, /data-workspace-shell/);
assert.match(source, /data-workspace-rail/);
assert.match(source, /data-workspace-topbar/);
assert.match(source, /from "lucide-react"/);
assert.doesNotMatch(source, /function ShellGlyph/);
assert.match(source, /grid-cols-5/);
assert.match(source, /fixed bottom-0/);
assert.match(source, /pb-20 lg:pb-0/);
```

Update the AppShell assertion in `src/lib/ui-theme-contract.test.mjs` to require:

```js
assert.match(appShell, /bg-workspace-rail/);
assert.match(appShell, /bg-workspace-toolbar/);
assert.match(appShell, /border-accent\/40 bg-accent-soft text-accent/);
assert.doesNotMatch(appShell, /font-serif/);
```

Keep every optimistic-navigation assertion already present.

- [ ] **Step 2: Run the AppShell tests and verify RED**

Run:

```powershell
node src/components/app-shell.test.mjs
node src/lib/ui-theme-contract.test.mjs
```

Expected: FAIL on the new attributes and Lucide import.

- [ ] **Step 3: Replace hand-drawn glyphs and rebuild the desktop shell**

In `src/components/app-shell.tsx`:

- Import `Activity`, `WalletCards`, `ChartNoAxesCombined`, `Clapperboard`,
  `Settings`, and `LogOut` from `lucide-react`.
- Replace `ShellGlyph` SVG branches with a typed icon map.
- Add `data-workspace-shell` to the outer shell.
- Use a stable compact desktop rail with icon plus Chinese label.
- Add `data-workspace-rail` to the rail and `data-workspace-topbar` to the top bar.
- Keep active navigation gold, low-saturation, and border-based.
- Reduce top-bar content to title, actionable status, theme, settings, and logout.
- Keep the existing route prefetch and pending-navigation implementation exactly functional.
- Keep the mobile bottom navigation five columns wide and safe-area aware.

In `src/components/theme-toggle.tsx`, use `Sun`, `Moon`, and `Monitor` from
`lucide-react` with an accessible label and stable icon-button dimensions.

- [ ] **Step 4: Run AppShell tests**

Run:

```powershell
node src/components/app-shell.test.mjs
node src/lib/ui-theme-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run focused lint**

Run:

```powershell
pnpm exec eslint src/components/app-shell.tsx src/components/theme-toggle.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/app-shell.tsx src/components/theme-toggle.tsx src/components/app-shell.test.mjs src/lib/ui-theme-contract.test.mjs
git commit -m "Redesign Signal Hub application shell"
```

---

### Task 3: Convert Signal Into The Adaptive Command Workspace

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/signals-responsive-layout.tsx`
- Modify: `src/components/unified-news-panel.tsx`
- Modify: `src/components/signal-feed-floating-navigation.tsx`
- Modify: `src/app/homepage-mobile-layout.test.mjs`
- Modify: `src/components/signals-responsive-layout.test.mjs`
- Modify: `src/components/unified-news-panel-mobile.test.mjs`
- Modify: `src/components/signal-feed-floating-navigation.test.mjs`

**Interfaces:**
- Consumes: redesigned `AppShell`, existing `SignalsResponsiveLayout` inputs, existing Signal feed and summary APIs.
- Produces: `data-signal-workspace`, `data-signal-toolbar`, `data-signal-feed-pane`, and `data-signal-summary-pane`.
- Preserves: mobile two-panel swipe behavior, module-top scrolling, previous feed scroll restoration, last-read anchors, newest/last-read/oldest actions, author favorites, filters, translations, quote content, and non-jumping realtime inserts.

- [ ] **Step 1: Add failing Signal layout assertions**

Add to `src/components/signals-responsive-layout.test.mjs`:

```js
assert.match(component, /data-signal-workspace/);
assert.match(component, /data-signal-feed-pane/);
assert.match(component, /data-signal-summary-pane/);
assert.match(
  component,
  /lg:grid-cols-\[minmax\(0,7fr\)_minmax\(20rem,3fr\)\]/,
);
assert.match(component, /mobilePagerRef\.current\?\.scrollIntoView/);
assert.match(component, /window\.scrollTo\(\{\s*top: returnScrollY/);
```

Add to `src/components/unified-news-panel-mobile.test.mjs`:

```js
assert.match(source, /data-signal-toolbar/);
assert.match(source, /data-signal-feed-pane/);
assert.match(source, /rounded-\[6px\]/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
```

Keep all existing behavior assertions.

- [ ] **Step 2: Run Signal tests and verify RED**

Run:

```powershell
node src/app/homepage-mobile-layout.test.mjs
node src/components/signals-responsive-layout.test.mjs
node src/components/unified-news-panel-mobile.test.mjs
node src/components/unified-news-panel-reading-position.test.mjs
node src/components/signal-feed-floating-navigation.test.mjs
```

Expected: new layout assertions FAIL; existing behavior tests remain green.

- [ ] **Step 3: Implement the 70/30 desktop layout and compact toolbar**

In `src/components/signals-responsive-layout.tsx`:

- Add the new workspace and pane attributes.
- Change the desktop grid to a 70/30 layout with a minimum 20rem summary rail.
- Keep the summary sticky and independently scrollable.
- Keep the exact mobile pager state and scroll-restoration behavior.
- Replace decorative shadows and large radii with workspace surfaces and 6px radii.

In `src/components/unified-news-panel.tsx`:

- Consolidate search, source tabs, range, author/channel filter, favorites, and
  refresh status into one wrapping `data-signal-toolbar`.
- Remove duplicated informational status text, but retain failure, stale, and
  actionable refresh indicators.
- Tighten message spacing while preserving every content field and action.
- Keep quote and translation blocks readable and untruncated.

In `src/components/signal-feed-floating-navigation.tsx`:

- Use Lucide `ArrowUpToLine`, `Bookmark`, and `ArrowDownToLine`.
- Preserve the existing three actions and their accessibility labels.
- Use a narrow edge-mounted vertical control on desktop and a safe-area-aware
  compact control on mobile.

- [ ] **Step 4: Run all focused Signal tests**

Run the five commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Lint Signal files**

Run:

```powershell
pnpm exec eslint src/app/page.tsx src/components/signals-responsive-layout.tsx src/components/unified-news-panel.tsx src/components/signal-feed-floating-navigation.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/page.tsx src/components/signals-responsive-layout.tsx src/components/unified-news-panel.tsx src/components/signal-feed-floating-navigation.tsx src/app/homepage-mobile-layout.test.mjs src/components/signals-responsive-layout.test.mjs src/components/unified-news-panel-mobile.test.mjs src/components/signal-feed-floating-navigation.test.mjs
git commit -m "Apply command workspace layout to Signal"
```

---

### Task 4: Redesign Holding Without Changing Portfolio Logic

**Files:**
- Modify: `src/app/holding/page.tsx`
- Modify: `src/components/holding-panel.tsx`
- Modify: `src/components/us-stock-holding-panel.tsx`
- Modify: `src/components/holding-panel.test.mjs`
- Modify: `src/components/us-stock-holding-panel.test.mjs`

**Interfaces:**
- Consumes: all existing Binance, Tiger, and tracked holdings snapshots.
- Produces: `data-holding-workspace`, `data-holding-metric-strip`, `data-holding-position-grid`, and `data-holding-view-tabs`.
- Preserves: API refresh intervals, lazy navigation load, equity history, tracked account funding, Binance spot/futures data, Tiger cards, sector classifications, and removed-module exclusions.

- [ ] **Step 1: Add failing Holding layout assertions**

Add to `src/components/holding-panel.test.mjs`:

```js
assert.match(source, /data-holding-workspace/);
assert.match(source, /data-holding-view-tabs/);
assert.match(source, /data-holding-metric-strip/);
assert.match(source, /data-holding-position-grid/);
assert.match(source, /rounded-\[6px\]/);
```

Add to `src/components/us-stock-holding-panel.test.mjs`:

```js
assert.match(source, /data-us-holding-summary/);
assert.match(source, /data-us-position-card/);
assert.match(source, /formatSignedPercent\(card\.unrealizedPnlPercent\)/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
```

Keep assertions that heatmap, treemap, allocation, and duplicate detail tables
remain absent.

- [ ] **Step 2: Run Holding tests and verify RED**

Run:

```powershell
node src/components/holding-panel.test.mjs
node src/components/us-stock-holding-panel.test.mjs
node src/lib/holding-navigation-performance.test.mjs
```

Expected: new layout attributes FAIL.

- [ ] **Step 3: Implement the Holding workspace**

In `src/components/holding-panel.tsx`:

- Make Binance, US securities, and tracked accounts a stable peer tab control.
- Put total equity, PnL, PnL percentage, risk, and update time in one compact metric strip.
- Use a responsive position grid with dense desktop cards and readable mobile cards.
- Align quantity, cost, price, weight, fee/funding, PnL, and PnL percentage.
- Keep equity curves unframed at the same hierarchy as positions.
- Preserve all load and refresh logic.

In `src/components/us-stock-holding-panel.tsx`:

- Apply the same visual contract to Tiger summary and position cards.
- Keep options distinguishable from shares without adding a separate risk strip.
- Keep ARM in semiconductors and NOK in optical communications through the existing classification data.

- [ ] **Step 4: Run Holding tests**

Run the three commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Lint Holding files**

Run:

```powershell
pnpm exec eslint src/app/holding/page.tsx src/components/holding-panel.tsx src/components/us-stock-holding-panel.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/holding/page.tsx src/components/holding-panel.tsx src/components/us-stock-holding-panel.tsx src/components/holding-panel.test.mjs src/components/us-stock-holding-panel.test.mjs
git commit -m "Apply command workspace layout to Holding"
```

---

### Task 5: Rebuild The Stocks Workspace Hierarchy

**Files:**
- Modify: `src/app/stocks/page.tsx`
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-sector-list.tsx`
- Modify: `src/components/stocks-performance-chart.tsx`
- Modify: `src/components/stocks-hynix-premium-curve.tsx`
- Modify: `src/components/stocks-research-layout.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/alpha-sector-list-layout.test.mjs`
- Modify: `src/components/stocks-performance-chart.test.mjs`
- Modify: `src/components/stocks-hynix-premium-curve.test.mjs`
- Modify: `src/components/stocks-research-layout.test.mjs`

**Interfaces:**
- Consumes: existing market, financial, catalyst, performance, Hynix premium,
  funding, report, summary, and research-state data.
- Produces: `data-stocks-workspace`, `data-stocks-health-strip`,
  `data-stocks-chart-band`, and `data-stocks-research-split`.
- Preserves: current API endpoints, browser caches, selected sector/ticker,
  research-state persistence, start-date behavior, chart controls, and mobile
  paging.

- [ ] **Step 1: Add failing Stocks hierarchy assertions**

Add to `src/components/alpha-research-page.test.mjs`:

```js
assert.match(source, /data-stocks-workspace/);
assert.match(source, /data-stocks-health-strip/);
assert.match(source, /data-stocks-chart-band/);
assert.match(source, /data-stocks-research-split/);
assert.match(source, /snapshotIssueLabel/);
assert.match(source, /performanceIssueLabel/);
```

Add to `src/components/stocks-research-layout.test.mjs`:

```js
assert.match(source, /data-stocks-research-split/);
assert.match(source, /lg:grid-cols-\[minmax\(18rem,0\.34fr\)_minmax\(0,0\.66fr\)\]/);
assert.match(source, /data-mobile-stocks-pager/);
```

Add chart assertions that each chart root has a stable `min-h-*` or explicit
height class and `rounded-[6px]`.

- [ ] **Step 2: Run Stocks workspace tests and verify RED**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-sector-list-layout.test.mjs
node src/components/stocks-performance-chart.test.mjs
node src/components/stocks-hynix-premium-curve.test.mjs
node src/components/stocks-research-layout.test.mjs
```

Expected: new hierarchy assertions FAIL.

- [ ] **Step 3: Implement Stocks health, charts, pool, and split layout**

In `src/components/alpha-research-page.tsx`:

- Compress healthy providers into one health strip.
- Keep failure, stale, fallback, and retry states prominent.
- Create a stable chart band for relative performance and Hynix premium/funding.
- Keep subscription reports as a first-class Stocks tab.

In `src/components/stocks-research-layout.tsx` and
`src/components/alpha-sector-list.tsx`:

- Widen the desktop pool to at least 18rem.
- Keep stock names, prices, tags, and research states readable.
- Retain mobile module paging instead of compressing columns.

In both chart components:

- Use stable chart dimensions.
- Preserve controls, zoom, alert behavior, funding data, labels, and interval state.
- Remove oversized outer padding and decorative shadow.
- Keep endpoint labels non-overlapping.

- [ ] **Step 4: Run Stocks workspace tests**

Run the five commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Lint Stocks workspace files**

Run:

```powershell
pnpm exec eslint src/app/stocks/page.tsx src/components/alpha-research-page.tsx src/components/alpha-sector-list.tsx src/components/stocks-performance-chart.tsx src/components/stocks-hynix-premium-curve.tsx src/components/stocks-research-layout.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/stocks/page.tsx src/components/alpha-research-page.tsx src/components/alpha-sector-list.tsx src/components/stocks-performance-chart.tsx src/components/stocks-hynix-premium-curve.tsx src/components/stocks-research-layout.tsx src/components/alpha-research-page.test.mjs src/components/alpha-sector-list-layout.test.mjs src/components/stocks-performance-chart.test.mjs src/components/stocks-hynix-premium-curve.test.mjs src/components/stocks-research-layout.test.mjs
git commit -m "Rebuild Stocks command workspace hierarchy"
```

---

### Task 6: Reorder Stock Intelligence And Research Detail

**Files:**
- Modify: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/stocks-subscription-reports.tsx`
- Modify: `src/components/stocks-research-state-panel.tsx`
- Modify: `src/components/stocks-today-changes.tsx`
- Modify: `src/components/alpha-stock-detail.test.mjs`
- Modify: `src/components/stocks-subscription-reports.test.mjs`
- Modify: `src/components/stocks-research-state-panel.test.mjs`
- Modify: `src/components/stocks-today-changes.test.mjs`

**Interfaces:**
- Consumes: existing `buildStocksIntelligence`, report insight, catalyst display,
  research-state, financial, and market data.
- Produces: `data-stock-intelligence`, `data-stock-primary-context`,
  `data-stock-supporting-research`, and `data-subscription-report`.
- Preserves: deterministic fallback, missing-field `n/a`, report expansion,
  original links, catalyst limits, and research-state transitions.

- [ ] **Step 1: Add failing detail hierarchy assertions**

Add to `src/components/alpha-stock-detail.test.mjs`:

```js
assert.match(source, /data-stock-intelligence/);
assert.match(source, /data-stock-primary-context/);
assert.match(source, /data-stock-supporting-research/);
assert.match(source, /tickerContext/);
assert.match(source, /earningsBrief/);
assert.match(source, /riskTags/);
assert.match(source, /structure/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
```

Add to `src/components/stocks-subscription-reports.test.mjs`:

```js
assert.match(source, /data-subscription-report/);
assert.match(source, /summaryStatus/);
assert.match(source, /sourceUrl/);
```

Keep existing summary/fallback assertions.

- [ ] **Step 2: Run detail tests and verify RED**

Run:

```powershell
node src/components/alpha-stock-detail.test.mjs
node src/components/stocks-subscription-reports.test.mjs
node src/components/stocks-research-state-panel.test.mjs
node src/components/stocks-today-changes.test.mjs
```

Expected: new hierarchy assertions FAIL.

- [ ] **Step 3: Implement first-viewport intelligence and supporting research**

In `src/components/alpha-stock-detail.tsx`:

- Put price, daily move, seven-day strength, freshness, earnings window,
  structure, impact/risk tags, and core driver first.
- Keep `Ticker Intelligence`, `Earnings Brief`, and deterministic structure visible without AI.
- Move raw financial tables, long catalysts, and long news below the primary context.
- Keep desktop research/support columns and stack them on mobile.

In `src/components/stocks-subscription-reports.tsx`:

- Give summaries more space than metadata.
- Show core conclusion, related tickers, direction, impact chain, risks, and
  original link.
- Mark summary generation failure explicitly and retain original content.

Apply the same compact command-workspace controls to research-state and
today-changes components without changing their transitions or ranking logic.

- [ ] **Step 4: Run detail tests**

Run the four commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Lint detail files**

Run:

```powershell
pnpm exec eslint src/components/alpha-stock-detail.tsx src/components/stocks-subscription-reports.tsx src/components/stocks-research-state-panel.tsx src/components/stocks-today-changes.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/alpha-stock-detail.tsx src/components/stocks-subscription-reports.tsx src/components/stocks-research-state-panel.tsx src/components/stocks-today-changes.tsx src/components/alpha-stock-detail.test.mjs src/components/stocks-subscription-reports.test.mjs src/components/stocks-research-state-panel.test.mjs src/components/stocks-today-changes.test.mjs
git commit -m "Prioritize actionable Stocks intelligence"
```

---

### Task 7: Redesign Douyin As A Research Feed

**Files:**
- Modify: `src/app/douyin/page.tsx`
- Modify: `src/components/douyin-monitor-panel.tsx`
- Modify: `src/app/douyin/page.test.mjs`
- Modify: `src/components/douyin-monitor-panel.test.mjs`

**Interfaces:**
- Consumes: current Douyin snapshot, refresh endpoint, video links, summaries,
  transcription state, and A-share extraction.
- Produces: `data-douyin-workspace`, `data-douyin-toolbar`,
  `data-douyin-video-list`, and `data-douyin-video`.
- Preserves: direct video opening, newest-first order, manual refresh,
  limited-content state, error display, and summary fallback.

- [ ] **Step 1: Add failing Douyin layout assertions**

Add to `src/components/douyin-monitor-panel.test.mjs`:

```js
assert.match(source, /data-douyin-workspace/);
assert.match(source, /data-douyin-toolbar/);
assert.match(source, /data-douyin-video-list/);
assert.match(source, /data-douyin-video/);
assert.match(source, /lg:grid-cols-\[minmax\(16rem,0\.34fr\)_minmax\(0,0\.66fr\)\]/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);
```

Keep the direct image/title link assertions.

- [ ] **Step 2: Run Douyin tests and verify RED**

Run:

```powershell
node src/app/douyin/page.test.mjs
node src/components/douyin-monitor-panel.test.mjs
node src/lib/douyin-monitor.test.mjs
```

Expected: new layout assertions FAIL.

- [ ] **Step 3: Implement the Douyin research layout**

- Compress creator, status, last update, and refresh into one toolbar.
- Use a desktop 34/66 media-to-summary layout.
- Prioritize A-share names, sectors, recommendation logic, catalyst, risk, and
  follow-up items.
- Stack cover, metadata, and summary on mobile.
- Keep title and cover as direct links.
- Preserve error and limited-content markers.

- [ ] **Step 4: Run Douyin tests**

Run the three commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run:

```powershell
pnpm exec eslint src/app/douyin/page.tsx src/components/douyin-monitor-panel.tsx
git add src/app/douyin/page.tsx src/components/douyin-monitor-panel.tsx src/app/douyin/page.test.mjs src/components/douyin-monitor-panel.test.mjs
git commit -m "Redesign Douyin research feed"
```

Expected: lint PASS and commit succeeds.

---

### Task 8: Redesign Settings And Login

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/system-health-panel.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/login-form.tsx`
- Modify: `src/app/settings/settings-health-tab.test.mjs`
- Modify: `src/components/system-health-panel.test.mjs`
- Create: `src/app/login/login-layout.test.mjs`

**Interfaces:**
- Consumes: existing settings actions, runtime configuration, system health,
  login POST endpoint, error query values, and lockout behavior.
- Produces: `data-settings-workspace`, `data-settings-category-tabs`,
  `data-settings-editor`, and `data-login-workspace`.
- Preserves: all settings actions, secret masking, validation, admin login,
  next-path normalization, errors, and rate limiting.

- [ ] **Step 1: Add failing Settings and Login tests**

Add to `src/app/settings/settings-health-tab.test.mjs`:

```js
assert.match(source, /data-settings-workspace/);
assert.match(source, /data-settings-category-tabs/);
assert.match(source, /data-settings-editor/);
assert.match(source, /lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);
assert.match(source, /overflow-x-auto/);
```

Create `src/app/login/login-layout.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

assert.match(page, /data-login-workspace/);
assert.match(page, /Signal Hub/);
assert.doesNotMatch(page, /landing|hero|marketing/i);
assert.match(form, /action="\/api\/login"/);
assert.match(form, /autoComplete="current-password"/);
assert.match(form, /rounded-\[6px\]/);
assert.match(form, /text-danger/);

console.log("ok - login command workspace layout");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node src/app/settings/settings-health-tab.test.mjs
node src/components/system-health-panel.test.mjs
node src/app/login/login-layout.test.mjs
node src/app/api/login/route.test.mjs
```

Expected: new layout assertions FAIL; API test stays green.

- [ ] **Step 3: Implement Settings categories and focused editor**

In `src/app/settings/page.tsx`:

- Use a 15rem desktop category rail and focused editor.
- Keep mobile categories in an explicit horizontally scrolling tab strip.
- Keep Telegram, X, Douyin, AI, health, and general settings separate.
- Show secret configuration state only; never render secret values.
- Standardize save, test, retry, and remove controls with Lucide icons.

In `src/components/system-health-panel.tsx`, align service status, last check,
error details, and retry without changing health evaluation.

- [ ] **Step 4: Implement the simple login workspace**

In login files:

- Keep a centered single-purpose surface with Signal Hub identity.
- Use the shared workspace tokens and 6px radius.
- Keep password input, submit, error text, lockout behavior, and next path.
- Do not add explanatory marketing content.

- [ ] **Step 5: Run tests**

Run the four commands from Step 2.

Expected: PASS.

- [ ] **Step 6: Lint and commit**

Run:

```powershell
pnpm exec eslint src/app/settings/page.tsx src/components/system-health-panel.tsx src/app/login/page.tsx src/app/login/login-form.tsx
git add src/app/settings/page.tsx src/components/system-health-panel.tsx src/app/login/page.tsx src/app/login/login-form.tsx src/app/settings/settings-health-tab.test.mjs src/components/system-health-panel.test.mjs src/app/login/login-layout.test.mjs
git commit -m "Redesign Settings and login workspace"
```

Expected: lint PASS and commit succeeds.

---

### Task 9: Complete Responsive, Theme, And Visual Verification

**Files:**
- Modify as defects require: files changed in Tasks 1-8
- Modify: affected source-contract tests only when the intended design contract
  was implemented differently and the specification still holds

**Interfaces:**
- Consumes: complete redesigned site.
- Produces: verified dark/light desktop/mobile behavior without overlap,
  clipping, accidental horizontal scroll, or feature loss.

- [ ] **Step 1: Start the local production-equivalent app**

Run:

```powershell
pnpm run build
pnpm start
```

Expected: build succeeds and the local server starts on an available port.

- [ ] **Step 2: Verify dark desktop at 1440x900**

Inspect:

- `/`
- `/holding`
- `/stocks`
- `/douyin`
- `/settings`
- `/login`

For each route confirm:

- Navigation and top bar are stable.
- Primary content fits without page-level horizontal scrolling.
- No nested cards or oversized radii remain.
- Long names, translations, report titles, tags, and values do not overlap.
- Sticky regions do not cover content.
- Loading and stale states retain existing data.

- [ ] **Step 3: Verify light desktop at 1440x900**

Switch to light theme and repeat the six-route inspection. Confirm all text,
borders, selected states, status colors, charts, and controls remain legible.

- [ ] **Step 4: Verify mobile at 390x844 and 430x932**

At both viewports confirm:

- Bottom navigation respects safe areas and does not shift.
- Signal swipe, tabs, and top-of-module behavior work.
- Signal floating navigation does not cover message actions.
- Holding position values wrap without clipping.
- Stocks mobile pager does not compress pool and detail into one narrow row.
- Douyin media and summary stack.
- Settings category strip scrolls independently.
- No route has page-level horizontal overflow.

- [ ] **Step 5: Fix discovered visual defects with focused regression tests**

For each defect:

1. Add or tighten the nearest source-contract test.
2. Run it and observe failure.
3. Make the smallest layout correction.
4. Re-run the focused test.
5. Recheck the affected viewport.

- [ ] **Step 6: Commit responsive polish**

```powershell
git add src
git commit -m "Polish command workspace responsive layouts"
```

Skip this commit only if Step 5 required no changes.

---

### Task 10: Full Verification, Review, Push, And VPS Deployment

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Produces: one GitHub and VPS commit containing the entire redesign.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
pnpm test
```

Expected: all test files pass.

- [ ] **Step 2: Run full lint**

Run:

```powershell
pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Run a clean production build**

Run:

```powershell
pnpm run build
```

Expected: Next.js build and TypeScript complete successfully.

- [ ] **Step 4: Review scope**

Run:

```powershell
git diff 9bb6c43..HEAD --stat
git status --short
```

Expected:

- Only UI, tests, package dependency, and approved design/plan files changed.
- No API, worker, secret, runtime cache, or database files changed.
- Worktree is clean after all commits.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` against the complete commit range.
Resolve blocking findings and rerun affected tests.

- [ ] **Step 6: Push the complete release**

```powershell
git push origin main
```

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 7: Deploy the same commit to VPS**

Run the repository deployment process:

```bash
cd /home/ubuntu/signal-hub
bash scripts/deploy-vps.sh
```

Expected: remote tests, lint, build, and service restart succeed.

- [ ] **Step 8: Verify production**

Confirm:

- VPS commit equals GitHub `main`.
- `signal-hub-web` and all existing workers are active.
- `/login` returns HTTP 200.
- Signal, Holding, Stocks, Douyin, and Settings render in production.
- No background worker or data-source behavior changed.
