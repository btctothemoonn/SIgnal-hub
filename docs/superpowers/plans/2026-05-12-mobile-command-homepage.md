# Mobile Command Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the logged-in Signal Hub homepage feel like a compact phone-first real-time signal console while preserving existing data, auth, and desktop behavior.

**Architecture:** Keep the current Next.js App Router composition. Use small class and layout changes in `AppShell`, `Home`, `UnifiedNewsPanel`, and global tokens instead of replacing large components. Validate the redesign with source-contract tests before changing production code.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4 tokens, existing `.mjs` assertion tests, Git.

---

## File Structure

- Modify: `src/components/app-shell.test.mjs`
  - Expands shell layout assertions for compact mobile status rail and bottom navigation.
- Create: `src/app/homepage-mobile-layout.test.mjs`
  - Verifies homepage mobile order places AI summary before the feed and keeps desktop two-column behavior.
- Create: `src/components/unified-news-panel-mobile.test.mjs`
  - Verifies feed panel uses the Mobile Command header, status strip, and card hierarchy classes.
- Create: `src/app/mobile-command-theme.test.mjs`
  - Verifies global theme tokens move away from the warm beige layout and expose a darker operational palette.
- Modify: `src/components/app-shell.tsx`
  - Makes the header more compact, status pills mobile-scrollable, and adds fixed mobile bottom navigation.
- Modify: `src/app/page.tsx`
  - Reorders homepage content so AI summary appears first on mobile and remains right rail on desktop.
- Modify: `src/components/unified-news-panel.tsx`
  - Tightens feed panel header, status strip, timeline background, and item card visual hierarchy.
- Modify: `src/app/globals.css`
  - Updates theme tokens and global background for the Mobile Command tone.

Existing unstaged changes outside this plan's deliberate edits must not be staged blindly. At plan-writing time the dirty files include `src/lib/telegram-client-snapshot.test.mjs`, `src/lib/telegram-client-snapshot.ts`, `src/lib/telegram-pipeline-store.ts`, `src/lib/telegram-pipeline-x-source-filter.test.mjs`, and `src/lib/unified-news-panel-contract.test.mjs`. If `src/components/unified-news-panel.tsx` is already dirty when implementation starts, inspect it before editing and preserve the existing changes.

---

### Task 1: Add Mobile Command Contract Tests

**Files:**
- Modify: `src/components/app-shell.test.mjs`
- Create: `src/app/homepage-mobile-layout.test.mjs`
- Create: `src/components/unified-news-panel-mobile.test.mjs`
- Create: `src/app/mobile-command-theme.test.mjs`

- [ ] **Step 1: Update the AppShell failing test**

Replace `src/components/app-shell.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

assert.match(source, /<aside className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:top-0[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:h-screen[^"]*"/);
assert.match(source, /href="\/api\/logout"/);

assert.match(source, /data-mobile-command-shell/);
assert.match(source, /overflow-x-auto/);
assert.match(source, /fixed bottom-0/);
assert.match(source, /lg:hidden/);
assert.match(source, /pb-20 lg:pb-0/);

console.log("ok - app shell mobile command layout");
```

- [ ] **Step 2: Add the homepage mobile order failing test**

Create `src/app/homepage-mobile-layout.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /mainClassName="[^"]*gap-3[^"]*lg:gap-4[^"]*"/);
assert.match(source, /<section id="signals" className="[^"]*order-2[^"]*lg:order-1[^"]*"/);
assert.match(source, /<aside\s+id="alpha"\s+className="[^"]*order-1[^"]*lg:order-2[^"]*"/);
assert.match(source, /className="[^"]*mobile-command-summary[^"]*"/);

console.log("ok - homepage mobile command ordering");
```

- [ ] **Step 3: Add the feed panel failing test**

Create `src/components/unified-news-panel-mobile.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./unified-news-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-mobile-command-feed/);
assert.match(source, /Signal Flow/);
assert.match(source, /rounded-lg border border-line\/70 bg-panel\/95/);
assert.match(source, /bg-background\/70/);
assert.match(source, /active:scale-\[0\.995\]/);
assert.match(source, /border-l-2 border-l-accent\/45/);

console.log("ok - unified news mobile command surface");
```

- [ ] **Step 4: Add the theme failing test**

Create `src/app/mobile-command-theme.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

assert.match(source, /--background:\s*#101312;/);
assert.match(source, /--panel:\s*rgba\(24,\s*29,\s*28,\s*0\.82\);/);
assert.match(source, /--accent:\s*#d7b56d;/);
assert.match(source, /background-image:\s*none;/);
assert.doesNotMatch(source, /#f7f0e6/);

console.log("ok - mobile command theme tokens");
```

- [ ] **Step 5: Run tests to verify they fail**

Run:

```powershell
node src/components/app-shell.test.mjs
node src/app/homepage-mobile-layout.test.mjs
node src/components/unified-news-panel-mobile.test.mjs
node src/app/mobile-command-theme.test.mjs
```

Expected: at least the new Mobile Command assertions fail because production code has not been updated yet.

---

### Task 2: Implement AppShell Mobile Command Frame

**Files:**
- Modify: `src/components/app-shell.tsx`
- Test: `src/components/app-shell.test.mjs`

- [ ] **Step 1: Add the shell marker and bottom padding**

In `AppShell`, change the outer wrapper from:

```tsx
<div className="min-h-screen bg-background text-foreground">
```

to:

```tsx
<div
  data-mobile-command-shell
  className="min-h-screen bg-background pb-20 text-foreground lg:pb-0"
>
```

- [ ] **Step 2: Tighten the sticky header**

Change the header inner container class from:

```tsx
className="flex min-h-[4.75rem] flex-col gap-3 px-3 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between"
```

to:

```tsx
className="flex min-h-[4.25rem] flex-col gap-2 px-3 py-2.5 sm:px-5 lg:min-h-[4.75rem] lg:flex-row lg:items-center lg:justify-between lg:py-3"
```

- [ ] **Step 3: Make status pills scroll horizontally on mobile**

Wrap the existing status/tool row with a mobile overflow container by changing:

```tsx
<div className="flex flex-wrap items-center gap-2">
```

to:

```tsx
<div className="-mx-3 flex min-w-0 items-center gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
```

Keep the existing `statusPills.map`, `ThemeToggle`, settings link, and logout link inside this row.

- [ ] **Step 4: Add fixed mobile bottom navigation**

Add this block immediately before the closing `</div>` of the outer shell wrapper:

```tsx
<nav
  aria-label="Mobile primary navigation"
  className="fixed bottom-0 left-0 right-0 z-50 border-t border-line/70 bg-panel-strong/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-18px_45px_-36px_rgba(0,0,0,0.8)] backdrop-blur-xl lg:hidden"
>
  <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
    {shellNavItems.map((item) => {
      const active = item.key === optimisticActiveNav;
      return (
        <Link
          key={item.key}
          href={item.href}
          title={item.label}
          aria-label={item.label}
          onClick={() => setOptimisticActiveNav(item.key)}
          className={[
            "flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg border text-[10px] font-semibold transition-colors",
            active
              ? "border-accent/45 bg-accent-soft text-accent"
              : "border-transparent text-muted hover:bg-panel hover:text-foreground",
          ].join(" ")}
        >
          <ShellGlyph icon={item.icon} />
          <span>{item.label}</span>
        </Link>
      );
    })}
  </div>
</nav>
```

- [ ] **Step 5: Verify AppShell test passes**

Run:

```powershell
node src/components/app-shell.test.mjs
```

Expected: `ok - app shell mobile command layout`.

---

### Task 3: Reorder Homepage for Mobile

**Files:**
- Modify: `src/app/page.tsx`
- Test: `src/app/homepage-mobile-layout.test.mjs`

- [ ] **Step 1: Update homepage grid spacing**

Change `mainClassName` to:

```tsx
mainClassName="mx-auto grid w-full max-w-[1780px] min-h-0 gap-3 px-3 py-3 sm:px-5 lg:gap-4 lg:py-4 lg:grid-cols-[minmax(0,1.58fr)_minmax(22rem,0.82fr)] lg:items-start xl:grid-cols-[minmax(0,1.72fr)_minmax(24rem,0.72fr)]"
```

- [ ] **Step 2: Put AI summary before feed on mobile**

Change the feed section class to:

```tsx
<section id="signals" className="order-2 min-w-0 lg:order-1">
```

Change the AI aside class to:

```tsx
className="order-1 relative z-10 min-w-0 lg:order-2 lg:sticky lg:top-[5.25rem]"
```

- [ ] **Step 3: Mark and tune the mobile summary card**

Change the `AlphaSummaryCard` className to:

```tsx
className="mobile-command-summary lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
```

- [ ] **Step 4: Verify homepage test passes**

Run:

```powershell
node src/app/homepage-mobile-layout.test.mjs
```

Expected: `ok - homepage mobile command ordering`.

---

### Task 4: Tune Unified Feed Surface

**Files:**
- Modify: `src/components/unified-news-panel.tsx`
- Test: `src/components/unified-news-panel-mobile.test.mjs`

- [ ] **Step 1: Add feed marker and stronger surface**

Change the root `<section>` opening to include:

```tsx
data-mobile-command-feed
```

Change the base root class from:

```tsx
"min-w-0 overflow-hidden rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]",
```

to:

```tsx
"min-w-0 overflow-hidden rounded-lg border border-line/70 bg-panel/95 shadow-[0_24px_60px_-50px_rgba(0,0,0,0.65)]",
```

- [ ] **Step 2: Rename the panel title for a clean English operational label**

Change:

```tsx
<h2 className="font-serif text-2xl font-medium text-foreground">信号流</h2>
```

to:

```tsx
<h2 className="text-lg font-semibold text-foreground">Signal Flow</h2>
```

Keep the count line below it.

- [ ] **Step 3: Tighten the panel header and timeline background**

Change the header wrapper class from:

```tsx
<div className="shrink-0 border-b border-line/70 bg-panel-strong">
```

to:

```tsx
<div className="shrink-0 border-b border-line/70 bg-panel-strong/95">
```

Change the timeline container class from:

```tsx
`min-h-0 space-y-2 bg-background/30 p-2 sm:p-3 ${
```

to:

```tsx
`min-h-0 space-y-2.5 bg-background/70 p-2 sm:p-3 ${
```

- [ ] **Step 4: Strengthen item card hierarchy**

Change the article class from:

```tsx
className="group relative grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-2.5 rounded-lg border border-line/70 bg-panel px-3 py-3 transition-colors hover:border-accent/45 hover:bg-panel-strong focus:outline-none focus:ring-2 focus:ring-accent"
```

to:

```tsx
className="group relative grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-2.5 rounded-lg border border-line/70 border-l-2 border-l-accent/45 bg-panel-strong/92 px-3 py-3.5 shadow-[0_16px_34px_-30px_rgba(0,0,0,0.75)] transition-all active:scale-[0.995] hover:border-accent/45 hover:bg-panel-strong focus:outline-none focus:ring-2 focus:ring-accent"
```

- [ ] **Step 5: Verify feed test passes**

Run:

```powershell
node src/components/unified-news-panel-mobile.test.mjs
```

Expected: `ok - unified news mobile command surface`.

---

### Task 5: Apply Mobile Command Theme Tokens

**Files:**
- Modify: `src/app/globals.css`
- Test: `src/app/mobile-command-theme.test.mjs`

- [ ] **Step 1: Replace light root tokens with operational dark tokens**

In `:root`, use:

```css
  --background: #101312;
  --foreground: #f4f1ea;
  --panel: rgba(24, 29, 28, 0.82);
  --panel-strong: rgba(30, 36, 34, 0.96);
  --muted: #aeb8b3;
  --line: rgba(222, 232, 226, 0.15);
  --accent: #d7b56d;
  --accent-soft: rgba(215, 181, 109, 0.16);
  --success: #75c7a2;
  --success-soft: rgba(117, 199, 162, 0.14);
  --warning: #e1b765;
  --warning-soft: rgba(225, 183, 101, 0.15);
  --danger: #ee7d70;
  --danger-soft: rgba(238, 125, 112, 0.16);
  --info: #8fb9d8;
  --info-soft: rgba(143, 185, 216, 0.15);
```

- [ ] **Step 2: Keep dark mode close but slightly deeper**

In `html.dark`, use:

```css
  --background: #0c0f0e;
  --foreground: #f5f2eb;
  --panel: rgba(19, 23, 22, 0.88);
  --panel-strong: rgba(25, 30, 29, 0.97);
  --muted: #aeb8b3;
  --line: rgba(226, 235, 230, 0.14);
  --accent: #e0be76;
  --accent-soft: rgba(224, 190, 118, 0.17);
  --success: #7ed0aa;
  --success-soft: rgba(126, 208, 170, 0.15);
  --warning: #e7bf71;
  --warning-soft: rgba(231, 191, 113, 0.15);
  --danger: #f08779;
  --danger-soft: rgba(240, 135, 121, 0.16);
  --info: #95c0df;
  --info-soft: rgba(149, 192, 223, 0.15);
```

- [ ] **Step 3: Remove warm body gradients**

Change the body background image declaration to:

```css
  background-image: none;
```

Change the `html.dark body` background image declaration to:

```css
  background-image: none;
```

- [ ] **Step 4: Verify theme test passes**

Run:

```powershell
node src/app/mobile-command-theme.test.mjs
```

Expected: `ok - mobile command theme tokens`.

---

### Task 6: Full Verification and Commit

**Files:**
- Verify changed files only.
- Do not stage unrelated existing changes in `src/lib/telegram-client-snapshot.test.mjs` or `src/lib/telegram-pipeline-x-source-filter.test.mjs`.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node src/components/app-shell.test.mjs
node src/app/homepage-mobile-layout.test.mjs
node src/components/unified-news-panel-mobile.test.mjs
node src/app/mobile-command-theme.test.mjs
node src/app/manifest.test.mjs
node src/app/layout-metadata.test.mjs
node public/pwa-assets.test.mjs
```

Expected: all commands print `ok - ...`.

- [ ] **Step 2: Run lint**

Run:

```powershell
pnpm exec eslint src/app/page.tsx src/app/globals.css src/components/app-shell.tsx src/components/unified-news-panel.tsx
```

Expected: no lint errors.

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm exec next build --webpack
```

Expected: build completes successfully and still emits `/manifest.webmanifest`.

- [ ] **Step 4: Inspect local working tree**

Run:

```powershell
git status --short
```

Expected: changed files from this plan plus unrelated pre-existing modifications. Do not stage unrelated `src/lib` files.

- [ ] **Step 5: Stage only this plan's implementation files**

Run:

```powershell
git add src/components/app-shell.test.mjs src/app/homepage-mobile-layout.test.mjs src/components/unified-news-panel-mobile.test.mjs src/app/mobile-command-theme.test.mjs src/components/app-shell.tsx src/app/page.tsx src/components/unified-news-panel.tsx src/app/globals.css docs/superpowers/plans/2026-05-12-mobile-command-homepage.md
```

- [ ] **Step 6: Commit implementation**

Run:

```powershell
git commit -m "Refine homepage mobile command UI"
```

Expected: commit succeeds and leaves unrelated test modifications unstaged.

- [ ] **Step 7: Push completed commits**

Run:

```powershell
git push
```

Expected: `main` pushes to `origin/main`.

---

## Self-Review

- Spec coverage: shell compactness, mobile status stability, mobile AI-first order, feed hierarchy, desktop preservation, PWA preservation, and no data/auth changes are each covered by tasks.
- Completeness scan: no unresolved marker text is included.
- Type consistency: no new TypeScript data types are introduced; all changes are class/layout contract changes.
