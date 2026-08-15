# STOCKS Calendar-Year Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-quarter STOCKS earnings brief with a current-calendar-year list of up to four verified quarters, including a release within 15 days at the top, while ensuring every reported quarter displays revenue and net-income estimate/actual values.

**Architecture:** Keep the existing structured API waterfall, add a pure calendar-selection/completeness layer, and add isolated official/public provider adapters for dates, consensus, and reported actuals. Persist the resulting `calendarYearEarnings` list beside the compatible `latestEarnings` field, then render it as compact vertical quarter cards on desktop and mobile. Every numeric field retains source provenance; company guidance remains separate from analyst consensus.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Node test runner, Cheerio for structured public HTML parsing, existing JSON cache/prewarm worker, FMP/Finnhub/EODHD/Alpha Vantage/Yahoo, SEC public JSON, official IR pages, public consensus pages.

## Global Constraints

- Scope is STOCKS only. Signal Flow, Holding, Douyin, and the Signal-home Hynix premium module must not change.
- The default list uses `reportDate` calendar year, not company fiscal year, and contains at most four items.
- In 2026 show only reports released or scheduled in 2026; after the calendar changes to 2027, automatically show only 2027 records. Never backfill a prior calendar year to reach four items.
- Include an upcoming quarter only when its verified release date is between 0 and 15 days away, sort it first, and show actual values as `等待公布`.
- A reported quarter is complete only when revenue estimate, revenue actual, net-income estimate, and net-income actual are all present.
- An upcoming quarter is displayable only when revenue estimate and net-income estimate are present.
- Missing values must not be replaced by fabricated numbers, `0`, a company guidance midpoint, or an unrelated fiscal period.
- Company guidance must remain visibly separate from analyst consensus and must not participate in surprise calculations.
- Derived net income is allowed only as `EPS × diluted weighted-average shares` when currency, per-share unit, share period, and fiscal-period matching are all verified; provenance must say `eps-times-diluted-shares`.
- Public collection must use pages accessible without login or paywall, parse structured JSON/JSON-LD/tables/stable labels only, use a fixed User-Agent and timeout, cache results for 12 hours, and isolate provider failures.
- Official IR/SEC wins for report dates and actuals; analyst consensus comes from structured APIs first, then a public consensus page.
- Keep `latestEarnings` and `earningsHistory` for backward compatibility; the new UI consumes `calendarYearEarnings`.
- All new behavior is test-driven. Run focused tests after each task and `npm test` plus `npm run build` before deployment.

---

## File Map

- Create `src/lib/stocks-earnings-calendar.ts`: calendar-year data types, completeness rules, 15-day upcoming window, sorting, and four-item selection.
- Create `src/lib/stocks-earnings-calendar.test.mjs`: pure rule coverage including the NVDA 2026-08-15 acceptance case.
- Modify `src/lib/stocks-earnings-comparison.ts`: expand provider provenance to official/public providers without changing metric-comparison behavior.
- Create `src/lib/stocks-earnings-source-config.ts`: per-ticker official IR metadata and SEC identity lookup configuration.
- Create `src/lib/stocks-earnings-public-sources.ts`: SEC, official IR, and public consensus fetch/parse adapters with timeout and cache.
- Create `src/lib/stocks-earnings-public-sources.test.mjs`: fixture-based parser, source-priority, timeout, and malformed-page tests.
- Modify `src/lib/stocks-financial-data.ts`: merge API and public candidates, create upcoming records, complete reported quarters, and output `calendarYearEarnings`.
- Modify `src/lib/stocks-financial-data.test.mjs` and `src/lib/stocks-financial-quarterly.test.mjs`: source-waterfall and period-matching integration coverage.
- Modify `src/lib/stocks-prewarm.ts`: normalize, merge, preserve, and current-year-filter the new list in cache.
- Modify `src/lib/stocks-prewarm.test.mjs`: cache migration, stale data, and year rollover coverage.
- Modify `src/lib/alpha-research-pool.ts`: expose `calendarYearEarnings` to the STOCKS detail model.
- Modify `src/components/alpha-stock-detail.tsx`: pass the list to the earnings component.
- Modify `src/components/stocks-earnings-brief.tsx`: render current-year quarter cards and explicit source/completeness states.
- Modify `src/components/stocks-earnings-brief.test.mjs` and `src/components/alpha-stock-detail.test.mjs`: desktop/mobile content and wiring tests.
- Modify `package.json` and the lockfile: add `cheerio` as the HTML parser dependency.

---

### Task 1: Calendar-Year Model and Hard Completeness Rules

**Files:**
- Create: `src/lib/stocks-earnings-calendar.ts`
- Create: `src/lib/stocks-earnings-calendar.test.mjs`
- Modify: `src/lib/stocks-earnings-comparison.ts`
- Test: `src/lib/stocks-earnings-comparison.test.mjs`

**Interfaces:**
- Consumes: existing `StocksEarningsComparison` and `StocksEarningsValueProvenance`.
- Produces:

```ts
export type StocksEarningsStatus = "upcoming" | "reported" | "incomplete";

export type StocksEarningsMissingField =
  | "revenue-estimate"
  | "revenue-actual"
  | "net-income-estimate"
  | "net-income-actual";

export type StocksEarningsSourceRef = {
  provider: StocksEarningsProvider;
  url: string | null;
  fetchedAt: string;
  confidence: "official" | "structured" | "public-page";
};

export type StocksCompanyGuidance = {
  revenueLow: number | null;
  revenueHigh: number | null;
  revenueMid: number | null;
  currency: string;
  source: StocksEarningsSourceRef;
};

export type StocksCalendarEarningsItem = StocksEarningsComparison & {
  status: StocksEarningsStatus;
  reportDateSource: StocksEarningsSourceRef | null;
  companyGuidance: StocksCompanyGuidance | null;
  completeness: {
    complete: boolean;
    missing: StocksEarningsMissingField[];
    attemptedProviders: StocksEarningsProvider[];
  };
};

export function assessCalendarEarningsCompleteness(
  item: StocksCalendarEarningsItem,
): StocksCalendarEarningsItem["completeness"];

export function buildCalendarYearEarnings(input: {
  now: Date;
  comparisons: StocksCalendarEarningsItem[];
  calendarYear?: number;
  maxItems?: number;
}): StocksCalendarEarningsItem[];
```

- Extend `StocksEarningsProvider` with `"official-ir" | "sec" | "earnings-labs" | "chartmill"` and allow `StocksEarningsComparison.provider` to be any `StocksEarningsProvider` while preserving existing FMP output.

- [ ] **Step 1: Write failing calendar-rule tests**

Add fixtures for FY2027 Q2 report date `2026-08-26`, FY2027 Q1 `2026-05-20`, older 2026 quarters, and a 2025 quarter. Assert:

```js
const visible = buildCalendarYearEarnings({
  now: new Date("2026-08-15T00:00:00Z"),
  comparisons: [q2Upcoming, q1Reported, q4Reported, q3Reported, priorYear],
});
assert.deepEqual(visible.map((item) => `${item.fiscalYear}-${item.quarter}`), [
  "2027-Q2",
  "2027-Q1",
  "2026-Q4",
  "2026-Q3",
]);
assert.equal(visible[0].status, "upcoming");
assert.equal(visible.some((item) => item.reportDate?.startsWith("2025-")), false);
```

Also assert that Q2 is hidden on `2026-08-10` (16 days away), appears on `2026-08-11`, and that a `2027-01-01` call returns only 2027 report dates.

- [ ] **Step 2: Run the new test and verify failure**

Run: `node src/lib/stocks-earnings-calendar.test.mjs`

Expected: FAIL because `stocks-earnings-calendar.ts` and its exports do not exist.

- [ ] **Step 3: Implement provider/type expansion and completeness assessment**

Implement `assessCalendarEarningsCompleteness()` so reported items require all four values and upcoming items require the two estimates only. Preserve attempted-provider order without duplicates.

```ts
const missing: StocksEarningsMissingField[] = [];
if (item.revenue.estimate === null) missing.push("revenue-estimate");
if (item.status !== "upcoming" && item.revenue.actual === null) {
  missing.push("revenue-actual");
}
if (item.netIncome.estimate === null) missing.push("net-income-estimate");
if (item.status !== "upcoming" && item.netIncome.actual === null) {
  missing.push("net-income-actual");
}
return { ...item.completeness, complete: missing.length === 0, missing };
```

- [ ] **Step 4: Implement natural-year filtering and sorting**

Normalize all report dates to UTC calendar days. Reject invalid dates. Include a future item only when `0 <= daysUntilReport <= 15`; include past/current-day items from the requested calendar year. Sort upcoming first, then `reportDate` descending, deduplicate by `ticker/fiscalYear/quarter`, and slice to `maxItems ?? 4`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node src/lib/stocks-earnings-calendar.test.mjs
node src/lib/stocks-earnings-comparison.test.mjs
```

Expected: both PASS.

- [ ] **Step 6: Commit the rule layer**

```powershell
git add src/lib/stocks-earnings-calendar.ts src/lib/stocks-earnings-calendar.test.mjs src/lib/stocks-earnings-comparison.ts src/lib/stocks-earnings-comparison.test.mjs
git commit -m "feat: add calendar-year earnings rules"
```

---

### Task 2: Official and Public Earnings Source Adapters

**Files:**
- Create: `src/lib/stocks-earnings-source-config.ts`
- Create: `src/lib/stocks-earnings-public-sources.ts`
- Create: `src/lib/stocks-earnings-public-sources.test.mjs`
- Modify: `package.json`
- Modify: lockfile present in the repository

**Interfaces:**
- Consumes: `StocksEarningsProvider`, `StocksEarningsSourceRef`, and `StocksCompanyGuidance` from Task 1; `AlphaResearchStock.listing` for US/KR routing.
- Produces:

```ts
export type StocksPublicEarningsCandidate = {
  ticker: string;
  fiscalYear: number;
  quarter: StocksEarningsComparison["quarter"];
  fiscalDateEnding: string;
  reportDate: string;
  reportTiming: StocksEarningsComparison["reportTiming"];
  currency: string;
  revenueEstimate: number | null;
  revenueActual: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  dilutedShares: number | null;
  netIncomeActual: number | null;
  companyGuidance: StocksCompanyGuidance | null;
  fieldSources: Partial<Record<
    "reportDate" | "revenueEstimate" | "revenueActual" | "epsEstimate" |
    "epsActual" | "dilutedShares" | "netIncomeActual" | "companyGuidance",
    StocksEarningsSourceRef
  >>;
};

export async function fetchPublicEarningsCandidates(input: {
  stock: AlphaResearchStock;
  now: Date;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ candidates: StocksPublicEarningsCandidate[]; errors: string[] }>;
```

- `STOCKS_SEC_USER_AGENT` is required for SEC calls and must contain an application/contact string. If absent, SEC is skipped with a diagnostic while other providers continue.
- Source configuration exposes `getStocksEarningsSourceConfig(ticker)` with `secCik`, `officialIrUrls`, and provider ticker aliases. NVDA must include its official results/news URL family and SEC CIK.

- [ ] **Step 1: Install the structured HTML parser**

Run: `npm install cheerio`

Expected: `cheerio` is added to dependencies and the repository lockfile changes.

- [ ] **Step 2: Write failing fixture-based parser tests**

Use inline HTML fixtures, not live network, for:

1. EarningsLabs historical table containing `Quarter`, `Date`, `Revenue Estimate`, `Revenue Actual`, `EPS Estimate`, and `EPS Actual`.
2. ChartMill-style upcoming consensus labels containing report date, revenue consensus, and EPS consensus.
3. Official IR JSON-LD/event markup containing report date and timing.
4. Malformed HTML and HTTP 429/500 responses.

Assert the EarningsLabs fixture yields a FY2027 Q1 candidate with `78_420_000_000` revenue estimate and `81_610_000_000` revenue actual, and the upcoming fixture yields a FY2027 Q2 candidate without actuals.

- [ ] **Step 3: Run the provider test and verify failure**

Run: `node src/lib/stocks-earnings-public-sources.test.mjs`

Expected: FAIL because the provider module does not exist.

- [ ] **Step 4: Implement source configuration**

Create a frozen config keyed by research ticker. Use provider aliases derived from the ticker by default, and add explicit `secCik` and official IR URLs for US research names. Route KOSPI names away from SEC. Do not embed secrets or session cookies.

```ts
export type StocksEarningsSourceConfig = {
  secCik: string | null;
  officialIrUrls: string[];
  earningsLabsTicker: string;
  chartmillTicker: string;
};
```

- [ ] **Step 5: Implement bounded fetch and in-process cache helpers**

Use an 8-second `AbortController` timeout, `User-Agent`, a per-ticker maximum of four provider requests per refresh, and a 12-hour cache keyed by provider/ticker/calendar-year. Cache successful parsed candidates only; return provider-specific diagnostics for timeout, 4xx/5xx, and schema mismatch.

- [ ] **Step 6: Implement SEC and official IR adapters**

- SEC: use `https://data.sec.gov/submissions/CIK##########.json` for filing/report dates and `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` for official actual revenue, net income, EPS, and diluted shares. Accept only `10-Q`, `10-K`, `20-F`, `40-F`, `6-K`, or `8-K` facts whose fiscal period/date matches within seven days.
- Official IR: parse JSON-LD event dates first, then explicit event/date labels. Extract guidance only from explicit phrases such as `revenue is expected to be` with a currency and range/tolerance.

- [ ] **Step 7: Implement public consensus adapters**

Use Cheerio table/header matching rather than page-wide number guessing. EarningsLabs supplies historical estimate-vs-actual rows. ChartMill supplies upcoming revenue/EPS consensus when a stable labeled row exists. Reject a candidate when ticker, quarter, date, or unit cannot be established.

- [ ] **Step 8: Run focused provider tests**

Run: `node src/lib/stocks-earnings-public-sources.test.mjs`

Expected: PASS, including malformed-page and timeout isolation tests.

- [ ] **Step 9: Commit provider adapters**

```powershell
git add package.json package-lock.json pnpm-lock.yaml src/lib/stocks-earnings-source-config.ts src/lib/stocks-earnings-public-sources.ts src/lib/stocks-earnings-public-sources.test.mjs
git commit -m "feat: add public earnings source fallbacks"
```

Only add the lockfile that exists; do not create a second package-manager lockfile.

---

### Task 3: Build Complete Current-Year Earnings in the Financial Snapshot

**Files:**
- Modify: `src/lib/stocks-financial-data.ts`
- Modify: `src/lib/stocks-financial-data.test.mjs`
- Modify: `src/lib/stocks-financial-quarterly.test.mjs`
- Modify: `src/lib/alpha-research-pool.ts`

**Interfaces:**
- Consumes: `buildCalendarYearEarnings()`, `assessCalendarEarningsCompleteness()`, and `fetchPublicEarningsCandidates()`.
- Produces:

```ts
export type StocksFinancialStatement = AlphaResearchFinancialSnapshot & {
  // existing fields remain
  calendarYearEarnings?: StocksCalendarEarningsItem[];
};

export async function completeCalendarYearEarnings(input: {
  stock: AlphaResearchStock;
  apiHistory: StocksEarningsComparison[];
  now: Date;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ items: StocksCalendarEarningsItem[]; errors: string[] }>;
```

- [ ] **Step 1: Write failing NVDA integration tests**

At `now = 2026-08-15`, stub API history with only reported FY2027 Q1 and public sources with:

- Official FY2027 Q2 report date `2026-08-26`.
- Q2 revenue consensus and EPS consensus.
- Q1 revenue estimate/actual, EPS estimate/actual, diluted shares, and official net-income actual.

Assert:

```js
assert.equal(statement.calendarYearEarnings[0].quarter, "Q2");
assert.equal(statement.calendarYearEarnings[0].status, "upcoming");
assert.notEqual(statement.calendarYearEarnings[0].revenue.estimate, null);
assert.notEqual(statement.calendarYearEarnings[0].netIncome.estimate, null);
assert.equal(statement.calendarYearEarnings[0].revenue.actual, null);
assert.equal(statement.calendarYearEarnings[1].quarter, "Q1");
assert.equal(statement.calendarYearEarnings[1].completeness.complete, true);
```

Also assert that a company-guidance midpoint does not fill `revenue.estimate`.

- [ ] **Step 2: Run integration tests and verify failure**

Run:

```powershell
node src/lib/stocks-financial-data.test.mjs
node src/lib/stocks-financial-quarterly.test.mjs
```

Expected: FAIL because `calendarYearEarnings` is not produced.

- [ ] **Step 3: Implement candidate-to-comparison conversion**

Merge only records with the same ticker, fiscal year, quarter, and fiscal end date within seven days. For each field use this priority:

1. Official IR/SEC for actuals and report date.
2. Existing structured APIs for direct consensus/actuals.
3. EarningsLabs for historical consensus/actuals.
4. ChartMill for upcoming consensus.

Build derived net-income estimate only when `epsEstimate`, matching diluted shares, currency, and period are present:

```ts
const netIncomeEstimate =
  candidate.epsEstimate !== null && candidate.dilutedShares !== null
    ? candidate.epsEstimate * candidate.dilutedShares
    : null;
```

Set provenance to `method: "eps-times-diluted-shares"`, `metric: "net-income"`, `semantics: "consensus-estimate"`, and retain the public provider.

- [ ] **Step 4: Create the upcoming quarter only from a verified date**

Advance from the latest reported fiscal period by one quarter only if official IR, SEC filing calendar, structured earnings calendar, EarningsLabs, or ChartMill confirms the report date. Never synthesize an upcoming quarter from the current date alone.

- [ ] **Step 5: Continue the fallback waterfall until hard completeness is met**

For each current-year reported period, continue providers until all four required values are present or all configured providers have been attempted. For the upcoming period, continue until both estimates are present. Record attempted providers and diagnostics. Do not stop merely because Alpha Vantage returned actuals.

- [ ] **Step 6: Populate snapshot and merge model**

Assign the selected list to `financials[ticker].calendarYearEarnings`. Preserve `latestEarnings = earningsHistory[0] ?? null` for existing AI insight and compatibility. Add the same optional list field to `AlphaResearchFinancialSnapshot` and propagate it in `mergeStocksFinancialSnapshot()`.

- [ ] **Step 7: Run financial tests**

Run:

```powershell
node src/lib/stocks-financial-data.test.mjs
node src/lib/stocks-financial-quarterly.test.mjs
node src/lib/alpha-research-pool.test.mjs
```

Expected: PASS. The NVDA acceptance fixture shows FY2027 Q2 above FY2027 Q1 and Q1 has all four required values.

- [ ] **Step 8: Commit snapshot integration**

```powershell
git add src/lib/stocks-financial-data.ts src/lib/stocks-financial-data.test.mjs src/lib/stocks-financial-quarterly.test.mjs src/lib/alpha-research-pool.ts src/lib/alpha-research-pool.test.mjs
git commit -m "feat: build complete calendar-year earnings snapshots"
```

---

### Task 4: Cache Preservation, Refresh Cadence, and Year Rollover

**Files:**
- Modify: `src/lib/stocks-prewarm.ts`
- Modify: `src/lib/stocks-prewarm.test.mjs`

**Interfaces:**
- Consumes: `StocksCalendarEarningsItem[]` and the existing `sameEarningsPeriod()`/metric priority behavior.
- Produces: cache normalization and merge behavior that never regresses a verified field to null or a lower-priority source for the same period.

- [ ] **Step 1: Write failing cache tests**

Cover these exact cases:

1. Previous cache has a complete Q1 and next refresh has actuals but missing estimates: retain the complete Q1.
2. Next refresh adds Q2 upcoming: merge Q2 at top and retain Q1.
3. On `2027-01-01`, a cache containing 2026 records returns no 2026 default-list entries.
4. More than four current-year records are reduced to four after merge.
5. A public-page parser failure does not erase previous verified values.

- [ ] **Step 2: Run the cache test and verify failure**

Run: `node src/lib/stocks-prewarm.test.mjs`

Expected: FAIL because normalization/merge ignores `calendarYearEarnings`.

- [ ] **Step 3: Normalize and merge calendar items**

Extend `normalizeStocksFinancialStatement()` to normalize every metric source and completeness field. Merge by `${ticker}-${fiscalYear}-${quarter}` using the existing value-priority rules, then call `buildCalendarYearEarnings({ now: new Date(), comparisons: merged })` before writing/returning cache.

- [ ] **Step 4: Apply refresh cadence**

- Normal financial cache: 12 hours for official dates/public consensus.
- An upcoming report within 15 days: refresh financial data every 2 hours.
- Report date and following day: refresh actuals every 30 minutes until the item is complete, then return to normal cadence.

Expose the chosen next refresh time through the existing cache metadata/diagnostic path; do not add a new UI badge.

- [ ] **Step 5: Run cache and worker tests**

Run:

```powershell
node src/lib/stocks-prewarm.test.mjs
node src/lib/alpha-summary-prewarm.test.mjs
```

Expected: both PASS.

- [ ] **Step 6: Commit cache behavior**

```powershell
git add src/lib/stocks-prewarm.ts src/lib/stocks-prewarm.test.mjs
git commit -m "fix: preserve complete earnings across refreshes"
```

---

### Task 5: Four-Quarter Earnings UI on Desktop and Mobile

**Files:**
- Modify: `src/components/stocks-earnings-brief.tsx`
- Modify: `src/components/stocks-earnings-brief.test.mjs`
- Modify: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/alpha-stock-detail.test.mjs`

**Interfaces:**
- Consumes:

```ts
type StocksEarningsBriefProps = {
  items: StocksCalendarEarningsItem[];
  insight: StocksEarningsInsight | null;
  updatedAt?: string;
  source?: "live" | "mock";
  calendarYear?: number;
};
```

- Produces: a vertical current-year earnings section with one card per quarter; upcoming item first and expanded; no horizontal scrolling.

- [ ] **Step 1: Write failing component tests**

Render four items and assert:

- Header is `2026 财报`.
- FY2027 Q2 appears before FY2027 Q1.
- Upcoming Q2 shows both estimates and two `等待公布` actual cells.
- Reported Q1 shows four numeric values and both surprise values.
- Derived net income visibly includes `推导`.
- Company guidance is shown in a separate row/card and is not labeled `预计值`.
- A reported incomplete item shows a clear diagnostic with missing field names and attempted sources; it never displays an empty cell or invented number.
- Output has no `overflow-x-auto`, table min-width, or horizontal-scroll container.

- [ ] **Step 2: Run component tests and verify failure**

Run:

```powershell
node src/components/stocks-earnings-brief.test.mjs
node src/components/alpha-stock-detail.test.mjs
```

Expected: FAIL because the component accepts one `comparison` instead of `items`.

- [ ] **Step 3: Refactor the brief into quarter cards**

Retain the existing metric formatting helpers. Render cards with:

- Fiscal label, report date, before/after-market timing, and status.
- Two metric rows: revenue and net income.
- Three value columns: estimate, actual, surprise.
- Source name and direct/derived method under each value.
- Upcoming actuals as `等待公布`.
- Reported incomplete diagnostics as `缺少：营收预期、净利润预期；已尝试：FMP、Finnhub、EarningsLabs`.
- Separate company-guidance block.

Use a compact CSS grid that collapses labels cleanly on mobile. Keep font sizes appropriate for a detail panel and use existing theme tokens.

- [ ] **Step 4: Wire the list from stock detail**

Replace:

```tsx
<StocksEarningsBrief comparison={stock.financialSnapshot.latestEarnings ?? null} />
```

with:

```tsx
<StocksEarningsBrief
  items={stock.financialSnapshot.calendarYearEarnings ?? []}
  insight={stock.financialSnapshot.earningsInsight ?? null}
  updatedAt={stock.financialSnapshot.updatedAt}
  source={stock.financialSnapshot.source}
/>
```

Keep AI insight attached to the latest reported complete quarter; do not generate insight for an upcoming item with no actuals.

- [ ] **Step 5: Run component tests**

Run:

```powershell
node src/components/stocks-earnings-brief.test.mjs
node src/components/alpha-stock-detail.test.mjs
node src/components/stocks-research-layout.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit the UI**

```powershell
git add src/components/stocks-earnings-brief.tsx src/components/stocks-earnings-brief.test.mjs src/components/alpha-stock-detail.tsx src/components/alpha-stock-detail.test.mjs
git commit -m "feat: show current-year earnings cards"
```

---

### Task 6: End-to-End Verification, Live NVDA Check, GitHub, and VPS

**Files:**
- Modify only if verification reveals a defect in files from Tasks 1-5.

**Interfaces:**
- Consumes: completed implementation and current VPS deployment workflow.
- Produces: verified local build, live NVDA cache evidence, GitHub commit, and matching VPS revision.

- [ ] **Step 1: Run the full local verification suite**

Run:

```powershell
npm test
npm run build
```

Expected: all test files pass and the Next.js production build succeeds.

- [ ] **Step 2: Run one financial prewarm locally with network access**

Run: `npm run stocks:prewarm:once`

Inspect the generated financial snapshot and verify for NVDA on 2026-08-15:

- FY2027 Q2 report date is `2026-08-26` and appears first.
- Q2 has revenue and net-income estimates; actuals are null with upcoming status.
- FY2027 Q1 appears below Q2 and has all four required values.
- Every displayed value has provenance and the official/public URLs are retained in source refs.

If live public pages changed schema, update only the affected adapter and its fixture test; do not weaken completeness checks.

- [ ] **Step 3: Verify the UI in desktop and mobile browsers**

Start the local server, then inspect `/stocks` at 1440×900 and 390×844. Verify four-quarter cards fit without horizontal scrolling or clipped text, and the upcoming item is top/expanded.

- [ ] **Step 4: Commit verification fixes, if any**

```powershell
git add src package.json package-lock.json pnpm-lock.yaml
git commit -m "fix: harden earnings source verification"
```

Skip this commit when the working tree is clean. Only add the lockfile that exists.

- [ ] **Step 5: Push GitHub and deploy the same commit to VPS**

Push `main`, deploy that exact revision, rebuild, restart the web and stocks worker services, and run one forced financial prewarm. Do not copy local `.env.local` or cache files to GitHub.

- [ ] **Step 6: Verify production**

Confirm:

- GitHub `main`, local `HEAD`, and VPS `HEAD` are identical.
- `https://holdrich.online/stocks` loads after authentication.
- NVDA shows the expected current-year list and no empty expected/actual cells.
- System services are active and logs show no crash loop.
- Signal Flow, Holding, Douyin, and the Signal-home Hynix premium module remain unchanged.

---

## Acceptance Gate

Implementation is not complete until all of the following are true:

1. NVDA on 2026-08-15 shows FY2027 Q2 at the top because it is 11 days before release.
2. The upcoming Q2 card contains analyst revenue and net-income estimates and shows `等待公布` for actuals.
3. Every displayed reported quarter contains revenue estimate/actual and net-income estimate/actual.
4. A missing required reported value keeps the record `incomplete`, continues the provider waterfall, and produces an explicit diagnostic rather than a blank/zero/fabricated number.
5. The default list contains only report dates from the current natural year and never fills from the prior year.
6. The UI displays at most four items, works on mobile without horizontal scroll, and keeps source/method visible.
7. Company guidance remains separate from analyst consensus.
8. Full tests, production build, GitHub push, and same-revision VPS deployment all succeed.
