# Signal Hub Production Hardening Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch the public Next.js deployment, bound login attempts, eliminate browser-driven duplicate AI generations, and prevent hidden Telegram ingestion channels from displacing visible messages.

**Architecture:** Keep the existing single-process Next.js web service and existing workers. Add a small pure login limiter, make the alpha-summary worker the owner of scheduled generation while the browser only polls, coalesce same-scope summary work in process, and move Telegram source exclusion ahead of SQL limiting.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node.js `node:sqlite`, native Node test scripts, pnpm.

## Global Constraints

- Do not remove or rename user-visible features.
- Do not change Signal Flow layout, data sources, worker intervals, AI providers, or the 30-day admin cookie.
- Pin `next` and `eslint-config-next` to the same patched 16.2.x version at or above 16.2.6.
- Every behavior change follows red-green-refactor and receives a focused commit.

---

### Task 1: Patch Next.js Security Advisories

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing Next.js 16 App Router application.
- Produces: a lockfile resolving `next` and `eslint-config-next` to the same patched version.

- [ ] **Step 1: Capture the current audit failure**

Run:

```powershell
pnpm audit --prod --audit-level moderate
```

Expected: FAIL and report the Next.js proxy/middleware advisories affecting 16.2.1.

- [ ] **Step 2: Upgrade the paired Next packages conservatively**

Run:

```powershell
pnpm add --save-exact next@16.2.6
pnpm add --save-dev --save-exact eslint-config-next@16.2.6
```

Expected: `package.json` and `pnpm-lock.yaml` update without changing React or application dependencies.

- [ ] **Step 3: Verify the patched dependency set**

Run:

```powershell
pnpm audit --prod --audit-level high
pnpm lint
pnpm build
```

Expected: no high-severity Next.js advisory; lint and build pass.

- [ ] **Step 4: Commit**

```powershell
git add package.json pnpm-lock.yaml
git commit -m "chore: patch Next.js security advisories"
```

### Task 2: Bound Admin Login Failures

**Files:**
- Create: `src/lib/login-rate-limit.ts`
- Create: `src/lib/login-rate-limit.test.mjs`
- Modify: `src/app/api/login/route.ts`
- Create: `src/app/api/login/route.test.mjs`

**Interfaces:**
- Produces: `getLoginClientKey(request)`, `checkLoginRateLimit(key, nowMs?)`, `recordLoginFailure(key, nowMs?)`, `clearLoginFailures(key)`, and `resetLoginRateLimitsForTests()`.
- Consumes: the existing `verifyAdminPassword` and redirect behavior.

- [ ] **Step 1: Write failing limiter tests**

Create assertions covering five allowed failures, a blocked sixth attempt, unlock after fifteen minutes, successful reset, independent client keys, and first-IP extraction:

```js
assert.equal(checkLoginRateLimit("ip:1", now).allowed, true);
for (let index = 0; index < 5; index += 1) recordLoginFailure("ip:1", now + index);
assert.equal(checkLoginRateLimit("ip:1", now + 5).allowed, false);
assert.equal(checkLoginRateLimit("ip:1", now + 15 * 60_000 + 5).allowed, true);
clearLoginFailures("ip:1");
assert.equal(checkLoginRateLimit("ip:1", now + 6).allowed, true);
assert.equal(checkLoginRateLimit("ip:2", now + 6).allowed, true);
assert.equal(
  getLoginClientKey(new Request("https://holdrich.online/api/login", {
    headers: { "x-forwarded-for": "203.0.113.7, 127.0.0.1" },
  })),
  "ip:203.0.113.7",
);
```

- [ ] **Step 2: Run the limiter test and verify RED**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/login-rate-limit.test.mjs
```

Expected: FAIL because `login-rate-limit.ts` does not exist.

- [ ] **Step 3: Implement the bounded in-memory limiter**

Use these constants and record shape:

```ts
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

type FailureRecord = {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
};

const failures = new Map<string, FailureRecord>();
```

Normalize the request key from the first `x-forwarded-for` address, then `x-real-ip`, then `unknown`. Expired records must be deleted during checks. The fifth recorded failure sets `lockedUntil` to `now + LOGIN_FAILURE_WINDOW_MS`.

- [ ] **Step 4: Run the limiter test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write a failing login-route contract test**

Assert that the route imports the limiter, checks before password verification, records invalid attempts, and clears failures after success:

```js
assert.match(source, /checkLoginRateLimit\(clientKey\)/);
assert.match(source, /recordLoginFailure\(clientKey\)/);
assert.match(source, /clearLoginFailures\(clientKey\)/);
```

- [ ] **Step 6: Run the route test and verify RED**

```powershell
node src/app/api/login/route.test.mjs
```

Expected: FAIL because the route is not wired to the limiter.

- [ ] **Step 7: Wire the limiter into login POST**

At the start of `POST`, compute `clientKey` and return the existing invalid-login redirect when blocked. Record every failed password and clear the key immediately before issuing a successful session cookie. Do not expose retry metadata in the redirect.

- [ ] **Step 8: Verify and commit**

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/login-rate-limit.test.mjs
node src/app/api/login/route.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/admin-auth.test.mjs
git add src/lib/login-rate-limit.ts src/lib/login-rate-limit.test.mjs src/app/api/login/route.ts src/app/api/login/route.test.mjs
git commit -m "security: throttle repeated admin logins"
```

### Task 3: Make Scheduled AI Generation Worker-Owned

**Files:**
- Modify: `src/components/alpha-summary-card.tsx`
- Create: `src/components/alpha-summary-card-scheduling.test.mjs`
- Modify: `src/lib/alpha-summary.ts`
- Create: `src/lib/alpha-summary-single-flight.test.mjs`

**Interfaces:**
- Produces: `runAlphaSummarySingleFlight<T>(key, factory)` for same-key in-process request coalescing.
- Preserves: cached GET polling and manual forced POST generation.

- [ ] **Step 1: Write a failing browser scheduling contract test**

```js
assert.match(source, /const pollTimer = window\.setInterval/);
assert.doesNotMatch(source, /const generateTimer = window\.setInterval/);
assert.match(source, /method: force \? "POST" : "GET"/);
```

- [ ] **Step 2: Run the scheduling test and verify RED**

```powershell
node src/components/alpha-summary-card-scheduling.test.mjs
```

Expected: FAIL because `generateTimer` still exists.

- [ ] **Step 3: Remove only the automatic force timer**

Delete creation and cleanup of `generateTimer`. Keep `pollTimer`, the initial cached load, and `loadSummary(true, scope)` used by the manual button.

- [ ] **Step 4: Verify the scheduling test GREEN**

Run the command from Step 2.

- [ ] **Step 5: Write a failing single-flight test**

Use a deferred promise and assert two calls with one key execute one factory while another key executes independently:

```js
const first = runAlphaSummarySingleFlight("signals:12h", factory);
const second = runAlphaSummarySingleFlight("signals:12h", factory);
assert.equal(first, second);
assert.equal(calls, 1);
```

- [ ] **Step 6: Run the single-flight test and verify RED**

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/alpha-summary-single-flight.test.mjs
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 7: Implement and apply single-flight**

Add a module-level map and helper:

```ts
const alphaSummaryFlights = new Map<string, Promise<unknown>>();

export function runAlphaSummarySingleFlight<T>(key: string, factory: () => Promise<T>) {
  const existing = alphaSummaryFlights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const run = factory().finally(() => {
    if (alphaSummaryFlights.get(key) === run) alphaSummaryFlights.delete(key);
  });
  alphaSummaryFlights.set(key, run);
  return run;
}
```

Move the existing body to an internal function and make exported `getOrCreateAlphaSummary` normalize audience/scope, build `${audience}:${scope}`, and call the helper.

- [ ] **Step 8: Verify and commit**

```powershell
node src/components/alpha-summary-card-scheduling.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/alpha-summary-single-flight.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/alpha-summary.test.mjs
git add src/components/alpha-summary-card.tsx src/components/alpha-summary-card-scheduling.test.mjs src/lib/alpha-summary.ts src/lib/alpha-summary-single-flight.test.mjs
git commit -m "fix: prevent duplicate scheduled AI summaries"
```

### Task 4: Filter Hidden Telegram Sources Before Limiting

**Files:**
- Modify: `src/lib/telegram-pipeline-store.ts`
- Modify: `src/lib/telegram-pipeline-x-source-filter.test.mjs`
- Modify: `src/lib/telegram-pipeline-store.test.mjs`

**Interfaces:**
- Preserves: `getTelegramPipelineSnapshot(limit, db, options)` and its response shape.
- Changes: SQL input rows exclude configured X-source channel IDs before `LIMIT`.

- [ ] **Step 1: Strengthen the existing regression test**

Keep more than 120 newer hidden messages and one older visible `au_call` message. Assert both `getTelegramPipelineSnapshot(100)` and `getTelegramPipelineSnapshot(1)` return `au_call`.

- [ ] **Step 2: Run the regression test and verify RED**

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/telegram-pipeline-x-source-filter.test.mjs
```

Expected: FAIL on the limit-one assertion with an empty feed.

- [ ] **Step 3: Apply hidden-channel exclusion in SQL**

Derive `hiddenChannelIds` from enabled channel rows using `isTelegramXSourceChannel`. Add an optional clause before the date filter:

```sql
where telegram_messages.channel_id not in (?, ...)
```

Build all predicates in one `WHERE` clause, bind hidden IDs first, optional `since` second, and feed limit last. Retain the existing JavaScript filter for unmatched legacy rows.

- [ ] **Step 4: Verify Telegram tests GREEN**

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/telegram-pipeline-x-source-filter.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/telegram-pipeline-store.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add src/lib/telegram-pipeline-store.ts src/lib/telegram-pipeline-x-source-filter.test.mjs src/lib/telegram-pipeline-store.test.mjs
git commit -m "fix: filter hidden Telegram sources before limit"
```

### Task 5: Restore the Quality Gate and Deploy

**Files:**
- Modify: `src/components/alpha-sector-list.test.mjs`
- Modify: `src/components/signals-responsive-layout.test.mjs`
- Modify: `package.json`
- Modify: `scripts/deploy-vps.sh`

**Interfaces:**
- Produces: `pnpm test` as the canonical test command.
- Deployment consumes: lint, tests, and build before any service restart.

- [ ] **Step 1: Refresh stale UI contracts**

Update the stock-name assertion to match the current separate Chinese/English lines and update the Signal Flow grid assertion to the current `1.42fr/26rem` layout. Run both tests and confirm PASS.

- [ ] **Step 2: Add a failing deployment contract assertion**

Extend `scripts/deploy-vps.test.mjs` to require `pnpm test` and `pnpm lint` before the build command.

- [ ] **Step 3: Run the deployment test and verify RED**

```powershell
node scripts/deploy-vps.test.mjs
```

Expected: FAIL because the deployment script currently runs only build.

- [ ] **Step 4: Add the canonical test runner**

Create `scripts/run-tests.mjs` that recursively discovers `src/**/*.test.mjs` and `scripts/**/*.test.mjs`, runs each with the current Node executable plus `--experimental-strip-types --experimental-transform-types`, streams failures, and exits non-zero if any test fails. Add:

```json
"test": "node scripts/run-tests.mjs"
```

to `package.json`.

- [ ] **Step 5: Gate VPS deployment**

Before build, add:

```bash
"$NODE_BIN" scripts/run-tests.mjs
"$NODE_BIN" node_modules/eslint/bin/eslint.js .
```

This avoids relying on a globally installed package manager on the VPS.

- [ ] **Step 6: Run full verification**

```powershell
pnpm test
pnpm lint
pnpm audit --prod --audit-level high
pnpm build
git diff --check
git status --short
```

Expected: all tests pass, lint has no errors, no high audit findings, build passes, and only intended files are modified.

- [ ] **Step 7: Commit, push, and deploy**

```powershell
git add package.json scripts/run-tests.mjs scripts/deploy-vps.sh scripts/deploy-vps.test.mjs src/components/alpha-sector-list.test.mjs src/components/signals-responsive-layout.test.mjs
git commit -m "ci: gate deployment on project checks"
git push origin main
ssh ubuntu@43.128.146.48 'cd /home/ubuntu/signal-hub && bash scripts/deploy-vps.sh'
```

- [ ] **Step 8: Production smoke check**

Verify HTTPS login, one visible TG feed item under source-channel load, cached AI summary loading without a forced POST, manual regeneration, and all `signal-hub-*` services active.
