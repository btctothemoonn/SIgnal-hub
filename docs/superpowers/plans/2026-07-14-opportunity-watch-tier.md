# Opportunity Radar Watch Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display 60-74 point Opportunity Radar candidates in a clearly separated watch tier while preserving the existing 75-point confirmed selection contract.

**Architecture:** Extend the opportunity card contract with a derived tier, then have the SQLite read layer return confirmed selections and a separately capped watch set for active queries. The React component defensively validates tier score ranges, partitions cards into two labeled sections, and bumps its browser-cache key so legacy cached cards cannot mask the new UI.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Node `node:sqlite`, Node assertion tests, Tailwind CSS.

## Global Constraints

- Confirmed opportunities still require a final score of at least 75 and the existing worker selection path.
- Watch opportunities have a final score from 60 through 74, are not selected, expired, or dismissed, and are capped at five cards.
- Do not change worker frequency, scoring weights, clustering, AI prompts, provider routing, or source windows.
- Keep market/sort/status filters, follow/dismiss, evidence expansion, five-minute polling, and read-only manual refresh behavior.
- Do not change Signal Flow, Stocks, Holding, or Douyin behavior.

---

### Task 1: Opportunity tier contract and SQLite reads

**Files:**
- Modify: `src/lib/opportunity-types.ts`
- Modify: `src/lib/opportunity-store.ts`
- Test: `src/lib/opportunity-store.test.mjs`
- Test: `src/app/api/opportunities/route.test.mjs`

**Interfaces:**
- Consumes: existing `listOpportunities(db, options)` and `OpportunityCard` callers.
- Produces: `OpportunityTier`, `OpportunityCard.tier`, and nullable `OpportunityCard.selectedAt`; active reads return confirmed cards plus at most five watch cards.

- [ ] **Step 1: Write failing store tests for confirmed and watch tiers**

Add assertions and fixtures to `src/lib/opportunity-store.test.mjs` that require the new contract:

```js
const activeRows = listOpportunities(db, {
  market: "all",
  sort: "score",
  status: "active",
  limit: 1000,
});
assert.equal(activeRows.find((item) => item.id === clusterId).tier, "confirmed");
assert.equal(activeRows.find((item) => item.id === clusterId).selectedAt !== null, true);
assert.equal(activeRows.find((item) => item.id === lowScoreClusterId).tier, "watch");
assert.equal(activeRows.find((item) => item.id === lowScoreClusterId).selectedAt, null);
```

Create six additional unselected 60-74 point clusters, dismiss one, and assert that active reads return no more than five watch cards, exclude final scores below 60, and keep selected cards below 75 in history only.

- [ ] **Step 2: Run the store test and verify RED**

Run:

```powershell
pnpm exec node --experimental-strip-types --experimental-transform-types src/lib/opportunity-store.test.mjs
```

Expected: FAIL because `tier` is missing and active queries still exclude unselected 60-74 point rows.

- [ ] **Step 3: Extend the public opportunity types**

Update `src/lib/opportunity-types.ts`:

```ts
export type OpportunityTier = "confirmed" | "watch";

// Add this field to OpportunityCard next to status.
tier: OpportunityTier;

// Replace the current selectedAt declaration.
selectedAt: string | null;
```

- [ ] **Step 4: Implement separate confirmed and watch queries**

In `src/lib/opportunity-store.ts`, keep the history query on selected rows. For active reads, execute the current confirmed query with `selected_at IS NOT NULL`, `final_score >= 75`, and the requested `limit`, then execute a watch query with these conditions and a fixed limit of five:

```ts
const OPPORTUNITY_WATCH_THRESHOLD = 60;
const OPPORTUNITY_CONFIRMED_THRESHOLD = 75;
const OPPORTUNITY_WATCH_LIMIT = 5;

const watchConditions = [
  "c.selected_at IS NULL",
  "c.status != 'expired'",
  "c.final_score >= ?",
  "c.final_score < ?",
  "COALESCE(p.dismissed, 0) = 0",
];

const watchRows = db.prepare(`
  SELECT c.*, COALESCE(p.followed, 0) AS followed,
    COALESCE(p.dismissed, 0) AS dismissed,
    CASE WHEN c.confidence = 'rule-only' THEN 1 ELSE 0 END AS ai_pending
  FROM opportunity_clusters c
  LEFT JOIN opportunity_preferences p ON p.cluster_id = c.id
  WHERE ${watchConditions.join(" AND ")}
  ORDER BY ${orderBy}
  LIMIT ?
`).all(
  OPPORTUNITY_WATCH_THRESHOLD,
  OPPORTUNITY_CONFIRMED_THRESHOLD,
  OPPORTUNITY_WATCH_LIMIT,
);
```

Apply the existing market condition to both active queries. Map rows with `selected_at` to `tier: "confirmed"`; map unselected rows to `tier: "watch"`; use `nullableString(row.selected_at)` for `selectedAt`. Preserve evidence hydration for the combined rows.

- [ ] **Step 5: Run the store test and verify GREEN**

Run the command from Step 2.

Expected: PASS with `ok - opportunity store`.

- [ ] **Step 6: Add API contract coverage**

In `src/app/api/opportunities/route.test.mjs`, add six unselected watch fixtures with final scores from 60 through 65 and assert:

```js
const active = await GET(request("?limit=10"));
const activeItems = (await active.json()).items;
assert.equal(activeItems.filter((item) => item.tier === "confirmed").length, 10);
assert.equal(activeItems.filter((item) => item.tier === "watch").length, 5);
assert.equal(
  activeItems.filter((item) => item.tier === "watch")
    .every((item) => item.selectedAt === null && item.finalScore >= 60 && item.finalScore < 75),
  true,
);
```

Update existing active length assertions to account for the additional five watch cards. Assert history cards remain `tier: "confirmed"`.

- [ ] **Step 7: Run store and route tests**

Run:

```powershell
pnpm exec node --experimental-strip-types --experimental-transform-types src/lib/opportunity-store.test.mjs
pnpm exec node --experimental-strip-types --experimental-transform-types src/app/api/opportunities/route.test.mjs
```

Expected: both commands PASS.

- [ ] **Step 8: Commit the data-layer change**

```powershell
git add src/lib/opportunity-types.ts src/lib/opportunity-store.ts src/lib/opportunity-store.test.mjs src/app/api/opportunities/route.test.mjs
git commit -m "feat: expose opportunity watch candidates"
```

---

### Task 2: Separate confirmed and watch sections in the radar

**Files:**
- Modify: `src/components/opportunity-radar.tsx`
- Test: `src/components/opportunity-radar.test.mjs`

**Interfaces:**
- Consumes: `OpportunityCard.tier` from Task 1.
- Produces: `partitionOpportunityItems(items)` and a two-section active Opportunity Radar UI.

- [ ] **Step 1: Write failing component behavior tests**

Add `tier: "confirmed"` to the existing `opportunity` fixture, add a watch fixture, export and test the new partition helper:

```js
const { confirmed, watch } = partitionOpportunityItems([
  opportunity,
  { ...opportunity, id: 8, tier: "watch", finalScore: 67, selectedAt: null },
]);
assert.deepEqual(Array.from(confirmed, (item) => item.id), [7]);
assert.deepEqual(Array.from(watch, (item) => item.id), [8]);
```

Update `visibleOpportunityItems` assertions so valid 60-74 watch cards remain visible, while mismatched tiers or out-of-range scores are excluded. Add source assertions for `确认机会`, `候选观察`, `确认`, `观察`, and cache key `signal-hub:opportunities:v2`.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
pnpm exec node src/components/opportunity-radar.test.mjs
```

Expected: FAIL because watch items are filtered out and `partitionOpportunityItems` and section labels do not exist.

- [ ] **Step 3: Implement defensive visibility and partition helpers**

Update `src/components/opportunity-radar.tsx`:

```ts
export function visibleOpportunityItems(snapshot: OpportunitySnapshot) {
  if (snapshot.status === "history") return snapshot.items;
  return snapshot.items.filter((item) =>
    item.tier === "confirmed"
      ? item.finalScore >= 75
      : item.tier === "watch" && item.finalScore >= 60 && item.finalScore < 75,
  );
}

export function partitionOpportunityItems(items: OpportunityCard[]) {
  return {
    confirmed: items.filter((item) => item.tier === "confirmed"),
    watch: items.filter((item) => item.tier === "watch"),
  };
}
```

- [ ] **Step 4: Render the two active sections and tier badge**

Partition `visibleItems` and render active results under `确认机会` and `候选观察`. Each section keeps the existing `OpportunityCardView`; a section with no rows renders `暂无确认机会` or `暂无候选观察`. History continues to render one list. In `OpportunityCardView`, add:

```tsx
<span className={item.tier === "confirmed" ? "text-positive" : "text-warning"}>
  {item.tier === "confirmed" ? "确认" : "观察"}
</span>
```

Change the browser cache key from `v1` to `v2`.

- [ ] **Step 5: Run the component test and verify GREEN**

Run the command from Step 2.

Expected: PASS with `ok - opportunity radar cached cards and actions`.

- [ ] **Step 6: Commit the UI change**

```powershell
git add src/components/opportunity-radar.tsx src/components/opportunity-radar.test.mjs
git commit -m "feat: split opportunity confirmed and watch tiers"
```

---

### Task 3: Full verification, publication, and VPS validation

**Files:**
- Verify: all changed files from Tasks 1 and 2
- Deploy with: `scripts/deploy-vps.sh`

**Interfaces:**
- Consumes: committed data and UI changes.
- Produces: published GitHub `main` and a VPS deployment that returns watch cards without changing worker selection.

- [ ] **Step 1: Run all local quality gates**

```powershell
pnpm test
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm build
```

Expected: all tests pass, ESLint has zero warnings, TypeScript exits 0, and Next production build succeeds.

- [ ] **Step 2: Inspect the final diff and repository state**

```powershell
git diff HEAD~2 --check
git status --short --branch
git log -4 --oneline
```

Expected: no whitespace errors and only the intentional plan commit plus the two implementation commits are ahead of `origin/main`.

- [ ] **Step 3: Push GitHub main**

```powershell
git push origin main
```

Expected: `origin/main` advances to the UI implementation commit.

- [ ] **Step 4: Deploy to the VPS**

```powershell
ssh -i "$HOME\.ssh\signal_hub_vps_ed25519" ubuntu@43.128.146.48 "cd /home/ubuntu/signal-hub && bash scripts/deploy-vps.sh"
```

Expected: VPS tests and build pass and all Signal Hub services report active.

- [ ] **Step 5: Verify the live opportunity API and service health**

Use a server-local authenticated request to `/api/opportunities?market=all&sort=score&status=active&limit=10` without printing credentials. Assert that returned items use only `confirmed` or `watch`, watch scores are 60-74, watch `selectedAt` values are null, and no more than five watch cards are returned. Then run:

```powershell
ssh -i "$HOME\.ssh\signal_hub_vps_ed25519" ubuntu@43.128.146.48 "cd /home/ubuntu/signal-hub && pnpm health:check"
```

Expected: Web and Opportunity Radar services are active; provider/source warnings may remain visible but do not prevent cached watch cards from rendering.
