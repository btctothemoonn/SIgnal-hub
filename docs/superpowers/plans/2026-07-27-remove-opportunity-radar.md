# Remove Opportunity Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove Opportunity Radar from Signal Hub while preserving the two-panel Signal feed and AI summary experience.

**Architecture:** Collapse the responsive Signal layout to its existing non-Opportunity path, then remove every Opportunity-specific route, worker, persistence module, health item, service definition, and deployment hook. Runtime cleanup is performed only after the new commit is deployed, with explicitly named service and database targets.

**Tech Stack:** Next.js App Router, React, TypeScript, Node.js contract tests, SQLite, Bash/systemd, GitHub, Ubuntu VPS.

## Global Constraints

- Do not change Signal feed behavior, TG/X collection, translation, or Signal AI summaries.
- Do not change Stocks, Holding, Douyin, authentication, or PWA behavior.
- Preserve the mobile two-panel swipe between Latest Signals and AI Summary.
- Preserve AI Summary top-position behavior and restoration of the previous feed scroll position.
- Delete only `opportunities.sqlite`, `opportunities.sqlite-wal`, and `opportunities.sqlite-shm` from the configured Signal Hub runtime directory.
- Runtime cleanup must tolerate an already stopped or missing service.
- Do not display `.env.local` values while removing `OPPORTUNITY_*` entries.

---

## File Structure

- `src/components/signals-responsive-layout.tsx`: retain one desktop two-column layout and one mobile two-panel pager.
- `src/app/page.tsx`: stop reading or passing the Opportunity feature flag.
- `src/components/signals-responsive-layout.test.mjs`: assert that only feed and summary panels remain and scroll behavior is preserved.
- `src/app/homepage-mobile-layout.test.mjs`: assert that the homepage has a two-panel pager with no Opportunity flag.
- `src/lib/system-health.ts`: remove Opportunity SQLite inspection and health output.
- `src/lib/signal-hub-services.ts`: remove the Opportunity systemd service from the registry.
- `scripts/deploy-vps.sh`: stop creating, enabling, and restarting the Opportunity worker.
- `package.json`: remove Opportunity worker commands.
- Opportunity-only source, API, tests, worker script, and historical Opportunity design/plan documents: delete.

### Task 1: Collapse Signal to Feed and Summary

**Files:**
- Modify: `src/components/signals-responsive-layout.test.mjs`
- Modify: `src/app/homepage-mobile-layout.test.mjs`
- Modify: `src/components/signals-responsive-layout.tsx`
- Modify: `src/app/page.tsx`
- Delete: `src/components/opportunity-radar.tsx`
- Delete: `src/components/opportunity-radar.test.mjs`

**Interfaces:**
- Consumes: existing `UnifiedNewsPanel`, `AlphaSummaryCard`, mobile scroll preservation refs, and `SignalsResponsiveLayoutProps`.
- Produces: `SignalsResponsiveLayout` with props `initialTelegramSnapshot`, `initialXSnapshot`, and `pollXSnapshot`; mobile panel type `"feed" | "summary"`.

- [ ] **Step 1: Change the layout contract tests to require only two panels**

Replace positive Opportunity assertions with negative checks and preserve the scroll behavior checks:

```js
assert.doesNotMatch(component, /OpportunityRadar|opportunityEnabled|opportunities/);
assert.match(component, /type SignalMobilePanel = "feed" \| "summary"/);
assert.match(component, /const MOBILE_PANEL_INDEX = \{[\s\S]*feed: 0[\s\S]*summary: 1/);
assert.match(component, /grid grid-cols-2 gap-1/);
assert.doesNotMatch(component, /grid-cols-3/);
assert.match(component, /mobileFeedScrollYRef/);
assert.match(component, /window\.scrollTo\(\{ top: 0/);
assert.match(component, /window\.scrollTo\(\{ top: mobileFeedScrollYRef\.current/);
assert.doesNotMatch(page, /OPPORTUNITY_RADAR_UI_ENABLED|opportunityEnabled/);
```

- [ ] **Step 2: Run the two contract tests and confirm they fail**

Run:

```powershell
& $NODE src/components/signals-responsive-layout.test.mjs
& $NODE src/app/homepage-mobile-layout.test.mjs
```

Expected: FAIL because the component still imports and renders `OpportunityRadar` and the homepage still passes `opportunityEnabled`.

- [ ] **Step 3: Simplify the responsive layout**

Make these exact structural changes:

```ts
type SignalMobilePanel = "feed" | "summary";

const MOBILE_PANEL_INDEX: Record<SignalMobilePanel, number> = {
  feed: 0,
  summary: 1,
};
```

Remove `OpportunityRadar`, `SignalDesktopPanel`, `enabledMobilePanels`, all Opportunity branches, and the `opportunityEnabled` prop. Keep the existing non-Opportunity desktop two-column return and non-Opportunity mobile pager as the only render paths. Keep `scrollToPanel()` smooth and retain the existing summary/feed window-scroll effects.

In `src/app/page.tsx`, render:

```tsx
<SignalsResponsiveLayout
  initialTelegramSnapshot={telegramSnapshot}
  initialXSnapshot={xSnapshot}
  pollXSnapshot={pollXSnapshot}
/>
```

- [ ] **Step 4: Delete the Opportunity component and rerun the tests**

Run:

```powershell
& $NODE src/components/signals-responsive-layout.test.mjs
& $NODE src/app/homepage-mobile-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the Signal layout removal**

```powershell
git add src/components/signals-responsive-layout.tsx src/components/signals-responsive-layout.test.mjs src/app/page.tsx src/app/homepage-mobile-layout.test.mjs
git add -u src/components/opportunity-radar.tsx src/components/opportunity-radar.test.mjs
git commit -m "refactor: remove opportunity panel from signal"
```

### Task 2: Remove Health, Service, and Deployment Integration

**Files:**
- Modify: `src/lib/system-health.test.mjs`
- Modify: `src/lib/system-health.ts`
- Modify: `src/lib/signal-hub-services.test.mjs`
- Modify: `src/lib/signal-hub-services.ts`
- Modify: `scripts/deploy-vps.test.mjs`
- Modify: `scripts/deploy-vps.sh`

**Interfaces:**
- Consumes: existing `getSystemHealthSnapshot()`, `SIGNAL_HUB_SYSTEMD_SERVICES`, and VPS deployment flow.
- Produces: health and service lists containing all current services except `signal-hub-opportunity`.

- [ ] **Step 1: Change contract tests to reject Opportunity integration**

Add these assertions while deleting Opportunity-specific health fixtures and assertions:

```js
assert.ok(!names.includes("signal-hub-opportunity"));
assert.doesNotMatch(serviceRegistry, /signal-hub-opportunity|机会雷达/);
assert.doesNotMatch(source, /signal-hub-opportunity|opportunity-worker/);
assert.doesNotMatch(systemHealthSource, /opportunityHealthItem|getOpportunityDbPath|OPPORTUNITY_DB/);
```

Keep assertions for every other required Signal Hub service.

- [ ] **Step 2: Run the affected tests and confirm they fail**

Run:

```powershell
& $NODE src/lib/system-health.test.mjs
& $NODE src/lib/signal-hub-services.test.mjs
& $NODE scripts/deploy-vps.test.mjs
```

Expected: FAIL while Opportunity health and service references remain.

- [ ] **Step 3: Remove Opportunity health code**

Delete the `getOpportunityDbPath` import, `DEFAULT_STALE_MS.opportunity`, `OpportunityHealthState`, `OpportunityProviderHealthCounters`, all Opportunity telemetry/state helpers, the exported `opportunityHealthItem()`, and its entry in `getSystemHealthSnapshot()`. Remove only the corresponding Opportunity test setup and assertions.

- [ ] **Step 4: Remove service registry and deployment blocks**

Delete the `signal-hub-opportunity` object from `SIGNAL_HUB_SYSTEMD_SERVICES`. Delete the systemd unit creation block, `systemctl enable` call, and restart-list entry from `scripts/deploy-vps.sh`.

- [ ] **Step 5: Run the affected tests and commit**

Run:

```powershell
& $NODE src/lib/system-health.test.mjs
& $NODE src/lib/signal-hub-services.test.mjs
& $NODE scripts/deploy-vps.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add src/lib/system-health.ts src/lib/system-health.test.mjs src/lib/signal-hub-services.ts src/lib/signal-hub-services.test.mjs scripts/deploy-vps.sh scripts/deploy-vps.test.mjs
git commit -m "refactor: remove opportunity runtime integration"
```

### Task 3: Delete Opportunity API, Worker, Storage, and Documents

**Files:**
- Modify: `package.json`
- Delete: `src/app/api/opportunities/`
- Delete: `src/lib/opportunity-ai.ts`
- Delete: `src/lib/opportunity-ai.test.mjs`
- Delete: `src/lib/opportunity-rules.ts`
- Delete: `src/lib/opportunity-rules.test.mjs`
- Delete: `src/lib/opportunity-sources.ts`
- Delete: `src/lib/opportunity-sources.test.mjs`
- Delete: `src/lib/opportunity-store.ts`
- Delete: `src/lib/opportunity-store.test.mjs`
- Delete: `src/lib/opportunity-types.ts`
- Delete: `src/lib/opportunity-url.ts`
- Delete: `src/lib/opportunity-worker.ts`
- Delete: `src/lib/opportunity-worker.test.mjs`
- Delete: `scripts/opportunity-worker.mjs`
- Delete: `scripts/opportunity-worker-contract.test.mjs`
- Delete: `docs/superpowers/specs/2026-07-12-opportunity-radar-design.md`
- Delete: `docs/superpowers/specs/2026-07-14-opportunity-watch-tier-design.md`
- Delete: `docs/superpowers/plans/2026-07-12-opportunity-radar.md`
- Delete: `docs/superpowers/plans/2026-07-14-opportunity-watch-tier.md`

**Interfaces:**
- Consumes: no retained application interface.
- Produces: no Opportunity route, worker command, TypeScript module, or obsolete feature document in the working tree.

- [ ] **Step 1: Add a repository-level absence check**

After deleting the feature files, this command is the source contract:

```powershell
$hits = rg -n -S "OpportunityRadar|opportunityEnabled|OPPORTUNITY_RADAR_UI_ENABLED|signal-hub-opportunity|opportunity-worker|/api/opportunities|OPPORTUNITY_DB" src scripts package.json
if ($LASTEXITCODE -eq 0) { throw "Active Opportunity references remain:`n$hits" }
if ($LASTEXITCODE -ne 1) { throw "rg failed with exit code $LASTEXITCODE" }
```

- [ ] **Step 2: Remove package scripts**

Delete:

```json
"opportunity:worker": "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs",
"opportunity:worker:once": "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs --once"
```

Keep valid JSON punctuation around neighboring scripts.

- [ ] **Step 3: Delete all Opportunity-only files and routes**

Delete exactly the files and directory listed under this task. Do not delete the new removal design or this implementation plan.

- [ ] **Step 4: Run the absence check and commit**

Expected: `rg` exits with code `1`, meaning no active references remain.

```powershell
git add package.json
git add -u src/app/api/opportunities src/lib scripts docs/superpowers/specs docs/superpowers/plans
git commit -m "refactor: delete opportunity radar backend"
```

### Task 4: Full Local Verification

**Files:**
- Modify only if verification reveals a direct Opportunity-removal regression.

**Interfaces:**
- Consumes: the repository after Tasks 1-3.
- Produces: a production-buildable repository with all non-Opportunity behavior intact.

- [ ] **Step 1: Run the complete Node test suite**

Run:

```powershell
& $NODE scripts/run-tests.mjs
```

Expected: all remaining tests pass; the total test-file count decreases by the number of deleted Opportunity-only tests.

- [ ] **Step 2: Run lint**

Run:

```powershell
& $NODE node_modules/eslint/bin/eslint.js .
```

Expected: exit code `0`.

- [ ] **Step 3: Run the production build**

Run:

```powershell
& $NODE node_modules/next/dist/bin/next build
```

Expected: build succeeds and the generated route list contains no `/api/opportunities` route.

- [ ] **Step 4: Inspect the final diff and active references**

Run:

```powershell
git diff --check HEAD~3..HEAD
git status --short
rg -n -S "OpportunityRadar|opportunityEnabled|OPPORTUNITY_RADAR_UI_ENABLED|signal-hub-opportunity|opportunity-worker|/api/opportunities|OPPORTUNITY_DB" src scripts package.json
```

Expected: clean diff check, clean worktree, and no active Opportunity references.

- [ ] **Step 5: Push**

```powershell
git push origin main
```

### Task 5: Deploy and Remove VPS Runtime State

**Files:**
- Modify on VPS without printing contents: `/home/ubuntu/signal-hub/.env.local`
- Delete on VPS: `/etc/systemd/system/signal-hub-opportunity.service`
- Delete on VPS: `/home/ubuntu/signal-hub/.signal-hub/opportunities.sqlite`
- Delete on VPS: `/home/ubuntu/signal-hub/.signal-hub/opportunities.sqlite-wal`
- Delete on VPS: `/home/ubuntu/signal-hub/.signal-hub/opportunities.sqlite-shm`
- Modify locally without printing contents if present: `.env.local`

**Interfaces:**
- Consumes: the verified GitHub `main` commit.
- Produces: VPS web service on the same commit, no Opportunity service, database, or environment keys.

- [ ] **Step 1: Remove local Opportunity environment entries safely**

Parse `.env.local` line-by-line and write it back excluding lines whose key starts with `OPPORTUNITY_`. Report only the removed key names/count, never values.

- [ ] **Step 2: Stop and remove the named VPS service**

Run commands equivalent to:

```bash
sudo systemctl disable --now signal-hub-opportunity.service || true
sudo rm -f /etc/systemd/system/signal-hub-opportunity.service
sudo systemctl daemon-reload
sudo systemctl reset-failed signal-hub-opportunity.service || true
```

- [ ] **Step 3: Delete only the named Opportunity SQLite files**

Resolve `/home/ubuntu/signal-hub/.signal-hub` first and verify it is the expected runtime directory. Then delete only:

```text
opportunities.sqlite
opportunities.sqlite-wal
opportunities.sqlite-shm
```

- [ ] **Step 4: Remove VPS environment entries without exposing secrets**

Rewrite `/home/ubuntu/signal-hub/.env.local` excluding keys beginning with `OPPORTUNITY_`. Output only the removed key names/count.

- [ ] **Step 5: Pull, build, and restart the web app**

```bash
cd /home/ubuntu/signal-hub
git pull --ff-only origin main
/usr/bin/node node_modules/next/dist/bin/next build
sudo systemctl restart signal-hub-web
```

- [ ] **Step 6: Verify commit, service absence, database absence, and HTTP health**

Verify:

```bash
git rev-parse --short HEAD
systemctl list-unit-files --type=service | grep signal-hub-opportunity
test ! -e .signal-hub/opportunities.sqlite
test ! -e .signal-hub/opportunities.sqlite-wal
test ! -e .signal-hub/opportunities.sqlite-shm
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

Expected: VPS commit equals GitHub `main`, no Opportunity unit is listed, all three files are absent, and localhost returns HTTP `200` or the app's expected authentication redirect.

