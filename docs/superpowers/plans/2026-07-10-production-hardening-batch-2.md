# Signal Hub Production Hardening Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining dependency, build-tracing, and React lint warnings without reducing Signal Hub functionality.

**Architecture:** Release 2A applies narrow transitive dependency overrides, marks runtime-only cache paths for Turbopack, and removes low-risk lint findings. Release 2B introduces a hydration-safe browser storage boundary and replaces synchronous effect repairs with cached snapshots, keyed state boundaries, derived state, or scheduled request lifecycles.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript, pnpm 11, Node test scripts, ESLint 9, systemd on Ubuntu 24.04.

## Global Constraints

- Keep every existing Signal Flow, Stocks, Holding, Douyin, AI, Telegram, X, and worker feature.
- Preserve API response shapes, runtime configuration keys, cache formats, refresh intervals, and authentication behavior.
- Preserve Signal Flow reading position, unread counts, author favorites, filters, and live-update viewport stability.
- Use TDD for every behavior change and commit each independently reviewable task.
- Release 2A and Release 2B are pushed and deployed independently.

---

## Release 2A: Dependency And Build Hygiene

### Task 1: Override Vulnerable Transitive Dependencies

**Files:**
- Create: `scripts/dependency-overrides.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: pnpm override resolution.
- Produces: `postcss@8.5.16` and `ip-address@10.2.0` throughout the production dependency graph.

- [ ] **Step 1: Write the failing override contract test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

assert.equal(pkg.pnpm?.overrides?.postcss, "8.5.16");
assert.equal(pkg.pnpm?.overrides?.["ip-address"], "10.2.0");
console.log("ok - production dependency overrides are pinned");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/dependency-overrides.test.mjs`

Expected: FAIL because `package.json` has no `pnpm.overrides` block.

- [ ] **Step 3: Add the exact overrides**

```json
"pnpm": {
  "overrides": {
    "postcss": "8.5.16",
    "ip-address": "10.2.0"
  }
}
```

- [ ] **Step 4: Regenerate the lockfile without running package scripts**

Run: `pnpm install --ignore-scripts`

Expected: lockfile resolves `postcss@8.5.16` and `ip-address@10.2.0`.

- [ ] **Step 5: Verify the graph and audit**

Run: `pnpm why postcss ip-address`

Expected: all production paths use the pinned fixed versions.

Run: `pnpm audit --prod`

Expected: `No known vulnerabilities found` and exit code 0.

- [ ] **Step 6: Run the focused test and commit**

Run: `node scripts/dependency-overrides.test.mjs`

Expected: PASS.

```bash
git add package.json pnpm-lock.yaml scripts/dependency-overrides.test.mjs
git commit -m "security: override vulnerable transitive dependencies"
```

### Task 2: Stop Turbopack From Tracing Runtime Cache Paths

**Files:**
- Modify: `src/lib/runtime-storage.ts`
- Modify: `src/lib/stocks-catalyst-source.ts`
- Modify: `src/lib/stocks-catalyst-source.test.mjs`

**Interfaces:**
- Consumes: `SIGNAL_HUB_RUNTIME_DIR` and existing Stocks/Patreon path overrides.
- Produces: the same runtime paths with Turbopack runtime-only annotations.

- [ ] **Step 1: Add a failing source contract test**

Append assertions that require runtime-only annotations at every dynamic path boundary:

```js
const runtimeStorageSource = readFileSync(
  new URL("./runtime-storage.ts", import.meta.url),
  "utf8",
);

assert.match(runtimeStorageSource, /turbopackIgnore:\s*true/);
assert.match(source, /resolve\(\/\*\s*turbopackIgnore:\s*true\s*\*\/\s*configured\)/);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/stocks-catalyst-source.test.mjs`

Expected: FAIL because no runtime-only annotations exist.

- [ ] **Step 3: Mark the runtime directory boundary**

Keep the configured root behavior unchanged and annotate only the default
workspace-derived path:

```ts
if (configured) return configured;

return isVercelRuntime(env)
  ? join(tmpdir(), "signal-hub")
  : join(/* turbopackIgnore: true */ process.cwd(), ".signal-hub");
```

Mark the two environment-configured catalyst paths with the same annotation:

```ts
return configured
  ? resolve(/* turbopackIgnore: true */ configured)
  : getRuntimeDataPath(env, "stocks-catalysts-cache.json");
```

```ts
return configured
  ? resolve(/* turbopackIgnore: true */ configured)
  : getRuntimeDataPath(env, "stocks-patreon-history.json");
```

- [ ] **Step 4: Run focused tests**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/stocks-catalyst-source.test.mjs`

Expected: PASS, including custom runtime path and cache persistence cases.

- [ ] **Step 5: Run the production build and inspect warnings**

Run: `node node_modules/next/dist/bin/next build`

Expected: build succeeds and does not print `Encountered unexpected file in NFT list`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/runtime-storage.ts src/lib/stocks-catalyst-source.ts src/lib/stocks-catalyst-source.test.mjs
git commit -m "perf: keep stocks cache paths out of build tracing"
```

### Task 3: Remove Low-Risk Lint Findings

**Files:**
- Create: `src/components/telegram-live-panel-render-purity.test.mjs`
- Modify: `src/components/telegram-live-panel.tsx`
- Modify: `src/lib/alpha-summary.ts`
- Modify: `src/lib/stocks-financial-data.ts`
- Modify: `src/lib/alpha-summary.test.mjs`
- Modify: `src/lib/stocks-financial-data.test.mjs`

**Interfaces:**
- Consumes: existing refresh throttling and exported financial/summary helpers.
- Produces: identical runtime behavior without render-time clock access or dead helpers.

- [ ] **Step 1: Add failing source contracts**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./telegram-live-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /useRef\(0\)/);
assert.doesNotMatch(source, /useRef\(Date\.now\(\)\)/);
console.log("ok - Telegram refresh clock initializes after render");
```

Add dead-code assertions to the existing summary and financial tests:

```js
assert.doesNotMatch(source, /function shanghaiLocalToUtcIso/);
assert.doesNotMatch(source, /function fmpApiKey/);
```

- [ ] **Step 2: Run the three tests and confirm failures**

Run: `node src/components/telegram-live-panel-render-purity.test.mjs`

Run: `node --experimental-strip-types --experimental-transform-types src/lib/alpha-summary.test.mjs`

Run: `node --experimental-strip-types --experimental-transform-types src/lib/stocks-financial-data.test.mjs`

Expected: each new assertion fails.

- [ ] **Step 3: Implement the minimal cleanup**

Initialize the ref without reading the clock during render:

```ts
const lastRefreshAtRef = useRef(0);

useEffect(() => {
  lastRefreshAtRef.current = Date.now();
}, []);
```

Delete the two unused functions and no other summary or financial behavior.

- [ ] **Step 4: Run focused tests and ESLint**

Run the three focused commands from Step 2.

Run: `node node_modules/eslint/bin/eslint.js .`

Expected: zero errors; the purity and two unused-variable warnings are absent.

- [ ] **Step 5: Commit**

```bash
git add src/components/telegram-live-panel.tsx src/components/telegram-live-panel-render-purity.test.mjs src/lib/alpha-summary.ts src/lib/alpha-summary.test.mjs src/lib/stocks-financial-data.ts src/lib/stocks-financial-data.test.mjs
git commit -m "perf: remove render clock and dead helpers"
```

### Task 4: Verify And Deploy Release 2A

**Files:**
- No source changes expected.

**Interfaces:**
- Produces: a separately verified and deployed Release 2A checkpoint.

- [ ] **Step 1: Run the complete local gate**

Run: `node scripts/run-tests.mjs`

Expected: all discovered test files pass.

Run: `node node_modules/eslint/bin/eslint.js .`

Expected: zero errors and fewer than 17 warnings.

Run: `pnpm audit --prod`

Expected: zero vulnerabilities.

Run: `node node_modules/next/dist/bin/next build`

Expected: successful build without the NFT whole-project tracing warning.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
ssh ubuntu@43.128.146.48 'cd /home/ubuntu/signal-hub && bash scripts/deploy-vps.sh'
```

- [ ] **Step 3: Verify the release checkpoint**

Verify on the VPS:

```bash
git rev-parse --short HEAD
pnpm why postcss ip-address
systemctl is-active signal-hub-web signal-hub-telegram signal-hub-x-hybrid signal-hub-stocks-cache signal-hub-alpha-summary signal-hub-monitor985 signal-hub-tiger-holdings signal-hub-douyin
curl -sSI http://127.0.0.1:3000/login
```

Expected: deployed commit matches GitHub, fixed dependency versions are resolved, all services are active, and login returns HTTP 200.

---

## Release 2B: React State And Effect Cleanup

### Task 5: Add Hydration-Safe Browser Storage And DOM Stores

**Files:**
- Create: `src/lib/browser-storage-store.ts`
- Create: `src/lib/browser-storage-store.test.mjs`
- Create: `src/components/use-browser-json-cache.ts`
- Modify: `src/components/unified-news-panel.tsx`
- Modify: `src/lib/signal-feed-author-filter.ts`
- Modify: `src/lib/signal-feed-author-filter.test.mjs`
- Modify: `src/lib/unified-news-panel-contract.test.mjs`

**Interfaces:**
- Produces:
  - `readBrowserStorage(key: string): string | null`
  - `writeBrowserStorage(key: string, value: string): void`
  - `subscribeBrowserStorage(key: string, listener: () => void): () => void`
  - `useBrowserJsonCache<T>(key: string): readonly [T | null, (value: T) => void]`
  - `effectiveSignalFeedAuthorFilter(filter: string, options: SignalFeedAuthorOption[]): string`

- [ ] **Step 1: Write failing pure store and filter tests**

Test that storage reads return null on access errors, writes dispatch a same-tab change event, subscriptions ignore unrelated keys, JSON parsing failures return null, and an absent author option resolves to `ALL_SIGNAL_FEED_AUTHOR_FILTER`.

Core filter assertion:

```js
assert.equal(
  effectiveSignalFeedAuthorFilter("x:missing", [{ value: "x:known" }]),
  ALL_SIGNAL_FEED_AUTHOR_FILTER,
);
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/browser-storage-store.test.mjs`

Run: `node --experimental-strip-types --experimental-transform-types src/lib/signal-feed-author-filter.test.mjs`

Expected: FAIL because the new interfaces do not exist.

- [ ] **Step 3: Implement the storage boundary**

```ts
const BROWSER_STORAGE_EVENT = "signal-hub:storage-change";

export function readBrowserStorage(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(BROWSER_STORAGE_EVENT, { detail: key }));
  } catch {
    // Browser privacy and quota failures keep in-memory UI usable.
  }
}
```

Implement the hook with `useSyncExternalStore`, a null server snapshot, and memoized JSON parsing.

- [ ] **Step 4: Replace Signal Flow repair effects**

- Read favorites through the external store instead of `setAuthorFavorites` on mount.
- Write favorites through `writeBrowserStorage`.
- Resolve `portalRoot` with a hydration-safe `useSyncExternalStore` DOM snapshot.
- Replace the invalid-author repair effect with `effectiveSignalFeedAuthorFilter` and use the effective value for filtering, labels, and active menu state.
- Reset the raw author filter to `ALL_SIGNAL_FEED_AUTHOR_FILTER` in the explicit tab selection handler.
- Schedule seen-item watermark updates with a cancellable microtask so the effect does not synchronously cascade state.

- [ ] **Step 5: Run Signal Flow tests and ESLint**

Run: `node src/lib/unified-news-panel-contract.test.mjs`

Run: `node src/components/unified-news-panel-reading-position.test.mjs`

Run: `node src/components/unified-news-panel-mobile.test.mjs`

Run: `node node_modules/eslint/bin/eslint.js src/components/unified-news-panel.tsx`

Expected: tests pass and the four previous UnifiedNewsPanel effect warnings are absent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/browser-storage-store.ts src/lib/browser-storage-store.test.mjs src/components/use-browser-json-cache.ts src/components/unified-news-panel.tsx src/lib/signal-feed-author-filter.ts src/lib/signal-feed-author-filter.test.mjs src/lib/unified-news-panel-contract.test.mjs
git commit -m "perf: replace signal flow repair effects"
```

### Task 6: Refactor Stocks Polling And AI Summary Scope State

**Files:**
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/alpha-summary-card.tsx`
- Modify: `src/components/alpha-summary-card-scheduling.test.mjs`
- Modify: `src/components/alpha-summary-card-layout.test.mjs`

**Interfaces:**
- Consumes: `useBrowserJsonCache<T>` from Task 5.
- Produces: cached Stocks display without synchronous effect state writes and a keyed summary result boundary per scope.

- [ ] **Step 1: Add failing component contracts**

Require AlphaResearchPage to consume `useBrowserJsonCache`, prohibit cache-loading `setMarketSnapshot`, `setFinancialSnapshot`, and `setCatalystSnapshot` calls at effect entry, and require a keyed scope result component in AlphaSummaryCard.

```js
assert.match(source, /useBrowserJsonCache/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]*?setMarketSnapshot\(/);
assert.match(summarySource, /key=\{scope\}/);
assert.doesNotMatch(summarySource, /setSnapshot\(null\)/);
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `node src/components/alpha-research-page.test.mjs`

Run: `node src/components/alpha-summary-card-scheduling.test.mjs`

Run: `node src/components/alpha-summary-card-layout.test.mjs`

Expected: FAIL on the new contracts.

- [ ] **Step 3: Refactor Stocks cached snapshots**

Use the hook for market, financial, catalyst, and performance cache keys. Keep live request results in component state and derive display snapshots as `liveSnapshot ?? cachedSnapshot`. For performance data, include the ticker key with the live result and only display it when it matches the current sector key.

Polling effects perform fetches and timer subscription only. Preserve 5-minute, 30-minute, and 2-minute intervals exactly.

- [ ] **Step 4: Split the summary scope result boundary**

Keep scope tabs in `AlphaSummaryCard`. Move `snapshot`, `busy`, `manualMessage`, request tracking, GET polling, and POST regeneration into:

```ts
function AlphaSummaryScopeResult({
  scope,
  audience,
  endpoint,
  compact,
  showHeaderMeta,
}: AlphaSummaryScopeResultProps) {
  // Scope-local request and display state.
}
```

Render it with `<AlphaSummaryScopeResult key={scope} scope={scope} ... />`. The child fetches once on mount and starts the existing scope-specific poll interval without resetting state in an effect.

- [ ] **Step 5: Run focused tests and ESLint**

Run the three focused test commands from Step 2.

Run: `node node_modules/eslint/bin/eslint.js src/components/alpha-research-page.tsx src/components/alpha-summary-card.tsx`

Expected: all tests pass and the five previous warnings are absent.

- [ ] **Step 6: Commit**

```bash
git add src/components/alpha-research-page.tsx src/components/alpha-research-page.test.mjs src/components/alpha-summary-card.tsx src/components/alpha-summary-card-scheduling.test.mjs src/components/alpha-summary-card-layout.test.mjs
git commit -m "perf: isolate stocks polling and summary scope state"
```

### Task 7: Refactor Holding, Health, And Navigation Effects

**Files:**
- Modify: `src/components/holding-panel.tsx`
- Modify: `src/components/holding-panel.test.mjs`
- Modify: `src/components/us-stock-holding-panel.tsx`
- Modify: `src/components/us-stock-holding-panel.test.mjs`
- Modify: `src/components/system-health-panel.tsx`
- Modify: `src/components/system-health-panel.test.mjs`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.mjs`

**Interfaces:**
- Produces: scheduled initial request lifecycles and derived optimistic navigation state.

- [ ] **Step 1: Add failing source contracts**

Require effect-owned zero-delay timers for initial loaders and prohibit direct `void load()` calls inside effects. Require AppShell to store `{ origin, target }` pending navigation instead of mirroring `activeNav` in an effect.

```js
assert.match(source, /window\.setTimeout\(\(\) => void load\(\), 0\)/);
assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void load\(\)/);
assert.doesNotMatch(appShellSource, /setOptimisticActiveNav\(activeNav\)/);
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `node src/components/holding-panel.test.mjs`

Run: `node src/components/us-stock-holding-panel.test.mjs`

Run: `node src/components/system-health-panel.test.mjs`

Run: `node src/components/app-shell.test.mjs`

Expected: FAIL on the new contracts.

- [ ] **Step 3: Schedule initial request lifecycles**

For each initial loader effect:

```ts
useEffect(() => {
  const timer = window.setTimeout(() => void load(), 0);
  return () => {
    window.clearTimeout(timer);
    abortRef.current?.abort();
  };
}, [load]);
```

Keep manual refresh calls synchronous to the user event. Keep existing abort controllers and interval cleanup.

- [ ] **Step 4: Derive optimistic navigation**

Store pending navigation with the route that initiated it:

```ts
const [pendingNav, setPendingNav] = useState<{
  origin: AppShellNavKey;
  target: AppShellNavKey;
} | null>(null);
const displayedActiveNav =
  pendingNav?.origin === activeNav ? pendingNav.target : activeNav;
```

Navigation handlers set `{ origin: activeNav, target }`. Use `displayedActiveNav` in desktop and mobile active styling. Delete the mirroring effect and remove the unused `useEffect` import.

- [ ] **Step 5: Run focused tests and ESLint**

Run the four focused commands from Step 2.

Run: `node node_modules/eslint/bin/eslint.js src/components/holding-panel.tsx src/components/us-stock-holding-panel.tsx src/components/system-health-panel.tsx src/components/app-shell.tsx`

Expected: all tests pass and the five previous loader/navigation warnings are absent.

- [ ] **Step 6: Commit**

```bash
git add src/components/holding-panel.tsx src/components/holding-panel.test.mjs src/components/us-stock-holding-panel.tsx src/components/us-stock-holding-panel.test.mjs src/components/system-health-panel.tsx src/components/system-health-panel.test.mjs src/components/app-shell.tsx src/components/app-shell.test.mjs
git commit -m "perf: remove synchronous loader and navigation effects"
```

### Task 8: Verify And Deploy Release 2B

**Files:**
- No source changes expected unless verification reveals a regression.

**Interfaces:**
- Produces: zero-warning production build and deployed Release 2B.

- [ ] **Step 1: Run the complete local gate**

Run: `node scripts/run-tests.mjs`

Expected: all discovered test files pass.

Run: `node node_modules/eslint/bin/eslint.js . --max-warnings 0`

Expected: zero errors and zero warnings.

Run: `pnpm audit --prod`

Expected: zero vulnerabilities.

Run: `node node_modules/next/dist/bin/next build`

Expected: successful build without the NFT warning.

- [ ] **Step 2: Run browser smoke tests**

Verify locally at desktop and mobile widths:

- Signal Flow opens at latest messages and does not jump when new items arrive.
- `last read`, `latest`, and `bottom` actions still work.
- Author favorites persist after reload and filters reset safely across tabs.
- Stocks immediately displays cached data, changes sector curves correctly, and refreshes.
- AI summary scope switching and manual regeneration work.
- Binance, tracked accounts, Tiger, and system health load and refresh.

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
ssh ubuntu@43.128.146.48 'cd /home/ubuntu/signal-hub && bash scripts/deploy-vps.sh'
```

- [ ] **Step 4: Verify production**

Run the VPS commit/service/login checks from Task 4. Confirm the VPS lint gate reports zero warnings and the HTTPS login page returns HTTP 200.

- [ ] **Step 5: Record residual warnings**

Only Node experimental SQLite and module-type runtime warnings may remain. Record them as deferred runtime modernization work; do not suppress them in application code.
