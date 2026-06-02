# Signal Flow Reading Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the visible Signal Flow card stationary when realtime items are inserted above it and let the user return to the last reading position on the same device.

**Architecture:** Add a small pure helper module for persisted anchor validation and scroll delta calculation. Wire DOM anchor capture and restoration into `UnifiedNewsPanel`: snapshot merges stage a compensation anchor, a layout effect restores it after rendering, and scroll events persist the current top visible card. A toolbar button restores the stored anchor without changing filters.

**Tech Stack:** Next.js, React hooks, TypeScript, browser `localStorage`, Node assertion tests.

---

### Task 1: Add Reading Anchor Pure Logic

**Files:**
- Create: `src/lib/signal-feed-reading-position.ts`
- Create: `src/lib/signal-feed-reading-position.test.mjs`

- [ ] **Step 1: Write the failing helper test**

Test that valid anchors parse, malformed anchors are rejected, and layout movement produces the expected scroll delta.

- [ ] **Step 2: Run the helper test and verify RED**

Run: `node src/lib/signal-feed-reading-position.test.mjs`

Expected: FAIL because `signal-feed-reading-position.ts` does not exist.

- [ ] **Step 3: Implement the pure helper**

Export:

```ts
export type SignalFeedReadingAnchor = {
  itemId: string;
  viewportTop: number;
  savedAt: string;
};

export function parseSignalFeedReadingAnchor(raw: string | null): SignalFeedReadingAnchor | null;
export function calculateSignalFeedScrollDelta(anchorTop: number, currentTop: number): number;
```

Reject empty IDs, non-finite offsets and invalid timestamps. Return `currentTop - anchorTop` as the compensation delta.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `node src/lib/signal-feed-reading-position.test.mjs`

Expected: PASS.

### Task 2: Wire Signal Flow Capture, Compensation And Restore

**Files:**
- Modify: `src/components/unified-news-panel.tsx`
- Create: `src/components/unified-news-panel-reading-position.test.mjs`

- [ ] **Step 1: Write the failing component contract test**

Assert that the panel imports the reading-position helper, defines `signal-hub:signal-feed-reading-anchor`, renders stable `data-signal-feed-item-id` attributes, stages compensation before realtime snapshot merges, persists scroll anchors and renders a return button.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node src/components/unified-news-panel-reading-position.test.mjs`

Expected: FAIL because the reading-position behavior is absent.

- [ ] **Step 3: Implement DOM anchor handling**

Add:

```ts
const SIGNAL_FEED_READING_ANCHOR_KEY = "signal-hub:signal-feed-reading-anchor";
```

Use a timeline ref and stable card attributes. Capture the first visible card on throttled timeline/window scroll and write it to `localStorage`. Before realtime, interval or manual snapshot merges, stage the visible anchor. After render, use `requestAnimationFrame` and `calculateSignalFeedScrollDelta` to compensate the timeline scroller on desktop or `window` on mobile. Add a `返回上次阅读` button that restores the stored anchor or reports that the card is outside the current list.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node src/lib/signal-feed-reading-position.test.mjs
node src/components/unified-news-panel-reading-position.test.mjs
node src/lib/unified-news-panel-contract.test.mjs
node src/components/unified-news-panel-mobile.test.mjs
```

Expected: PASS.

### Task 3: Verify, Commit, Publish And Deploy

**Files:**
- Modify only files from Tasks 1 and 2.

- [ ] **Step 1: Run the production build**

Run:

```powershell
$node='C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node node_modules\next\dist\bin\next build --webpack
```

Expected: PASS.

- [ ] **Step 2: Verify locally in the browser**

Open the local Signal Flow page. Scroll into the feed, wait for or trigger a refresh, and confirm the current card remains stationary. Scroll elsewhere, reload, click `返回上次阅读`, and confirm the stored card is restored.

- [ ] **Step 3: Commit and push**

Commit the implementation and push `main` to GitHub.

- [ ] **Step 4: Deploy VPS and verify**

Run `scripts/deploy-vps.sh` on the VPS. Confirm the web service is active and the public site responds.
