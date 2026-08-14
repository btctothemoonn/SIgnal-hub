# Stocks FMP Earnings Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Stocks detail "结构与财报" block with a cached FMP quarterly earnings comparison showing revenue and net income actuals, estimates, YoY changes, surprise, and a concise AI insight.

**Architecture:** Add a pure quarterly comparison domain module, then extend the existing server-only FMP financial collector to fetch and align income statements, analyst estimates, and earnings calendar rows. Persist the comparison and cached insight inside the existing financial snapshot so the API and page keep one read path; render the new module in a focused component with deterministic fallbacks when estimates or AI are unavailable.

**Tech Stack:** Next.js App Router, React, TypeScript, Node test scripts (`tsx` loader), local JSON snapshot cache, FMP Stable API, existing MiniMax/DeepSeek OpenAI-compatible provider routing.

## Global Constraints

- Change only the Stocks feature; do not change Signal Flow, Holding, or Douyin behavior.
- Use FMP as the only data provider for this earnings comparison.
- Never derive revenue or net-income estimates from EPS, news text, or AI.
- Missing estimates render as `n/a`; partial provider failures preserve the last successful cached comparison.
- Store raw numeric values and format only in the UI.
- Match quarters by ticker plus fiscal year and quarter; allow fiscal-end-date fallback only within 7 days.
- Backfill eight quarterly periods for every stock in `ALPHA_RESEARCH_STOCKS`.
- Limit FMP stock concurrency to 3 by default, rotate configured keys, retry HTTP 429/5xx twice, and do not retry HTTP 401/402/403 in the same run.
- Keep `/api/stocks-financial-data` backward compatible by adding optional fields only.
- Do not expose provider API keys to the browser or logs.
- FMP consensus may differ from Futu/Moomoo S&P consensus; identify the source and accounting basis in the UI.
- Use existing card radii (`rounded-md`); do not introduce nested decorative cards.

---

### Task 1: Quarterly earnings comparison domain model

**Files:**
- Create: `src/lib/stocks-earnings-comparison.ts`
- Create: `src/lib/stocks-earnings-comparison.test.mjs`

**Interfaces:**
- Consumes: raw FMP income statement, analyst estimate, and earnings-calendar arrays.
- Produces: `StocksEarningsComparison`, `parseFmpQuarterlyEarnings(...)`, `calculateComparisonMetric(...)`, and `formatFiscalQuarter(...)`.

- [ ] **Step 1: Write the failing parser and calculation tests**

```js
const comparison = parseFmpQuarterlyEarnings("NBIS", {
  income: [
    { date: "2026-06-30", fiscalYear: "2026", period: "Q2", revenue: 582300000, netIncome: -190400000 },
    { date: "2025-06-30", fiscalYear: "2025", period: "Q2", revenue: 105100000, netIncome: -143600000 },
  ],
  estimates: [
    { date: "2026-06-30", fiscalYear: "2026", period: "Q2", estimatedRevenueAvg: 573937500, estimatedNetIncomeAvg: -273800000 },
  ],
  earnings: [{ date: "2026-08-12", fiscalDateEnding: "2026-06-30", time: "bmo" }],
}, { generatedAt: "2026-08-14T00:00:00.000Z" });

assert.equal(comparison?.quarter, "Q2");
assert.equal(comparison?.revenue.actual, 582300000);
assert.equal(comparison?.revenue.surprise, 8362500);
assert.equal(comparison?.revenue.surprisePct, 1.4570);
assert.equal(comparison?.netIncome.surprise, 83400000);
assert.equal(comparison?.netIncome.surprisePct, 30.4601);
assert.equal(comparison?.reportTiming, "before-market");
```

Also test negative estimates, zero estimates, missing estimates, previous-year matching, a 7-day date fallback, and rejection of an 8-day mismatch.

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node src/lib/stocks-earnings-comparison.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement raw-value types, strict matching, and formulas**

```ts
export type StocksEarningsMetricComparison = {
  estimate: number | null;
  actual: number | null;
  previousYearActual: number | null;
  estimateYoYPct: number | null;
  actualYoYPct: number | null;
  surprise: number | null;
  surprisePct: number | null;
};

export type StocksEarningsComparison = {
  ticker: string;
  fiscalYear: number;
  quarter: `Q${1 | 2 | 3 | 4}`;
  fiscalDateEnding: string;
  reportDate: string | null;
  reportTiming: "before-market" | "after-market" | "unknown";
  currency: string;
  accountingBasis: "FMP standardized";
  provider: "fmp";
  generatedAt: string;
  revenue: StocksEarningsMetricComparison;
  netIncome: StocksEarningsMetricComparison;
};

export function calculateComparisonMetric(
  actual: number | null,
  estimate: number | null,
  previousYearActual: number | null,
): StocksEarningsMetricComparison {
  const surprise = actual !== null && estimate !== null ? actual - estimate : null;
  const surprisePct = surprise !== null && estimate !== 0
    ? (surprise / Math.abs(estimate)) * 100
    : null;
  // YoY uses abs(previousYearActual) so loss narrowing is positive.
  return { estimate, actual, previousYearActual, surprise, surprisePct, estimateYoYPct, actualYoYPct };
}
```

- [ ] **Step 4: Run the domain tests**

Run: `node src/lib/stocks-earnings-comparison.test.mjs`

Expected: PASS with `ok - stocks earnings comparison`.

- [ ] **Step 5: Commit the domain model**

```bash
git add src/lib/stocks-earnings-comparison.ts src/lib/stocks-earnings-comparison.test.mjs
git commit -m "feat: add quarterly earnings comparison model"
```

### Task 2: FMP quarterly collection, retry, and full-pool coverage

**Files:**
- Modify: `src/lib/stocks-financial-data.ts`
- Modify: `src/lib/stocks-financial-data.test.mjs`

**Interfaces:**
- Consumes: `parseFmpQuarterlyEarnings(...)` from Task 1 and all `AlphaResearchStock[]` entries.
- Produces: optional `latestEarnings` and `earningsHistory` on each `StocksFinancialStatement`; existing fields remain unchanged.

- [ ] **Step 1: Add failing FMP transport tests**

Add fixtures asserting:

```js
assert.match(incomeUrl, /income-statement/);
assert.equal(new URL(incomeUrl).searchParams.get("period"), "quarter");
assert.equal(new URL(incomeUrl).searchParams.get("limit"), "9");
assert.match(estimatesUrl, /analyst-estimates/);
assert.match(earningsUrl, /\/stable\/earnings\?/);
assert.equal(Object.keys(snapshot.financials).length, stocks.length);
assert.equal(snapshot.financials.NBIS.latestEarnings.revenue.actual, 582300000);
assert.equal(snapshot.financials.NBIS.earningsHistory.length, 8);
```

Add one test where the first response is HTTP 429 and the second succeeds, one HTTP 402 test that records a plan error without retry, one concurrency test proving at most 3 tickers run simultaneously, and one partial failure test that still returns usable actuals with estimate fields `null`.

- [ ] **Step 2: Run the transport test and verify the old annual/capped behavior fails**

Run: `node src/lib/stocks-financial-data.test.mjs`

Expected: FAIL because the old collector requests annual statements, caps at eight tickers, and has no `latestEarnings`.

- [ ] **Step 3: Add the optional fields and bounded transport helper**

```ts
export type StocksFinancialStatement = AlphaResearchFinancialSnapshot & {
  ticker: string;
  periodLabel: string;
  source: StocksFinancialDataSource;
  updatedAt: string;
  latestEarnings?: StocksEarningsComparison | null;
  earningsHistory?: StocksEarningsComparison[];
};

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> { /* shared cursor with exactly `concurrency` runners */ }
```

Make `selectFmpFinancialStocks` return all filtered candidates unless `STOCKS_FMP_FINANCIAL_MAX_TICKERS` is explicitly set. Read concurrency from `STOCKS_FMP_FINANCIAL_CONCURRENCY`, default 3, maximum 8.

- [ ] **Step 4: Implement endpoint retry classification and quarterly fetches**

```ts
const retryable = status === 429 || status >= 500;
const terminalPlanError = [401, 402, 403].includes(status);
const delaysMs = [300, 900];

// Per ticker:
// income-statement period=quarter limit=9
// analyst-estimates period=quarter limit=12
// earnings limit=12
// keep current annual cash-flow/growth calls only for backward-compatible legacy fields
```

Rotate keys per attempt with `pickProviderApiKey(apiKeys, tickerIndex + attempt)`. Sanitize error strings so the `apikey` query value never appears.

- [ ] **Step 5: Parse, sort, and attach the newest eight comparisons**

```ts
const earningsHistory = parseFmpQuarterlyEarningsHistory(stock.ticker, payload, {
  generatedAt,
  limit: 8,
});
return {
  ...legacyStatement,
  latestEarnings: earningsHistory[0] ?? null,
  earningsHistory,
};
```

- [ ] **Step 6: Run financial tests**

Run: `node src/lib/stocks-financial-data.test.mjs`

Expected: PASS with no provider key in assertion output.

- [ ] **Step 7: Commit the FMP collector**

```bash
git add src/lib/stocks-financial-data.ts src/lib/stocks-financial-data.test.mjs
git commit -m "feat: collect FMP quarterly earnings"
```

### Task 3: Cached earnings insight with deterministic fallback

**Files:**
- Create: `src/lib/stocks-earnings-insight.ts`
- Create: `src/lib/stocks-earnings-insight.test.mjs`
- Modify: `src/lib/stocks-financial-data.ts`

**Interfaces:**
- Consumes: `StocksEarningsComparison` and existing AI provider candidates from `alpha-summary.ts`.
- Produces: `StocksEarningsInsight`, `buildDeterministicEarningsInsight(...)`, and `getOrCreateStocksEarningsInsight(...)`.

- [ ] **Step 1: Write failing deterministic and cache tests**

```js
const fallback = buildDeterministicEarningsInsight(comparison);
assert.match(fallback.conclusion, /营收超预期/);
assert.match(fallback.driver, /净亏损收窄/);
assert.equal(fallback.source, "rules");

const first = await getOrCreateStocksEarningsInsight({ comparison, fetchImpl, env, cacheDir });
const second = await getOrCreateStocksEarningsInsight({ comparison, fetchImpl, env, cacheDir });
assert.equal(fetchCalls, 1);
assert.deepEqual(second, first);
```

Also verify missing estimates never cause a fabricated beat/miss statement, malformed AI JSON falls back to rules, and the cache key changes when ticker/fiscal year/quarter changes.

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node src/lib/stocks-earnings-insight.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the insight contract and deterministic rules**

```ts
export type StocksEarningsInsight = {
  conclusion: string;
  driver: string;
  risk: string;
  source: "ai" | "rules";
  model: string | null;
  generatedAt: string;
};
```

Rules may describe only supplied numeric fields: revenue beat/miss, net-income beat/miss, growth/decline, and loss narrowing/widening. Do not infer products, customers, guidance, or valuation.

- [ ] **Step 4: Add one structured AI request per ticker-quarter**

```ts
const prompt = `Return JSON only with conclusion, driver, risk. Use only these supplied values; do not add causes not present in the data:\n${JSON.stringify(comparison)}`;
```

Use the existing MiniMax-first/DeepSeek-fallback provider candidate list. Validate all three returned strings, cache to the runtime directory using an atomic temp-file rename, and use rules on any provider error.

- [ ] **Step 5: Attach insight during server-side financial refresh**

Generate insight only when `latestEarnings` exists and the ticker-quarter cache is absent. Add optional `earningsInsight` to `StocksFinancialStatement`; never generate from the API route or browser request.

- [ ] **Step 6: Run insight and financial tests**

Run: `node src/lib/stocks-earnings-insight.test.mjs`

Run: `node src/lib/stocks-financial-data.test.mjs`

Expected: both PASS; repeated refreshes reuse the cached insight.

- [ ] **Step 7: Commit insight generation**

```bash
git add src/lib/stocks-earnings-insight.ts src/lib/stocks-earnings-insight.test.mjs src/lib/stocks-financial-data.ts
git commit -m "feat: cache earnings AI insights"
```

### Task 4: Snapshot preservation and API compatibility

**Files:**
- Modify: `src/lib/stocks-prewarm.ts`
- Modify: `src/lib/stocks-prewarm.test.mjs`
- Modify: `src/app/api/stocks-financial-data/route.test.mjs` if present; otherwise create it.

**Interfaces:**
- Consumes: extended `StocksFinancialSnapshot` from Tasks 2-3.
- Produces: the same `/api/stocks-financial-data` response shape plus optional earnings fields.

- [ ] **Step 1: Add failing stale-cache merge tests**

```js
const preserved = preserveSuccessfulFinancialEntries(previous, partial);
assert.deepEqual(preserved.financials.NBIS.latestEarnings, previous.financials.NBIS.latestEarnings);
assert.deepEqual(preserved.financials.NVDA.latestEarnings, partial.financials.NVDA.latestEarnings);
assert.match(preserved.errors.join(" "), /NBIS/);
```

Add an API contract assertion that old fields (`revenue`, `eps`, `nextEarningsDate`) remain and new fields are optional.

- [ ] **Step 2: Run cache/API tests and confirm missing-entry replacement fails**

Run: `node src/lib/stocks-prewarm.test.mjs`

Run: `node src/app/api/stocks-financial-data/route.test.mjs`

Expected: the preservation assertion fails against the current whole-snapshot replacement behavior.

- [ ] **Step 3: Preserve prior successful ticker entries on partial refreshes**

```ts
export function preserveSuccessfulFinancialEntries(
  previous: StocksFinancialSnapshot | null,
  next: StocksFinancialSnapshot,
): StocksFinancialSnapshot {
  if (!previous) return next;
  return { ...next, financials: { ...previous.financials, ...next.financials } };
}
```

Apply this only to `financial` snapshots before atomic cache write. Keep the newest `generatedAt`, provider, and errors while retaining older entries that failed this round.

- [ ] **Step 4: Run cache/API tests**

Run: `node src/lib/stocks-prewarm.test.mjs`

Run: `node src/app/api/stocks-financial-data/route.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit cache preservation**

```bash
git add src/lib/stocks-prewarm.ts src/lib/stocks-prewarm.test.mjs src/app/api/stocks-financial-data/route.test.mjs
git commit -m "fix: preserve cached earnings on partial refresh"
```

### Task 5: Earnings comparison UI

**Files:**
- Create: `src/components/stocks-earnings-brief.tsx`
- Create: `src/components/stocks-earnings-brief.test.mjs`
- Modify: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/alpha-stock-detail.test.mjs`

**Interfaces:**
- Consumes: `StocksEarningsComparison | null`, `StocksEarningsInsight | null`, cache metadata, and ticker.
- Produces: compact desktop/mobile earnings brief replacing the old “结构与财报” section.

- [ ] **Step 1: Write failing rendering tests**

```js
assert.match(output, /2026 Q2/);
assert.match(output, /营收/);
assert.match(output, /净利润/);
assert.match(output, /预计值/);
assert.match(output, /公布值/);
assert.match(output, /较预期/);
assert.match(output, /\+1\.46%/);
assert.match(output, /FMP/);
assert.doesNotMatch(output, /Structure Snapshot/);
```

Render a missing-estimate fixture and assert both estimate and surprise display `n/a`; render a failed-AI fixture and assert the deterministic insight remains visible.

- [ ] **Step 2: Run component tests and verify the component is missing**

Run: `node src/components/stocks-earnings-brief.test.mjs`

Run: `node src/components/alpha-stock-detail.test.mjs`

Expected: FAIL because the old detail still renders “Structure Snapshot / Earnings Brief”.

- [ ] **Step 3: Implement raw-value formatting and comparison rows**

```tsx
<div className="grid grid-cols-[minmax(5rem,1fr)_repeat(3,minmax(6rem,0.9fr))]">
  <span>指标</span><span>预计值</span><span>公布值</span><span>较预期</span>
  <MetricRow label="营收" metric={comparison.revenue} />
  <MetricRow label="净利润" metric={comparison.netIncome} />
</div>
```

Use compact USD formatting (`$582.30M`, `-$190.40M`) and signed percentage formatting. On narrow screens keep four aligned columns inside the panel with horizontal overflow only as a last resort; text must not overlap.

- [ ] **Step 4: Render report metadata and insight**

Show fiscal quarter, report date, timing (`盘前`/`盘后`/`时间未知`), currency, `FMP standardized`, provider, updated time, and cache status. Below the table render three short lines: `核心结论`, `主要驱动`, `风险提示`.

- [ ] **Step 5: Replace the old detail block**

Remove the current structure score, legacy six-field financial grid, and duplicate earnings brief from `alpha-stock-detail.tsx`. Keep the existing stock header, research conclusion, and tracking points unchanged.

- [ ] **Step 6: Run component tests**

Run: `node src/components/stocks-earnings-brief.test.mjs`

Run: `node src/components/alpha-stock-detail.test.mjs`

Expected: PASS with missing data rendered as `n/a`.

- [ ] **Step 7: Commit the UI**

```bash
git add src/components/stocks-earnings-brief.tsx src/components/stocks-earnings-brief.test.mjs src/components/alpha-stock-detail.tsx src/components/alpha-stock-detail.test.mjs
git commit -m "feat: replace stocks earnings brief UI"
```

### Task 6: Full verification, browser review, and release

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: verified local build, committed branch, GitHub update, and VPS deployment.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node src/lib/stocks-earnings-comparison.test.mjs
node src/lib/stocks-financial-data.test.mjs
node src/lib/stocks-earnings-insight.test.mjs
node src/lib/stocks-prewarm.test.mjs
node src/components/stocks-earnings-brief.test.mjs
node src/components/alpha-stock-detail.test.mjs
node src/components/alpha-research-page.test.mjs
```

Expected: all print `ok` and exit 0.

- [ ] **Step 2: Run the full test suite and production build**

Run: `npm test`

Run: `npm run build`

Expected: all tests pass and Next.js build exits 0.

- [ ] **Step 3: Start the local server and visually verify Stocks**

Verify desktop at 1440x900 and mobile at 390x844:

- selected ticker header is not duplicated;
- revenue/net-income columns align;
- negative net income and surprise colors are semantically correct;
- `n/a` is visible when the FMP estimate entitlement is unavailable;
- no text overlap or page-wide horizontal scroll;
- switching tickers does not trigger direct provider calls.

- [ ] **Step 4: Commit any verification fixes**

```bash
git add <only verified task files>
git commit -m "fix: polish FMP earnings brief"
```

- [ ] **Step 5: Push and deploy**

Push `main`, pull the exact commit on the VPS, run the production build, restart the web and Stocks worker services, and confirm both services are active.

- [ ] **Step 6: Verify production behavior**

Check `https://holdrich.online/stocks`, `/api/stocks-financial-data`, VPS service logs, and the financial cache file. Confirm the API key is absent from browser responses/logs and document whether FMP analyst estimates are available or currently show the expected plan-error fallback.

---

## Self-Review

- Spec coverage: domain calculations, strict quarter alignment, eight-quarter history, full research pool, concurrency/retry/key rotation, stale-cache preservation, API compatibility, AI caching/fallback, compact UI, provenance, and VPS verification each map to a task.
- Placeholder scan: no `TBD`, `TODO`, “similar to”, or unspecified error-handling steps remain.
- Type consistency: `StocksEarningsComparison` and `StocksEarningsInsight` are defined once and consumed by the financial snapshot and UI using the same names.
