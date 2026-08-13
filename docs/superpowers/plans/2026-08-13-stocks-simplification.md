# Stocks Page Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简 Stocks 页面，移除订阅研报、今日催化、风险标签、研究状态和重复研究模块，并保证这些板块的历史数据不再被前端请求、统计或展示。

**Architecture:** 保留现有行情、财务、相对走势和 AI 总结的数据链路，删除 Stocks 客户端对催化与研究状态 API 的依赖。页面仍使用现有桌面双栏和手机三面板布局，但个股详情压缩为核心抬头、研究结论、结构与财报、跟踪要点四部分；后端历史文件和 API 暂时保留以支持回滚。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Tailwind CSS、Node.js `.mjs` 测试、ESLint。

## Global Constraints

- 只修改 Stocks，不修改 Signal Flow、Holding 或抖音。
- 不删除 VPS 上的研报、催化或研究状态历史文件，不修改对应 worker。
- Stocks 不再请求 `/api/stocks-catalysts` 和 `/api/stocks-research-state`。
- Stocks 继续请求 `/api/stocks-market-data`、`/api/stocks-performance` 和 `/api/stocks-financial-data`。
- Stocks 只保留“美股投研池”和“STOCKS 投研总结”两个 Tab。
- 保留现有 AI 投研总结接口、生成能力和展示内容。
- 删除模块不允许留下历史条目、数量、占位符、空白面板或查看入口。
- 缺失财务字段继续显示 `n/a`，不能生成无依据结论。
- 不新增依赖，不修改 AI 模型、数据供应商或权限模型。

---

### Task 1: Remove research-state controls from the stock pool and layout

**Files:**
- Modify: `src/components/alpha-sector-list.tsx`
- Modify: `src/components/stocks-research-layout.tsx`
- Modify: `src/components/alpha-sector-list.test.mjs`
- Modify: `src/components/alpha-sector-list.behavior.test.mjs`
- Modify: `src/components/stocks-research-layout.test.mjs`

**Interfaces:**
- Consumes: `AlphaResearchStock[]`, `selectedTicker`, `onSelectTicker`, market-loading state, chart data and sector selection callbacks.
- Produces: `AlphaSectorListProps` and `StocksResearchLayoutProps` with no `researchStates`, `researchStatusFilter`, `onResearchStatusFilterChange`, `researchStatesLoading`, `researchStatesError`, or `onSaveResearchState` fields.

- [ ] **Step 1: Change source tests to require an unfiltered pool**

Update the source assertions so the pool must retain its sticky layout but must not contain research-state UI or types:

```js
assert.match(source, /data-stocks-pool/);
assert.match(source, /行情加载中/);
assert.doesNotMatch(source, /研究状态筛选/);
assert.doesNotMatch(source, /RESEARCH_STATUS_FILTERS/);
assert.doesNotMatch(source, /StocksResearchState/);

assert.match(layout, /type StocksMobilePanel = "pool" \| "chart" \| "detail"/);
assert.match(layout, /<AlphaSectorList/);
assert.match(layout, /<AlphaStockDetail/);
assert.doesNotMatch(layout, /researchStates/);
assert.doesNotMatch(layout, /researchStatusFilter/);
assert.doesNotMatch(layout, /onSaveResearchState/);
```

In `alpha-sector-list.behavior.test.mjs`, replace status-filter cases with one behavior case that confirms every stock remains grouped in the fixed sector/ticker order.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node src/components/alpha-sector-list.test.mjs
node src/components/alpha-sector-list.behavior.test.mjs
node src/components/stocks-research-layout.test.mjs
```

Expected: FAIL because research-state filters and props still exist.

- [ ] **Step 3: Simplify `AlphaSectorList`**

Remove the research-state import, status filter constants, filter buttons and state-dependent filtering. Keep sector order and fixed ticker order with a helper shaped as follows:

```ts
export function groupResearchPoolSectors({
  sectors,
  stocks,
}: {
  sectors: AlphaResearchSector[];
  stocks: AlphaResearchStock[];
}) {
  return sectors.flatMap((sector) => {
    const rank = new Map(sector.tickers.map((ticker, index) => [ticker, index]));
    const sectorStocks = stocks
      .filter((stock) => stock.sectorId === sector.id)
      .sort(
        (left, right) =>
          (rank.get(left.ticker) ?? 0) - (rank.get(right.ticker) ?? 0),
      );
    return sectorStocks.length > 0 ? [{ ...sector, stocks: sectorStocks }] : [];
  });
}
```

`AlphaSectorListProps` must only expose:

```ts
type AlphaSectorListProps = {
  stocks: AlphaResearchStock[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  marketDataLoading: boolean;
};
```

- [ ] **Step 4: Remove research-state plumbing from `StocksResearchLayout`**

Delete all research-state props from the layout type and from the calls to `AlphaSectorList` and `AlphaStockDetail`. Preserve desktop split, mobile pager, chart labels, sector switching and selected ticker behavior.

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```powershell
node src/components/alpha-sector-list.test.mjs
node src/components/alpha-sector-list.behavior.test.mjs
node src/components/stocks-research-layout.test.mjs
```

Expected: all three commands print their `ok - ...` line and exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/alpha-sector-list.tsx src/components/stocks-research-layout.tsx src/components/alpha-sector-list.test.mjs src/components/alpha-sector-list.behavior.test.mjs src/components/stocks-research-layout.test.mjs
git commit -m "refactor: remove stocks research state controls"
```

---

### Task 2: Stop loading removed historical data and reduce Stocks to two tabs

**Files:**
- Modify: `src/components/alpha-research-page.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`
- Modify: `src/components/alpha-research-page.behavior.test.mjs`

**Interfaces:**
- Consumes: static research pool plus market, performance and financial snapshots.
- Produces: `AlphaResearchPage` with `AlphaTab = "research" | "messages"`; it never fetches catalyst/research-state history and only passes retained props to `StocksResearchLayout`.

- [ ] **Step 1: Rewrite page tests around the retained data contract**

Keep assertions for the Hynix curve, today changes, research layout, AI summary, browser cache and deferred financial loading. Add explicit negative assertions:

```js
assert.match(source, /type AlphaTab = "research" \| "messages"/);
assert.match(source, /美股投研池/);
assert.match(source, /STOCKS 投研总结/);
assert.doesNotMatch(source, /订阅研报/);
assert.doesNotMatch(source, /StocksSubscriptionReports/);
assert.doesNotMatch(source, /buildStocksSubscriptionReports/);
assert.doesNotMatch(source, /\/api\/stocks-catalysts/);
assert.doesNotMatch(source, /\/api\/stocks-research-state/);
assert.doesNotMatch(source, /mergeStocksCatalystSnapshot/);
assert.doesNotMatch(source, /STOCKS_CATALYST_SNAPSHOT_CACHE_KEY/);
assert.doesNotMatch(source, /数据健康中心/);
assert.doesNotMatch(source, /researchStates/);
```

Update the behavior harness so `globalThis.fetch` records requests and verifies the URL set is exactly the retained endpoints used by the current sector:

```js
assert.ok(requests.some(({ url }) => url === "/api/stocks-market-data"));
assert.ok(requests.some(({ url }) => url === "/api/stocks-financial-data"));
assert.ok(requests.some(({ url }) => url.startsWith("/api/stocks-performance?")));
assert.ok(requests.every(({ url }) => !url.includes("stocks-catalysts")));
assert.ok(requests.every(({ url }) => !url.includes("stocks-research-state")));
```

- [ ] **Step 2: Run page tests and verify they fail**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-research-page.behavior.test.mjs
```

Expected: FAIL on the old third tab, catalyst request and research-state request.

- [ ] **Step 3: Remove catalyst, report and research-state orchestration**

In `alpha-research-page.tsx`:

- remove report, catalyst and research-state imports;
- change `AlphaTab` and `tabs` to two entries;
- remove catalyst live/cache/error state and `mergeStocksCatalystSnapshot`;
- calculate `stocks` with market then financial merge only;
- remove subscription report memo;
- remove research-state load/save callbacks and status filter state;
- remove the catalyst polling effect;
- remove the report render branch;
- stop passing research-state props to `StocksResearchLayout`.

The retained stock merge must be:

```ts
const stocks = useMemo(() => {
  const withMarket = mergeStocksMarketSnapshot(
    ALPHA_RESEARCH_STOCKS,
    marketSnapshot,
  );
  return mergeStocksFinancialSnapshot(withMarket, financialSnapshot);
}, [financialSnapshot, marketSnapshot]);
```

- [ ] **Step 4: Replace the persistent health center with one conditional alert**

Build one compact list only from real retained errors:

```ts
const activeErrors = [
  marketError ?? marketIssue,
  financialError ?? financialIssue,
  performanceError && !isPerformanceCacheNotice(performanceError)
    ? performanceError
    : null,
].filter((message): message is string => Boolean(message));
```

Render `data-stocks-error-alert` only when `activeErrors.length > 0`, using one warning row with de-duplicated messages. Do not render provider success chips, timestamps or a `数据健康中心` heading during normal operation.

- [ ] **Step 5: Preserve mobile navigation after deleting the report tab**

Keep the existing behavior that returns to `research` when a sector is selected. Ensure the tab grid uses two columns:

```tsx
<div className="grid min-w-0 grid-cols-2 gap-1 ...">
```

The content branches must be limited to:

```tsx
{activeTab === "research" ? <StocksResearchLayout ... /> : null}
{activeTab === "messages" ? <AlphaSummaryCard scope="stocks" /> : null}
```

- [ ] **Step 6: Run page tests and verify they pass**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-research-page.behavior.test.mjs
```

Expected: PASS; behavior requests contain no catalyst or research-state URL.

- [ ] **Step 7: Commit**

```powershell
git add -- src/components/alpha-research-page.tsx src/components/alpha-research-page.test.mjs src/components/alpha-research-page.behavior.test.mjs
git commit -m "refactor: trim stocks data loading and tabs"
```

---

### Task 3: Collapse individual stock detail into four useful sections

**Files:**
- Modify: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/alpha-stock-detail.test.mjs`
- Modify: `src/lib/stocks-intelligence.ts`
- Modify: `src/lib/stocks-intelligence.test.mjs`

**Interfaces:**
- Consumes: `AlphaResearchStock | null`, `marketDataLabel`, and `marketDataLoading`.
- Produces: `AlphaStockDetailProps` without research-state callbacks; detail sections are primary context, research conclusion, combined structure/earnings/financial block and tracking points.
- Produces: `buildStocksIntelligence(stock)` whose earnings brief is based only on market and financial fields, never `stock.catalysts`.

- [ ] **Step 1: Change detail tests to express the compact structure**

Replace old positive assertions with the new four-section contract:

```js
assert.match(source, /data-stock-primary-context/);
assert.match(source, /研究结论/);
assert.match(source, /结构与财报/);
assert.match(source, /跟踪要点/);
assert.match(source, /Structure Snapshot/);
assert.match(source, /Earnings Brief/);
assert.doesNotMatch(source, /Ticker Intelligence/);
assert.doesNotMatch(source, /Impact & Risk Tags/);
assert.doesNotMatch(source, /StocksResearchStatePanel/);
assert.doesNotMatch(source, /订阅研报/);
assert.doesNotMatch(source, /今日催化/);
assert.doesNotMatch(source, /财报复盘/);
assert.doesNotMatch(source, /主线验证/);
assert.doesNotMatch(source, /splitStocksCatalystsForDisplay/);
assert.doesNotMatch(source, /buildSubscriptionReportInsight/);
assert.doesNotMatch(source, /stock\.catalysts/);
```

In the intelligence test, add a catalyst sentinel and assert it never leaks into the earnings brief:

```js
const noHistoricalCatalystLeak = buildStocksIntelligence({
  ...upcomingHighMomentum,
  catalysts: [{
    title: "HISTORICAL_CATALYST_MUST_NOT_RENDER",
    type: "earnings",
    date: "2026-05-01",
    impact: "positive",
    summary: "old item",
  }],
});
assert.ok(
  noHistoricalCatalystLeak.earningsBrief.points.every(
    (point) => !point.includes("HISTORICAL_CATALYST_MUST_NOT_RENDER"),
  ),
);
```

- [ ] **Step 2: Run focused detail/intelligence tests and verify they fail**

Run:

```powershell
node src/components/alpha-stock-detail.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-intelligence.test.mjs
```

Expected: FAIL because removed sections and catalyst-derived earnings text still exist.

- [ ] **Step 3: Remove catalyst and research-state dependencies from the detail component**

Delete imports and code for:

- `splitStocksCatalystsForDisplay`;
- `buildSubscriptionReportInsight`;
- research-state types, form and panel;
- catalyst labels/impact helpers;
- risk-tag UI and `riskTags` destructuring;
- subscription report, catalyst, standalone intelligence, duplicate recap and mainline sections.

Reduce the props to:

```ts
type AlphaStockDetailProps = {
  stock: AlphaResearchStock | null;
  marketDataLabel: string;
  marketDataLoading: boolean;
};
```

- [ ] **Step 4: Build the compact four-section layout**

1. Keep the current identity, sector, price/day, 7-day strength and earnings tiles in `data-stock-primary-context`.
2. Render `stock.summary` plus `stock.thesis.slice(0, 2)` under `研究结论`.
3. Render one `结构与财报` section containing the structure badge/score/points, earnings brief points and six `financialRows`; display empty strings as `n/a`.
4. Render `跟踪要点` from a de-duplicated list of `stock.watchPoints` followed by `stock.risks`, limited to the most useful six entries.

Use a deterministic helper inside the component file:

```ts
function compactTrackingPoints(stock: AlphaResearchStock) {
  return [...new Set([...stock.watchPoints, ...stock.risks])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}
```

The financial display fallback must be:

```tsx
<dd className="text-sm font-semibold text-foreground">
  {value?.trim() || "n/a"}
</dd>
```

- [ ] **Step 5: Stop `buildEarningsBrief` from reading catalyst history**

Remove `latestCatalystByType` and this behavior from `buildEarningsBrief`:

```ts
const earningsCatalyst = latestCatalystByType(stock.catalysts, "earnings");
if (earningsCatalyst) points.push(`相关催化：${earningsCatalyst.title}`);
```

Keep window, guidance and price-reaction points. The risk-tag and subscription-insight helper exports may remain for dormant components and rollback, but the active detail must neither import nor render them.

- [ ] **Step 6: Run focused tests and verify they pass**

Run:

```powershell
node src/components/alpha-stock-detail.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-intelligence.test.mjs
```

Expected: PASS and the catalyst sentinel is absent from earnings brief points.

- [ ] **Step 7: Commit**

```powershell
git add -- src/components/alpha-stock-detail.tsx src/components/alpha-stock-detail.test.mjs src/lib/stocks-intelligence.ts src/lib/stocks-intelligence.test.mjs
git commit -m "refactor: simplify stocks detail research view"
```

---

### Task 4: Remove top status pills and verify the complete Stocks experience

**Files:**
- Modify: `src/app/stocks/page.tsx`
- Modify: `src/components/alpha-research-page.test.mjs`

**Interfaces:**
- Consumes: `AppShell` and `AlphaResearchPage`.
- Produces: Stocks route without `Pool / Strong / Earnings` header pills.

- [ ] **Step 1: Add route-shell negative assertions**

Read `src/app/stocks/page.tsx` from `alpha-research-page.test.mjs` or add a local source test block:

```js
const pageSource = readFileSync(
  new URL("../app/stocks/page.tsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(pageSource, /statusPills=/);
assert.doesNotMatch(pageSource, /strongCount/);
assert.doesNotMatch(pageSource, /upcomingEarnings/);
assert.doesNotMatch(pageSource, /ALPHA_RESEARCH_STOCKS/);
```

- [ ] **Step 2: Run the page test and verify it fails**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
```

Expected: FAIL because the route still constructs status pills.

- [ ] **Step 3: Simplify the Stocks route shell**

Remove `ALPHA_RESEARCH_STOCKS`, `strongCount`, `upcomingEarnings` and the `statusPills` prop. Keep navigation, subtitle, maximum width and `AlphaResearchPage`:

```tsx
export default function StocksPage() {
  return (
    <AppShell
      activeNav="stocks"
      subtitle="AI / 算力链美股投研池 · 消息汇总辅助视图"
      mainClassName="mx-auto min-h-0 w-full max-w-[1780px] overflow-x-clip px-3 py-4 sm:px-5"
    >
      <AlphaResearchPage />
    </AppShell>
  );
}
```

- [ ] **Step 4: Run all focused Stocks tests**

Run:

```powershell
node src/components/alpha-research-page.test.mjs
node src/components/alpha-research-page.behavior.test.mjs
node src/components/alpha-sector-list.test.mjs
node src/components/alpha-sector-list.behavior.test.mjs
node src/components/stocks-research-layout.test.mjs
node src/components/alpha-stock-detail.test.mjs
node --experimental-strip-types --experimental-transform-types src/lib/stocks-intelligence.test.mjs
node src/components/stocks-hynix-premium-curve.test.mjs
node src/components/stocks-performance-chart.test.mjs
node src/components/stocks-today-changes.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 5: Run repository verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all tests pass, ESLint reports no errors, and Next production build completes.

- [ ] **Step 6: Verify the rendered page on desktop and mobile**

Start the local server and inspect `/stocks` at desktop and mobile widths. Confirm:

- two tabs only;
- no Pool/Strong/Earnings pills;
- no subscription report, catalyst, risk tag or research-state history;
- no request to `/api/stocks-catalysts` or `/api/stocks-research-state` in the browser network log;
- retained pool, Hynix curve, relative chart, detail and AI summary render;
- mobile pool/chart/detail pager has no blank panel or horizontal overflow.

- [ ] **Step 7: Commit**

```powershell
git add -- src/app/stocks/page.tsx src/components/alpha-research-page.test.mjs
git commit -m "refactor: finish stocks page simplification"
```

- [ ] **Step 8: Push and deploy after final verification**

```powershell
git push origin main
```

On the VPS, pull the exact pushed commit, run the production build, restart the web service, and verify `/stocks` plus the three retained Stocks APIs. Do not delete catalyst/report/research-state history files during deployment.
