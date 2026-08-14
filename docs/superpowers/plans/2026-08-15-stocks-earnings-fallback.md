# STOCKS Earnings Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Hynix premium curve from STOCKS only and fill missing earnings estimates/actuals from existing fallback providers without fabricating or mixing fiscal periods.

**Architecture:** Keep FMP as the primary quarterly statement provider. Add a focused `stocks-earnings-fallback.ts` layer that normalizes Finnhub, EODHD, Alpha Vantage, and Yahoo payloads into period-keyed candidates, then merges only missing fields into the FMP comparison and records field-level provenance. The Stocks cache worker performs all external calls; the UI remains cache-only.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, existing JSON snapshot cache and provider API keys.

## Global Constraints

- Provider order is FMP, Finnhub, EODHD, Alpha Vantage, then Yahoo where applicable.
- Direct values always outrank `EPS × diluted shares` derived values.
- Match by normalized ticker plus fiscal year/quarter, or fiscal period end within 7 days.
- Never combine different fiscal quarters and never let AI invent financial values.
- Alternative providers are called only for fields still missing after FMP.
- All-provider failure displays a specific status instead of a blank cell or fake number.
- Remove Hynix premium only from STOCKS; preserve the Signal homepage component, APIs, cache, and alerts.
- Do not add a paid API or expose provider keys to the browser.

---

### Task 1: Add field-level provenance and safe comparison merging

**Files:**
- Modify: `src/lib/stocks-earnings-comparison.ts`
- Modify: `src/lib/stocks-earnings-comparison.test.mjs`
- Modify: `src/lib/stocks-prewarm.ts`
- Modify: `src/lib/stocks-prewarm.test.mjs`

**Interfaces:**
- Produces: `StocksEarningsValueProvenance`, optional `estimateSource` and `actualSource` on each metric.
- Produces: `mergeEarningsMetricValues(metric, patch)` that recalculates YoY and surprise values after a field is filled.
- Consumes: existing `calculateComparisonMetric` and cache preservation logic.

- [ ] **Step 1: Write failing provenance and merge tests**

```js
const filled = mergeEarningsMetricValues(baseMetric, {
  estimate: 573_937_500,
  estimateSource: { provider: "finnhub", method: "direct" },
});
assert.equal(filled.actual, 582_300_000);
assert.equal(filled.estimateSource.provider, "finnhub");
assert.ok(Math.abs(filled.surprisePct - 1.45704) < 0.00001);
```

Add a cache test proving a previous direct FMP estimate is not replaced by a later derived estimate and its provenance remains attached.

- [ ] **Step 2: Run tests and verify RED**

Run: `node src/lib/stocks-earnings-comparison.test.mjs && node src/lib/stocks-prewarm.test.mjs`

Expected: FAIL because provenance fields and `mergeEarningsMetricValues` do not exist.

- [ ] **Step 3: Implement the model and merge helper**

```ts
export type StocksEarningsProvider =
  | "fmp"
  | "finnhub"
  | "eodhd"
  | "alpha-vantage"
  | "yahoo";

export type StocksEarningsValueProvenance = {
  provider: StocksEarningsProvider;
  method: "direct" | "eps-times-diluted-shares";
};
```

Add optional `estimateSource` and `actualSource` to `StocksEarningsMetricComparison`. Make the FMP parser assign direct FMP provenance. Update cache merging to preserve direct values before derived values and to copy provenance with the winning value.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node src/lib/stocks-earnings-comparison.test.mjs && node src/lib/stocks-prewarm.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stocks-earnings-comparison.ts src/lib/stocks-earnings-comparison.test.mjs src/lib/stocks-prewarm.ts src/lib/stocks-prewarm.test.mjs
git commit -m "feat: track earnings value provenance"
```

### Task 2: Build the period-safe multi-provider fallback layer

**Files:**
- Create: `src/lib/stocks-earnings-fallback.ts`
- Create: `src/lib/stocks-earnings-fallback.test.mjs`
- Reuse: `src/lib/provider-api-keys.ts`

**Interfaces:**
- Produces: `StocksEarningsFallbackCandidate` with fiscal identity, revenue, net income, EPS, diluted shares, report metadata, and provider.
- Produces: `completeStocksEarningsComparison({ ticker, base, fetchImpl, env })` returning `{ comparison, errors }`.
- Consumes: `mergeEarningsMetricValues` from Task 1.

- [ ] **Step 1: Write failing parser and provider-order tests**

Cover:

```js
assert.equal(parseFinnhubEarningsCandidate(finnhubPayload, target).revenueEstimate, 573_937_500);
assert.equal(parseEodhdEarningsCandidate(eodhdPayload, target).epsEstimate, -2.74);
assert.equal(parseAlphaVantageEarningsCandidate(avPayload, target).netIncomeActual, -190_400_000);
assert.equal(deriveNetIncome(-2.74, 100_000_000), -274_000_000);
```

Add an orchestration test where FMP already has all four values and `fetchImpl` must receive zero fallback requests. Add another where the FMP estimate is missing, Finnhub fills revenue, Finnhub EPS plus FMP diluted shares fills net income, and EODHD/Alpha Vantage are not called.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node src/lib/stocks-earnings-fallback.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalized candidates and URL builders**

Use existing environment names:

```ts
const finnhubKeys = getProviderApiKeys(env, [
  "STOCKS_FINNHUB_API_KEYS", "STOCKS_FINNHUB_API_KEY",
  "FINNHUB_API_KEYS", "FINNHUB_API_KEY",
]);
const eodhdKeys = getProviderApiKeys(env, [
  "STOCKS_EODHD_API_KEYS", "STOCKS_EODHD_API_KEY",
  "EODHD_API_KEYS", "EODHD_API_KEY",
]);
```

Implement these calls only when needed:

- Finnhub `/api/v1/calendar/earnings` for revenue actual/estimate and EPS actual/estimate.
- EODHD `/api/calendar/trends` for revenue/EPS estimate.
- Alpha Vantage `INCOME_STATEMENT` for quarterly actuals and `EARNINGS_ESTIMATES` for revenue/EPS estimate.
- Yahoo `incomeStatementHistoryQuarterly` only as the final actual-value fallback.

Normalize US symbols for EODHD with `.US` and `000660.KS` with `.KO`. Provider errors return diagnostics without keys.

- [ ] **Step 4: Implement safe completion and derivation**

```ts
const derivedNetIncome =
  candidate.netIncomeEstimate ??
  deriveNetIncome(candidate.epsEstimate, candidate.dilutedShares ?? baseDilutedShares);
```

Merge a candidate only when its fiscal identity matches the target. Stop requesting providers once every missing field is filled. Direct data replaces a derived value; derived data never replaces direct data.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node src/lib/stocks-earnings-fallback.test.mjs`

Expected: PASS with provider order and request count assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stocks-earnings-fallback.ts src/lib/stocks-earnings-fallback.test.mjs
git commit -m "feat: add earnings data fallbacks"
```

### Task 3: Wire fallbacks into the financial worker and cache

**Files:**
- Modify: `src/lib/stocks-financial-data.ts`
- Modify: `src/lib/stocks-financial-data.test.mjs`
- Modify: `src/lib/stocks-financial-quarterly.test.mjs`
- Modify: `src/lib/stocks-prewarm.test.mjs`

**Interfaces:**
- Consumes: `completeStocksEarningsComparison` from Task 2.
- Produces: `latestEarnings` and first `earningsHistory` record with completed values and provenance.

- [ ] **Step 1: Write failing integration tests**

Create a response sequence where FMP income succeeds, FMP analyst estimates returns HTTP 402, and Finnhub returns revenue/EPS consensus. Assert that:

```js
assert.equal(snapshot.financials.NBIS.latestEarnings.revenue.estimate, 573_937_500);
assert.equal(snapshot.financials.NBIS.latestEarnings.revenue.estimateSource.provider, "finnhub");
assert.equal(snapshot.financials.NBIS.latestEarnings.netIncome.estimateSource.method, "eps-times-diluted-shares");
```

Add a test where FMP income is unavailable and Alpha Vantage quarterly income creates the latest comparison instead of dropping the ticker.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `node src/lib/stocks-financial-data.test.mjs && node src/lib/stocks-financial-quarterly.test.mjs && node src/lib/stocks-prewarm.test.mjs`

Expected: FAIL because fallback completion is not wired.

- [ ] **Step 3: Integrate completion after FMP parsing**

For each ticker, call the fallback layer only if the latest comparison is missing one of:

```ts
comparison.revenue.estimate
comparison.revenue.actual
comparison.netIncome.estimate
comparison.netIncome.actual
```

Replace `latestEarnings` and the matching first history record with the completed comparison. When FMP income fails, allow the fallback layer to construct a comparison from the latest period-safe actual candidate. Append sanitized provider failures to `snapshot.errors` while retaining successful fields.

- [ ] **Step 4: Verify cache preservation**

Ensure `preserveSuccessfulFinancialEntries` retains the last complete comparison when a later refresh loses provider coverage, while accepting newer direct values for the same fiscal period.

- [ ] **Step 5: Run integration tests and verify GREEN**

Run: `node src/lib/stocks-financial-data.test.mjs && node src/lib/stocks-financial-quarterly.test.mjs && node src/lib/stocks-prewarm.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stocks-financial-data.ts src/lib/stocks-financial-data.test.mjs src/lib/stocks-financial-quarterly.test.mjs src/lib/stocks-prewarm.test.mjs
git commit -m "feat: complete cached earnings comparisons"
```

### Task 4: Show provenance and remove STOCKS Hynix premium

**Files:**
- Modify: `src/components/stocks-earnings-brief.tsx`
- Modify: `src/components/stocks-earnings-brief.test.mjs`
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/alpha-research-page.behavior.test.mjs`
- Verify unchanged: `src/components/signals-responsive-layout.tsx`
- Verify unchanged: `src/components/signals-responsive-layout.test.mjs`

**Interfaces:**
- Consumes: metric provenance from Task 1.
- Produces: non-empty financial cells with provider/method labels.

- [ ] **Step 1: Write failing UI and isolation tests**

Assert the earnings card renders `Finnhub` and `EPS 推算`, renders `数据源未覆盖` for a null estimate, and no longer renders literal `n/a` for financial cells. Change the STOCKS page contract to reject `StocksHynixPremiumCurve`, while the Signal layout contract must still require it.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node src/components/stocks-earnings-brief.test.mjs && node src/components/alpha-research-page.test.mjs && node src/components/alpha-research-page.behavior.test.mjs && node src/components/signals-responsive-layout.test.mjs`

Expected: FAIL on the new UI and STOCKS isolation assertions.

- [ ] **Step 3: Implement provenance labels and explicit missing states**

Map providers to compact labels:

```ts
const providerLabel = {
  fmp: "FMP", finnhub: "Finnhub", eodhd: "EODHD",
  "alpha-vantage": "AV", yahoo: "Yahoo",
};
```

Render the label below each estimate/actual. For null values render `等待公布` when the report is future/unpublished, otherwise `数据源未覆盖`. Derived values include an `EPS 推算` badge.

- [ ] **Step 4: Remove only the STOCKS mount**

Delete the `StocksHynixPremiumCurve` import and `<StocksHynixPremiumCurve />` from `alpha-research-page.tsx`. Remove its test stub and invert the page assertions. Do not edit the component, API routes, Signal layout, or Signal tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node src/components/stocks-earnings-brief.test.mjs && node src/components/alpha-research-page.test.mjs && node src/components/alpha-research-page.behavior.test.mjs && node src/components/signals-responsive-layout.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/stocks-earnings-brief.tsx src/components/stocks-earnings-brief.test.mjs src/components/alpha-research-page.tsx src/components/alpha-research-page.test.mjs src/components/alpha-research-page.behavior.test.mjs
git commit -m "fix: complete stocks earnings display"
```

### Task 5: Full verification, GitHub push, and VPS deployment

**Files:**
- Verify: all changed files
- Deploy with: `scripts/deploy-vps.sh`

**Interfaces:**
- Consumes: completed implementation from Tasks 1-4.
- Produces: verified GitHub and VPS revisions.

- [ ] **Step 1: Run full local verification**

Run:

```powershell
node scripts/run-tests.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

Expected: all test files pass, Next.js production build exits 0, and diff check is clean.

- [ ] **Step 2: Review request behavior**

Verify tests prove complete FMP data produces no fallback calls and partial data stops at the first provider that fills all gaps. Confirm no provider key appears in snapshots, errors, or client bundles.

- [ ] **Step 3: Push GitHub**

```bash
git push origin main
```

- [ ] **Step 4: Deploy VPS**

Run the existing SSH deployment command with `scripts/deploy-vps.sh`. Confirm the VPS revision equals local `HEAD`, the web and worker services are active, and `/stocks` returns the expected authenticated redirect.

- [ ] **Step 5: Verify cached data**

After one forced financial-worker refresh, inspect only summary metadata: number of tickers with complete revenue/estimate values, provider distribution, and sanitized errors. Do not print API keys or secret environment values.

