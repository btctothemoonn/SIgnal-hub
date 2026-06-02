# Signal Flow Floating Reading Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scrollbar-adjacent Signal Flow reading rail with latest, saved-position, and oldest-message actions while preserving the current stable reading-position behavior.

**Architecture:** Create a focused presentational component for the B2 desktop/mobile rail and wire it into `UnifiedNewsPanel`. Keep scrolling behavior inside the panel: it already knows whether the desktop internal timeline or the mobile page is the active viewport, so the new callbacks reuse the rendered feed item attributes instead of adding a second state model.

**Tech Stack:** React, TypeScript, Tailwind CSS, Node source-contract tests, Next.js production build.

---

### Task 1: Add the floating navigation component

**Files:**
- Create: `src/components/signal-feed-floating-navigation.test.mjs`
- Create: `src/components/signal-feed-floating-navigation.tsx`

- [ ] **Step 1: Write the failing source-contract test**

Create a Node test that reads the new component source and checks for:

```js
assert.match(source, /data-signal-feed-floating-navigation/);
assert.match(source, /aria-label="回到最新消息"/);
assert.match(source, /aria-label="返回上次阅读"/);
assert.match(source, /aria-label="跳到最早消息"/);
assert.match(source, /hidden lg:inline/);
assert.match(source, /newCount > 0/);
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
& $node src/components/signal-feed-floating-navigation.test.mjs
```

Expected: FAIL because `signal-feed-floating-navigation.tsx` does not exist.

- [ ] **Step 3: Implement the focused component**

Create a component with this interface:

```ts
type SignalFeedFloatingNavigationProps = {
  showLatest: boolean;
  newCount: number;
  onLatest: () => void;
  onSaved: () => void;
  onOldest: () => void;
};
```

Render three stable icon buttons. Use `fixed` positioning on mobile and `absolute` positioning on desktop. Keep desktop text labels with `hidden lg:inline`, expose tooltips with `title`, and show the unread badge only when `newCount > 0`.

- [ ] **Step 4: Run the component test to verify GREEN**

Run:

```powershell
& $node src/components/signal-feed-floating-navigation.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/signal-feed-floating-navigation.test.mjs src/components/signal-feed-floating-navigation.tsx
git commit -m "Add signal feed floating navigation"
```

### Task 2: Wire navigation into Signal Flow

**Files:**
- Modify: `src/components/unified-news-panel-reading-position.test.mjs`
- Modify: `src/components/unified-news-panel.tsx`

- [ ] **Step 1: Extend the failing panel contract test**

Add assertions that the panel:

```js
assert.match(source, /SignalFeedFloatingNavigation/);
assert.match(source, /scrollToLatestSignal/);
assert.match(source, /scrollToOldestSignal/);
assert.match(source, /hasScrolledAwayFromLatest/);
assert.match(source, /newCount=\{activeTabNewCount\}/);
```

- [ ] **Step 2: Run the panel test to verify RED**

Run:

```powershell
& $node src/components/unified-news-panel-reading-position.test.mjs
```

Expected: FAIL because the panel has not imported or wired the rail.

- [ ] **Step 3: Implement panel scrolling behavior**

In `UnifiedNewsPanel`:

```ts
const [hasScrolledAwayFromLatest, setHasScrolledAwayFromLatest] = useState(false);

const scrollToLatestSignal = useCallback(() => {
  const first = timelineRef.current?.querySelector<HTMLElement>("[data-signal-feed-item-id]");
  first?.scrollIntoView({ behavior: "smooth", block: "start" });
}, []);

const scrollToOldestSignal = useCallback(() => {
  const items = timelineRef.current?.querySelectorAll<HTMLElement>("[data-signal-feed-item-id]");
  items?.[items.length - 1]?.scrollIntoView({ behavior: "smooth", block: "end" });
}, []);
```

Update the existing scroll listener to detect whether the latest card has left the viewport, compute the active-tab unread count, and render:

```tsx
<SignalFeedFloatingNavigation
  showLatest={hasScrolledAwayFromLatest}
  newCount={activeTabNewCount}
  onLatest={scrollToLatestSignal}
  onSaved={returnToSavedReadingPosition}
  onOldest={scrollToOldestSignal}
/>
```

Keep the existing toolbar `返回上次阅读` button as a redundant entry.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```powershell
& $node src/components/unified-news-panel-reading-position.test.mjs
& $node src/lib/signal-feed-reading-position.test.mjs
& $node src/lib/unified-news-panel-contract.test.mjs
& $node src/components/unified-news-panel-mobile.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/unified-news-panel-reading-position.test.mjs src/components/unified-news-panel.tsx
git commit -m "Wire floating reading navigation into signal flow"
```

### Task 3: Verify and publish

**Files:**
- Verify only.

- [ ] **Step 1: Run lint**

```powershell
& $node node_modules\eslint\bin\eslint.js src/components/unified-news-panel.tsx src/components/signal-feed-floating-navigation.tsx src/lib/signal-feed-reading-position.ts
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

```powershell
& $node node_modules\next\dist\bin\next build --webpack
```

Expected: PASS.

- [ ] **Step 3: Merge, push, and deploy**

Merge the feature branch into `main`, push `main`, run `scripts/deploy-vps.sh` on the VPS, and verify the deployed commit plus service health.

