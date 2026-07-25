# Stocks History Backfill and Research State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill every Stocks research-pool ticker from `2026-05-06`, keep the history repaired in the background, and add cross-device stock research-state management.

**Architecture:** Historical prices extend the existing `stocks-data.sqlite` store through an idempotent daily-close write path plus a provider/fallback service that runs independently of page requests. Research states live in a separate `stocks-research.sqlite` database exposed through one authenticated Next.js API and consumed by focused client components.

**Tech Stack:** Next.js App Router, React, TypeScript, Node `node:sqlite`, existing Yahoo/EODHD providers, Tailwind CSS, Node `.mjs` tests.

## Global Constraints

- Do not change Signal Flow behavior or UI.
- Use `2026-05-06` as the history start for current and future research-pool tickers.
- Use Yahoo first and configured EODHD as fallback; add no paid provider.
- Keep existing `/api/stocks-performance` response fields compatible.
- Store runtime databases under `.signal-hub` and never commit them.
- Research states must survive deployment and be shared across phones, laptops, and desktop browsers.
- A history or research-state failure must not make other Stocks features unavailable.

---

### Task 1: Add Idempotent Daily History Storage

**Files:**
- Modify: `src/lib/stocks-performance-data.ts`
- Modify: `src/lib/stocks-performance-data.test.mjs`

**Interfaces:**
- Produces: `StocksHistoricalDailyPoint`
- Produces: `recordStocksHistoricalDailyPoints({ points, dbPath?, env? }): { recorded: number }`
- Produces: `getStocksHistoryCoverage({ tickers, dbPath?, env? }): Record<string, StocksHistoryCoverage>`
- Produces: `updateStocksHistoryBackfillStatus({ ticker, ...status, dbPath?, env? }): void`
- Consumes: existing `stocksPerformanceDbPath()` and `stock_quote_snapshots`

- [ ] **Step 1: Write failing daily-history storage tests**

Add test cases to `src/lib/stocks-performance-data.test.mjs` that import the new functions and verify:

```js
recordStocksHistoricalDailyPoints({
  dbPath,
  points: [
    {
      ticker: "NVDA",
      marketDate: "2026-05-06",
      capturedAt: "2026-05-06T20:00:00.000Z",
      price: 91.2,
      provider: "yahoo",
    },
    {
      ticker: "NVDA",
      marketDate: "2026-05-07",
      capturedAt: "2026-05-07T20:00:00.000Z",
      price: 93.4,
      provider: "yahoo",
    },
  ],
});

recordStocksHistoricalDailyPoints({
  dbPath,
  points: [
    {
      ticker: "nvda",
      marketDate: "2026-05-06",
      capturedAt: "2026-05-06T20:00:00.000Z",
      price: 92,
      provider: "eodhd",
    },
  ],
});

const coverage = getStocksHistoryCoverage({
  dbPath,
  tickers: ["NVDA", "AMD"],
});
assert.deepEqual(coverage.NVDA, {
  ticker: "NVDA",
  earliestMarketDate: "2026-05-06",
  latestMarketDate: "2026-05-07",
  pointCount: 2,
});
assert.equal(coverage.AMD.pointCount, 0);
```

Also assert that the repeated `2026-05-06` write replaces the deterministic daily point rather than producing a third row and that invalid dates/prices are skipped.

- [ ] **Step 2: Run the storage test and confirm failure**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-performance-data.test.mjs
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Extend the SQLite schema**

Update `openStocksPerformanceDb()` to add:

```sql
CREATE TABLE IF NOT EXISTS stock_history_backfill_status (
  ticker TEXT PRIMARY KEY,
  requested_start_date TEXT NOT NULL,
  covered_through_date TEXT,
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  provider TEXT,
  status TEXT NOT NULL,
  error TEXT
);
```

Do not remove or rewrite existing `stock_quote_snapshots`.

- [ ] **Step 4: Implement daily-point upsert and coverage**

Add:

```ts
export type StocksHistoricalDailyPoint = {
  ticker: string;
  marketDate: string;
  capturedAt: string;
  price: number;
  provider: "yahoo" | "eodhd";
};

export type StocksHistoryCoverage = {
  ticker: string;
  earliestMarketDate: string | null;
  latestMarketDate: string | null;
  pointCount: number;
};
```

Normalize ticker casing, validate ISO dates and positive finite prices, and use `INSERT OR REPLACE` with:

```ts
freshness: "delayed"
confidence: provider === "yahoo" ? "medium" : "medium"
```

Daily provider timestamps must be deterministic per market date so reruns update the same `(ticker, captured_at)` row.

- [ ] **Step 5: Implement backfill status persistence**

Add typed read/write helpers for `stock_history_backfill_status`. A failed attempt updates `last_attempt_at`, `status`, and `error` without clearing `last_success_at` or existing points. A successful attempt updates `covered_through_date`, `last_success_at`, provider, and clears the error.

- [ ] **Step 6: Run the storage test**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-performance-data.test.mjs
```

Expected: PASS and the temporary SQLite file is removed by the test.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/lib/stocks-performance-data.ts src/lib/stocks-performance-data.test.mjs
git commit -m "feat: support stocks daily history storage"
```

---

### Task 2: Build Yahoo/EODHD History Backfill

**Files:**
- Create: `src/lib/stocks-history-backfill.ts`
- Create: `src/lib/stocks-history-backfill.test.mjs`
- Create: `scripts/stocks-history-backfill.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recordStocksHistoricalDailyPoints()`, `getStocksHistoryCoverage()`, and backfill status helpers from Task 1
- Produces: `parseYahooHistoricalDailyPoints(ticker, payload)`
- Produces: `parseEodhdHistoricalDailyPoints(ticker, payload)`
- Produces: `backfillStocksHistory(options): Promise<StocksHistoryBackfillResult[]>`
- Produces: package script `stocks:history:backfill`

- [ ] **Step 1: Write failing provider parser tests**

Create `src/lib/stocks-history-backfill.test.mjs` with fixtures for Yahoo:

```js
const yahooPoints = parseYahooHistoricalDailyPoints("nvda", {
  chart: {
    result: [{
      timestamp: [1778068800, 1778155200],
      indicators: {
        quote: [{ close: [91, 93] }],
        adjclose: [{ adjclose: [90.5, 92.5] }],
      },
    }],
  },
});
assert.deepEqual(
  yahooPoints.map(({ ticker, marketDate, price, provider }) => ({
    ticker,
    marketDate,
    price,
    provider,
  })),
  [
    { ticker: "NVDA", marketDate: "2026-05-06", price: 90.5, provider: "yahoo" },
    { ticker: "NVDA", marketDate: "2026-05-07", price: 92.5, provider: "yahoo" },
  ],
);
```

Add an EODHD fixture using `adjusted_close`, malformed rows, and ascending date sorting.

- [ ] **Step 2: Write failing fallback and idempotency tests**

Inject a `fetchImpl` that:

1. Returns HTTP 429 for Yahoo NVDA.
2. Returns valid EODHD NVDA history.
3. Returns valid Yahoo AMD history.

Assert:

```js
assert.deepEqual(
  results.map(({ ticker, status, provider }) => ({ ticker, status, provider })),
  [
    { ticker: "NVDA", status: "success", provider: "eodhd" },
    { ticker: "AMD", status: "success", provider: "yahoo" },
  ],
);
```

Run the backfill twice against the same temporary database and assert the point counts do not grow on the second run.

- [ ] **Step 3: Run the backfill test and confirm failure**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-history-backfill.test.mjs
```

Expected: FAIL because `stocks-history-backfill.ts` does not exist.

- [ ] **Step 4: Implement parsing and provider URLs**

Implement Yahoo daily history with:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{ticker}
  ?period1={unix-start}
  &period2={unix-end-exclusive}
  &interval=1d
  &events=history
  &includeAdjustedClose=true
```

Use adjusted close when present, otherwise close. Convert timestamps using `America/New_York`.

Implement EODHD fallback with:

```text
https://eodhd.com/api/eod/{symbol}
  ?api_token={key}
  &fmt=json
  &period=d
  &from={startDate}
  &to={endDate}
```

Reuse the existing EODHD environment variable names:

```ts
STOCKS_EODHD_API_KEYS
STOCKS_EODHD_API_KEY
EODHD_API_KEYS
EODHD_API_KEY
```

- [ ] **Step 5: Implement coverage-aware backfill**

`backfillStocksHistory()` must:

- Normalize and deduplicate tickers.
- Use `ALPHA_RESEARCH_POOL_TRACKING_START_DATE` by default.
- Request the full range when no successful full coverage exists.
- After initial coverage, request an overlapping 14-calendar-day tail to repair recent gaps.
- Process tickers sequentially with configurable delay `STOCKS_HISTORY_REQUEST_DELAY_MS`, default `150`.
- Fall back to EODHD only when Yahoo fails or returns no usable points.
- Upsert every successful provider response.
- Return one result per ticker with `ticker`, `status`, `provider`, `requestedFrom`, `requestedTo`, `recorded`, and `error`.
- Never throw away other ticker results because one ticker failed.

- [ ] **Step 6: Add the one-shot script**

Create `scripts/stocks-history-backfill.mjs` using the same `.env.local`/`.env` loader pattern as `scripts/stocks-cache-worker.mjs`. It must call:

```ts
backfillStocksHistory({
  tickers: ALPHA_RESEARCH_STOCK_UNIVERSE,
  startDate: ALPHA_RESEARCH_POOL_TRACKING_START_DATE,
  env: process.env,
});
```

Log JSON start/result/summary records and exit nonzero only when every ticker fails.

Add:

```json
"stocks:history:backfill": "node --experimental-strip-types --experimental-transform-types scripts/stocks-history-backfill.mjs"
```

- [ ] **Step 7: Run the backfill tests**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-history-backfill.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-performance-data.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add src/lib/stocks-history-backfill.ts src/lib/stocks-history-backfill.test.mjs scripts/stocks-history-backfill.mjs package.json
git commit -m "feat: backfill stocks history from providers"
```

---

### Task 3: Schedule Daily History Repair

**Files:**
- Modify: `scripts/stocks-cache-worker.mjs`
- Modify: `src/lib/stocks-prewarm.test.mjs`

**Interfaces:**
- Consumes: `backfillStocksHistory()` from Task 2
- Produces: worker events `stocks_history.backfill.start`, `.done`, `.error`, and `.skip`
- Uses: `STOCKS_HISTORY_BACKFILL_ENABLED`, `STOCKS_HISTORY_BACKFILL_INTERVAL_MS`

- [ ] **Step 1: Add failing worker contract tests**

Extend `src/lib/stocks-prewarm.test.mjs` to assert the worker source includes:

```js
assert.match(worker, /backfillStocksHistory/);
assert.match(worker, /STOCKS_HISTORY_BACKFILL_ENABLED/);
assert.match(worker, /STOCKS_HISTORY_BACKFILL_INTERVAL_MS/);
assert.match(worker, /stocks_history\.backfill\.done/);
```

- [ ] **Step 2: Run the worker contract test and confirm failure**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-prewarm.test.mjs
```

Expected: FAIL on the missing history-worker integration.

- [ ] **Step 3: Add the independent history timer**

Modify `scripts/stocks-cache-worker.mjs` without adding history to the existing `market | financial | catalysts` snapshot kinds.

Use:

```ts
const historyEnabled =
  process.env.STOCKS_HISTORY_BACKFILL_ENABLED?.trim().toLowerCase() !== "false";
const historyIntervalMs = Math.max(
  60 * 60 * 1000,
  Number(process.env.STOCKS_HISTORY_BACKFILL_INTERVAL_MS) || 24 * 60 * 60 * 1000,
);
```

Run once at startup when enabled, then maintain a separate `nextHistoryDue`. The existing prewarm schedule and shutdown behavior must remain unchanged. Prevent concurrent history runs with a dedicated boolean.

- [ ] **Step 4: Emit compact summary logs**

Log counts for:

```ts
{
  success: results.filter((item) => item.status === "success").length,
  skipped: results.filter((item) => item.status === "skipped").length,
  failed: results.filter((item) => item.status === "error").length,
  recorded: results.reduce((sum, item) => sum + item.recorded, 0),
}
```

Do not print API keys or full provider URLs.

- [ ] **Step 5: Run worker tests**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-prewarm.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-history-backfill.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add scripts/stocks-cache-worker.mjs src/lib/stocks-prewarm.test.mjs
git commit -m "feat: schedule stocks history repair"
```

---

### Task 4: Add Persistent Research State and API

**Files:**
- Create: `src/lib/stocks-research-state.ts`
- Create: `src/lib/stocks-research-state.test.mjs`
- Create: `src/app/api/stocks-research-state/route.ts`
- Create: `src/app/api/stocks-research-state/route.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `StocksResearchStatus = "watch" | "waiting" | "holding" | "avoid"`
- Produces: `StocksResearchState`
- Produces: `StocksResearchStateInput`
- Produces: `getStocksResearchStates()`, `getStocksResearchState(ticker)`, `saveStocksResearchState(input)`
- Produces: `GET` and `PUT` at `/api/stocks-research-state`

- [ ] **Step 1: Write failing persistence tests**

Create `src/lib/stocks-research-state.test.mjs` with a temporary `STOCKS_RESEARCH_DB` and verify:

```js
const defaultState = getStocksResearchState("NVDA", { dbPath });
assert.equal(defaultState.status, "watch");
assert.equal(defaultState.persisted, false);

const saved = saveStocksResearchState({
  dbPath,
  input: {
    ticker: "nvda",
    status: "holding",
    conviction: 4,
    entryZone: "$180-$190",
    invalidation: "跌破 200 日线且基本面转弱",
    nextCatalyst: "下一次财报",
    thesis: "Blackwell 出货和 AI 资本开支继续验证。",
  },
});
assert.equal(saved.ticker, "NVDA");
assert.equal(saved.status, "holding");
assert.equal(saved.persisted, true);
```

Also assert invalid status, conviction `0`/`6`, non-pool ticker, and overlong text throw typed validation errors.

- [ ] **Step 2: Run the persistence test and confirm failure**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-research-state.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement research-state storage**

Use `getRuntimeDataPath(env, "stocks-research.sqlite")` unless `STOCKS_RESEARCH_DB` is set.

Create:

```sql
CREATE TABLE IF NOT EXISTS stocks_research_state (
  ticker TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  conviction INTEGER,
  entry_zone TEXT,
  invalidation TEXT,
  next_catalyst TEXT,
  thesis TEXT,
  updated_at TEXT NOT NULL
);
```

Validation rules:

```ts
status: one of watch, waiting, holding, avoid
conviction: null or integer 1..5
entryZone: max 500 characters
invalidation: max 500 characters
nextCatalyst: max 500 characters
thesis: max 2000 characters
ticker: must exist in ALPHA_RESEARCH_STOCK_UNIVERSE
```

Return an in-memory default for unsaved stocks without inserting rows.

- [ ] **Step 4: Write failing API contract tests**

Create `src/app/api/stocks-research-state/route.test.mjs` to read the route source and assert:

```js
assert.match(source, /export async function GET/);
assert.match(source, /export async function PUT/);
assert.match(source, /getStocksResearchStates/);
assert.match(source, /saveStocksResearchState/);
assert.match(source, /VALIDATION_ERROR/);
assert.match(source, /INTERNAL_ERROR/);
```

- [ ] **Step 5: Implement the API route**

`GET` behavior:

```json
{
  "generatedAt": "ISO timestamp",
  "states": {
    "NVDA": {
      "ticker": "NVDA",
      "status": "watch",
      "conviction": null,
      "entryZone": "",
      "invalidation": "",
      "nextCatalyst": "",
      "thesis": "",
      "updatedAt": null,
      "persisted": false
    }
  }
}
```

When `?ticker=NVDA` is supplied, return `{ "state": ... }`.

`PUT` accepts `{ ticker, status, conviction, entryZone, invalidation, nextCatalyst, thesis }` and returns:

```json
{ "ok": true, "state": { "...": "saved state" } }
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "human-readable message"
  }
}
```

Return `400` for validation and `500` for storage failure. Do not expose database paths or stack traces.

- [ ] **Step 6: Ensure runtime databases remain ignored**

Confirm `.gitignore` already covers `.signal-hub/`. If not, add:

```gitignore
.signal-hub/
```

- [ ] **Step 7: Run state and route tests**

Run:

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-research-state.test.mjs
node src/app/api/stocks-research-state/route.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/lib/stocks-research-state.ts src/lib/stocks-research-state.test.mjs src/app/api/stocks-research-state/route.ts src/app/api/stocks-research-state/route.test.mjs .gitignore
git commit -m "feat: persist stocks research states"
```

---

### Task 5: Add the Research State Editor

**Files:**
- Create: `src/components/stocks-research-state-panel.tsx`
- Create: `src/components/stocks-research-state-panel.test.mjs`
- Modify: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/alpha-stock-detail.test.mjs`

**Interfaces:**
- Consumes: `StocksResearchState` and `StocksResearchStateInput` from Task 4
- Produces: `StocksResearchStatePanel`
- Changes: `AlphaStockDetailProps` gains `researchState`, `researchStateLoading`, and `onSaveResearchState`

- [ ] **Step 1: Write failing component contract tests**

Create `src/components/stocks-research-state-panel.test.mjs` asserting the source contains:

```js
assert.match(source, /观察/);
assert.match(source, /等待/);
assert.match(source, /持有/);
assert.match(source, /回避/);
assert.match(source, /买入区/);
assert.match(source, /失效条件/);
assert.match(source, /下个催化/);
assert.match(source, /研究逻辑/);
assert.match(source, /保存研究状态/);
assert.match(source, /onSave/);
assert.match(source, /保存失败/);
```

Extend `alpha-stock-detail.test.mjs` to require `<StocksResearchStatePanel`.

- [ ] **Step 2: Run component tests and confirm failure**

Run:

```powershell
node src/components/stocks-research-state-panel.test.mjs
node src/components/alpha-stock-detail.test.mjs
```

Expected: FAIL because the panel is absent.

- [ ] **Step 3: Implement the controlled state panel**

The panel must:

- Copy incoming state into local form fields when ticker or `updatedAt` changes.
- Render status as a four-option segmented control.
- Render conviction as a 1–5 selector with a clear option.
- Render compact inputs for entry zone, invalidation, next catalyst, and thesis.
- Disable save while loading or saving.
- Preserve local form values when a request fails.
- Show `已保存` only after the parent promise resolves.
- Display the last update timestamp in the local timezone.

Use existing colors and maximum `8px` card radius. Do not create nested decorative cards.

- [ ] **Step 4: Place it at the top of individual stock research**

Update `AlphaStockDetail` so the panel appears after the ticker header and before `Ticker Intelligence`. When research state is unavailable, render a small nonblocking error/disabled state while the rest of the stock detail remains visible.

- [ ] **Step 5: Run component tests**

Run:

```powershell
node src/components/stocks-research-state-panel.test.mjs
node src/components/alpha-stock-detail.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/components/stocks-research-state-panel.tsx src/components/stocks-research-state-panel.test.mjs src/components/alpha-stock-detail.tsx src/components/alpha-stock-detail.test.mjs
git commit -m "feat: add stocks research state editor"
```

---

### Task 6: Load, Save, and Filter Research States

**Files:**
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/stocks-research-layout.tsx`
- Modify: `src/components/alpha-sector-list.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/alpha-sector-list.test.mjs`
- Modify: `src/components/stocks-research-layout.test.mjs`

**Interfaces:**
- Consumes: `/api/stocks-research-state`
- Passes: state map and save callback from `AlphaResearchPage` through `StocksResearchLayout`
- Adds: `researchStatusFilter` with `"all"` plus the four persisted statuses

- [ ] **Step 1: Write failing page and pool contract tests**

Extend tests to assert:

```js
assert.match(pageSource, /\/api\/stocks-research-state/);
assert.match(pageSource, /method:\s*"PUT"/);
assert.match(pageSource, /researchStates/);
assert.match(layoutSource, /researchStatusFilter/);
assert.match(poolSource, /全部/);
assert.match(poolSource, /观察/);
assert.match(poolSource, /等待/);
assert.match(poolSource, /持有/);
assert.match(poolSource, /回避/);
```

- [ ] **Step 2: Run the page tests and confirm failure**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/stocks-research-layout.test.mjs
```

Expected: FAIL on the new state and filter contracts.

- [ ] **Step 3: Load the shared state map**

In `AlphaResearchPage`, add:

```ts
const [researchStates, setResearchStates] =
  useState<Record<string, StocksResearchState>>({});
const [researchStatesLoading, setResearchStatesLoading] = useState(true);
const [researchStatesError, setResearchStatesError] = useState<string | null>(null);
const [researchStatusFilter, setResearchStatusFilter] =
  useState<StocksResearchStatus | "all">("all");
```

Fetch once when the research page mounts. Do not poll because changes originate from the same page and are returned by PUT.

- [ ] **Step 4: Implement save and local reconciliation**

Create an async save callback that PUTs the complete state, validates `response.ok`, and then updates only:

```ts
setResearchStates((current) => ({
  ...current,
  [saved.ticker]: saved,
}));
```

Throw an `Error` back to `StocksResearchStatePanel` on failure so the panel preserves form data and displays the message.

- [ ] **Step 5: Thread props through the layout**

Pass selected state, loading state, and save callback to `AlphaStockDetail`. Pass the state map and status filter to `AlphaSectorList`.

Filtering rules:

- `all` shows every stock.
- Unsaved stocks count as `watch`.
- Filtering affects only pool cards.
- Sector headings with zero matching stocks are hidden.
- The selected detail and chart do not disappear when the current ticker is outside the filter.
- Changing a stock state while a restrictive filter is active may remove that card, but the detail remains selected.

- [ ] **Step 6: Add the compact filter control**

Place a five-option control under the stock-pool heading. On mobile it may wrap to two rows; labels must remain fully visible.

- [ ] **Step 7: Run component tests**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/stocks-research-layout.test.mjs
node src/components/stocks-research-state-panel.test.mjs
node src/components/alpha-stock-detail.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```powershell
git add src/components/alpha-research-page.tsx src/components/stocks-research-layout.tsx src/components/alpha-sector-list.tsx src/components/alpha-research-page.test.mjs src/components/alpha-sector-list.test.mjs src/components/stocks-research-layout.test.mjs
git commit -m "feat: connect stocks research state workflow"
```

---

### Task 7: Full Verification, Push, and VPS Deployment

**Files:**
- Verify all files changed in Tasks 1–6
- Modify VPS runtime only through existing deployment procedure

**Interfaces:**
- Verifies: API compatibility, background backfill, cross-device persistence
- Produces: GitHub `main` and VPS running the same commit

- [ ] **Step 1: Run focused data tests**

```powershell
node --experimental-strip-types --experimental-transform-types src/lib/stocks-performance-data.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-history-backfill.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-research-state.test.mjs
node src/app/api/stocks-research-state/route.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-prewarm.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run focused component tests**

```powershell
node src/components/stocks-research-state-panel.test.mjs
node src/components/alpha-stock-detail.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/stocks-research-layout.test.mjs
node src/components/alpha-research-page.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run the complete project checks**

```powershell
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: tests, lint, and build pass; only intentional uncommitted changes remain.

- [ ] **Step 4: Run local visual verification**

Start the existing local development server and verify desktop and mobile:

- Stocks loads without touching Signal Flow.
- Research state defaults to 观察.
- Saving 持有 with notes survives page reload.
- Status filters correctly limit only stock-pool cards.
- The detail panel remains readable at mobile width.
- Performance chart still uses `startDate=2026-05-06`.

- [ ] **Step 5: Push GitHub**

```powershell
git push origin main
```

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 6: Deploy the exact commit to VPS**

Use the existing SSH deployment path to:

1. Pull the verified commit.
2. Install only if lockfile changed.
3. Run the production build.
4. Run `npm run stocks:history:backfill`.
5. Restart `signal-hub-web` and `signal-hub-stocks-cache`.

Do not restart unrelated Signal Flow workers.

- [ ] **Step 7: Verify VPS history and persistence**

Confirm:

- The one-shot script reports per-ticker success/fallback/failure without leaking keys.
- `/api/stocks-performance?...&startDate=2026-05-06` returns early history for representative US and Korean tickers.
- Saving a state through the website and reloading returns the same value.
- `stocks-research.sqlite` exists in the configured runtime directory.
- `signal-hub-web` and `signal-hub-stocks-cache` are active.
- VPS Git HEAD equals GitHub `main`.

- [ ] **Step 8: Record final deployment result**

Report:

- final commit hash,
- focused/full verification results,
- history backfill success/failure counts,
- service status,
- any provider-specific tickers that still lack history.
