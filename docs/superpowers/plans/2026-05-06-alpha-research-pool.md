# Alpha Research Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated `/alpha` page for a read-only AI compute-chain US stock research pool, while preserving the existing Telegram/X Alpha summary as a secondary tab.

**Architecture:** A typed local data module provides deterministic mock sector and stock research records. A client-side Alpha page owns tab and selected ticker state, composes a sector/ticker list on the left, a selected-stock detail panel on the right, and reuses `AlphaSummaryCard` for message Alpha. No new API routes, persistence, or external data calls are introduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Node assert-based `.mjs` tests.

---

## Current Context

- The app already uses `AppShell` for sidebar/header navigation.
- The current Alpha summary code lives in `src/components/alpha-summary-card.tsx`, `src/app/api/alpha-summary/route.ts`, and `src/lib/alpha-summary.ts`.
- The current sidebar Alpha item points to `/#alpha`; it should point to `/alpha`.
- The home page can keep its current signal layout. This plan does not remove the existing home-page Alpha summary card.
- The Windows shell in this session cannot resolve `git`, and the default `node.exe` command is denied. Use the bundled Node path from the workspace runtime for verification commands.

## File Structure

- Create `src/lib/alpha-research-pool.ts`
  - Owns Alpha research types, local mock sectors/stocks, default ticker selection, and read helpers.
- Create `src/lib/alpha-research-pool.test.mjs`
  - Tests data integrity and selector behavior with Node assertions.
- Create `src/app/alpha/page.tsx`
  - Server route for `/alpha`, wraps the page in `AppShell`.
- Create `src/components/alpha-research-page.tsx`
  - Client component that owns active tab and selected ticker state.
- Create `src/components/alpha-research-pool.tsx`
  - Two-column research pool layout.
- Create `src/components/alpha-sector-list.tsx`
  - Left sector/ticker list.
- Create `src/components/alpha-stock-detail.tsx`
  - Right detail panel.
- Modify `src/components/app-shell.tsx`
  - Change Alpha navigation href from `/#alpha` to `/alpha`.

## Verification Commands

Use these PowerShell variables during implementation:

```powershell
$NODE = "C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "D:\Vibe coding\signal-hub\.codex-tools\pnpm-package\package\bin\pnpm.cjs"
```

Run the focused data test:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
```

Run project checks:

```powershell
& $NODE $PNPM lint
& $NODE $PNPM build
```

Expected final result:

- Data test prints `ok - alpha research pool data`.
- Lint completes without errors.
- Build completes without errors.

---

### Task 1: Typed Local Research Data

**Files:**
- Create: `src/lib/alpha-research-pool.ts`
- Create: `src/lib/alpha-research-pool.test.mjs`

- [ ] **Step 1: Write the failing data integrity test**

Create `src/lib/alpha-research-pool.test.mjs`:

```js
import assert from "node:assert/strict";
import {
  ALPHA_RESEARCH_DEFAULT_TICKER,
  ALPHA_RESEARCH_SECTORS,
  ALPHA_RESEARCH_STOCKS,
  ALPHA_RESEARCH_STOCK_UNIVERSE,
  getAlphaResearchSectorById,
  getAlphaResearchStocksForSector,
  getAlphaResearchStockByTicker,
  getDefaultAlphaResearchStock,
} from "./alpha-research-pool.ts";

const expectedTickers = [
  "NVDA",
  "TSM",
  "ASML",
  "AMD",
  "AVGO",
  "LRCX",
  "COHR",
  "LITE",
  "IPGP",
  "FN",
  "CIEN",
  "GLW",
  "MSFT",
  "AMZN",
  "GOOG",
  "ORCL",
  "NOW",
  "SNOW",
  "PLTR",
  "DELL",
  "VRT",
  "CLS",
  "CRWV",
  "NBIS",
  "MU",
  "WDC",
  "SNDK",
  "STX",
];

assert.equal(ALPHA_RESEARCH_SECTORS.length, 5);
assert.deepEqual(ALPHA_RESEARCH_STOCK_UNIVERSE, expectedTickers);
assert.equal(ALPHA_RESEARCH_STOCKS.length, expectedTickers.length);
assert.equal(ALPHA_RESEARCH_DEFAULT_TICKER, "NVDA");
assert.equal(getDefaultAlphaResearchStock().ticker, "NVDA");
assert.equal(getAlphaResearchStockByTicker("nvda")?.ticker, "NVDA");
assert.equal(getAlphaResearchStockByTicker("missing"), null);

const sectorIds = new Set(ALPHA_RESEARCH_SECTORS.map((sector) => sector.id));
const tickerSet = new Set();

for (const stock of ALPHA_RESEARCH_STOCKS) {
  assert.equal(tickerSet.has(stock.ticker), false, `${stock.ticker} duplicated`);
  tickerSet.add(stock.ticker);
  assert.equal(sectorIds.has(stock.sectorId), true, `${stock.ticker} sector missing`);
  assert.ok(stock.companyName.length > 0, `${stock.ticker} companyName missing`);
  assert.ok(stock.businessTags.length > 0, `${stock.ticker} tags missing`);
  assert.ok(stock.summary.length > 0, `${stock.ticker} summary missing`);
  assert.ok(stock.catalysts.length > 0, `${stock.ticker} catalysts missing`);
  assert.ok(stock.financialReadthrough.length > 0, `${stock.ticker} readthrough missing`);
  assert.ok(stock.thesis.length > 0, `${stock.ticker} thesis missing`);
  assert.ok(stock.watchPoints.length > 0, `${stock.ticker} watch points missing`);
  assert.ok(stock.risks.length > 0, `${stock.ticker} risks missing`);
  assert.equal(typeof stock.market.dayChangePct, "number");
  assert.equal(typeof stock.market.prePostChangePct, "number");
  assert.equal(typeof stock.market.sevenDayChangePct, "number");
  assert.ok(stock.financialSnapshot.revenue.length > 0);
  assert.ok(stock.financialSnapshot.nextEarningsDate.length > 0);
}

assert.equal(getAlphaResearchSectorById("optical")?.name, "光通信");
assert.equal(getAlphaResearchSectorById("missing"), null);
assert.deepEqual(
  getAlphaResearchStocksForSector("storage").map((stock) => stock.ticker),
  ["MU", "WDC", "SNDK", "STX"],
);

console.log("ok - alpha research pool data");
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
$NODE = "C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
```

Expected: FAIL with a module-not-found error for `./alpha-research-pool.ts`.

- [ ] **Step 3: Add the typed data module**

Create `src/lib/alpha-research-pool.ts`:

```ts
export const ALPHA_RESEARCH_DEFAULT_TICKER = "NVDA";

export type AlphaResearchSectorId =
  | "semiconductors"
  | "optical"
  | "cloud-software"
  | "data-center"
  | "storage";

export type AlphaResearchPriority = "A" | "B" | "C";

export type AlphaResearchSession = "pre-market" | "regular" | "after-hours";

export type AlphaResearchEarningsStatus =
  | "recent"
  | "upcoming"
  | "watch"
  | "quiet";

export type AlphaCatalystType =
  | "earnings"
  | "product"
  | "supply-chain"
  | "analyst"
  | "macro"
  | "regulatory"
  | "industry-event";

export type AlphaResearchSector = {
  id: AlphaResearchSectorId;
  name: string;
  description: string;
  themeScore: number;
  tickers: string[];
};

export type AlphaResearchMarket = {
  lastPrice: number;
  dayChangePct: number;
  prePostChangePct: number;
  sevenDayChangePct: number;
  relativeStrengthLabel: string;
  marketSession: AlphaResearchSession;
  earningsStatus: AlphaResearchEarningsStatus;
};

export type AlphaResearchCatalyst = {
  title: string;
  type: AlphaCatalystType;
  date: string;
  impact: "positive" | "neutral" | "negative";
  summary: string;
};

export type AlphaResearchFinancialSnapshot = {
  revenue: string;
  revenueYoY: string;
  eps: string;
  grossMargin: string;
  freeCashFlow: string;
  nextEarningsDate: string;
  guidance: string;
};

export type AlphaResearchStock = {
  ticker: string;
  companyName: string;
  sectorId: AlphaResearchSectorId;
  businessTags: string[];
  priority: AlphaResearchPriority;
  summary: string;
  market: AlphaResearchMarket;
  catalysts: AlphaResearchCatalyst[];
  financialSnapshot: AlphaResearchFinancialSnapshot;
  financialReadthrough: string[];
  thesis: string[];
  watchPoints: string[];
  risks: string[];
};

export const ALPHA_RESEARCH_SECTORS: AlphaResearchSector[] = [
  {
    id: "semiconductors",
    name: "半导体与设备",
    description: "AI GPU、先进制程、EDA/设备和高端封装链条。",
    themeScore: 94,
    tickers: ["NVDA", "TSM", "ASML", "AMD", "AVGO", "LRCX"],
  },
  {
    id: "optical",
    name: "光通信",
    description: "高速光模块、光器件、网络设备和数据中心互联。",
    themeScore: 88,
    tickers: ["COHR", "LITE", "IPGP", "FN", "CIEN", "GLW"],
  },
  {
    id: "cloud-software",
    name: "云/SaaS/软件",
    description: "云资本开支、AI 平台、数据库、应用软件和数据分析。",
    themeScore: 86,
    tickers: ["MSFT", "AMZN", "GOOG", "ORCL", "NOW", "SNOW", "PLTR"],
  },
  {
    id: "data-center",
    name: "数据中心基础设施",
    description: "AI 服务器、电力、散热、机柜、代工和新型云基础设施。",
    themeScore: 90,
    tickers: ["DELL", "VRT", "CLS", "CRWV", "NBIS"],
  },
  {
    id: "storage",
    name: "数据存储",
    description: "HBM、NAND、HDD 和数据中心存储周期。",
    themeScore: 82,
    tickers: ["MU", "WDC", "SNDK", "STX"],
  },
];

export const ALPHA_RESEARCH_STOCK_UNIVERSE = ALPHA_RESEARCH_SECTORS.flatMap(
  (sector) => sector.tickers,
);

type StockSeed = Omit<
  AlphaResearchStock,
  | "catalysts"
  | "financialSnapshot"
  | "financialReadthrough"
  | "thesis"
  | "watchPoints"
  | "risks"
> & {
  catalystTitle: string;
  catalystType: AlphaCatalystType;
  catalystSummary: string;
  revenue: string;
  revenueYoY: string;
  eps: string;
  grossMargin: string;
  freeCashFlow: string;
  nextEarningsDate: string;
};

function buildStock(seed: StockSeed): AlphaResearchStock {
  return {
    ...seed,
    catalysts: [
      {
        title: seed.catalystTitle,
        type: seed.catalystType,
        date: "2026-05-06",
        impact: seed.market.dayChangePct >= 0 ? "positive" : "neutral",
        summary: seed.catalystSummary,
      },
    ],
    financialSnapshot: {
      revenue: seed.revenue,
      revenueYoY: seed.revenueYoY,
      eps: seed.eps,
      grossMargin: seed.grossMargin,
      freeCashFlow: seed.freeCashFlow,
      nextEarningsDate: seed.nextEarningsDate,
      guidance: `${seed.companyName} 的 mock 指引聚焦 AI 需求、订单可见度和利润率变化。`,
    },
    financialReadthrough: [
      `${seed.companyName} 的收入弹性主要取决于 ${seed.businessTags[0]} 的需求斜率。`,
      `需要观察毛利率是否能跟随 AI 相关产品占比提升而改善。`,
      `下一次财报前，重点跟踪订单、资本开支和管理层指引变化。`,
    ],
    thesis: [
      seed.summary,
      `放入池子的原因是它处在 ${getSectorName(seed.sectorId)} 的关键环节。`,
    ],
    watchPoints: [
      "盘前盘后异动是否被成交量确认。",
      "客户资本开支、供应链交付和财报指引是否同步改善。",
      "相对板块强度是否持续超过同组 ticker。",
    ],
    risks: [
      "估值已经反映较高增长预期。",
      "订单节奏、供应链约束或宏观利率变化可能压制风险偏好。",
    ],
  };
}

function getSectorName(sectorId: AlphaResearchSectorId) {
  return (
    ALPHA_RESEARCH_SECTORS.find((sector) => sector.id === sectorId)?.name ??
    sectorId
  );
}

export const ALPHA_RESEARCH_STOCKS: AlphaResearchStock[] = [
  buildStock({
    ticker: "NVDA",
    companyName: "NVIDIA",
    sectorId: "semiconductors",
    businessTags: ["AI GPU", "CUDA", "数据中心"],
    priority: "A",
    summary: "AI GPU 需求、Blackwell 出货和云厂商资本开支是核心变量。",
    market: {
      lastPrice: 921.4,
      dayChangePct: 3.8,
      prePostChangePct: 1.2,
      sevenDayChangePct: 11.2,
      relativeStrengthLabel: "组内最强",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "云资本开支预期上修",
    catalystType: "analyst",
    catalystSummary: "卖方上修 AI 服务器需求假设，市场继续交易 GPU 供给紧张。",
    revenue: "$26.0B",
    revenueYoY: "+18%",
    eps: "$6.12",
    grossMargin: "74.5%",
    freeCashFlow: "$14.9B",
    nextEarningsDate: "2026-05-22",
  }),
  buildStock({
    ticker: "TSM",
    companyName: "Taiwan Semiconductor",
    sectorId: "semiconductors",
    businessTags: ["先进制程", "CoWoS", "晶圆代工"],
    priority: "A",
    summary: "先进制程和高端封装产能决定 AI 芯片供给上限。",
    market: {
      lastPrice: 166.2,
      dayChangePct: 1.4,
      prePostChangePct: 0.5,
      sevenDayChangePct: 6.8,
      relativeStrengthLabel: "稳健强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "高端封装产能继续扩张",
    catalystType: "supply-chain",
    catalystSummary: "市场关注 CoWoS 产能扩张能否缓解 AI 加速卡交付瓶颈。",
    revenue: "$18.9B",
    revenueYoY: "+16%",
    eps: "$1.50",
    grossMargin: "53.2%",
    freeCashFlow: "$5.7B",
    nextEarningsDate: "2026-07-18",
  }),
  buildStock({
    ticker: "ASML",
    companyName: "ASML Holding",
    sectorId: "semiconductors",
    businessTags: ["EUV", "半导体设备", "先进制程"],
    priority: "A",
    summary: "EUV 订单和先进制程资本开支决定设备周期弹性。",
    market: {
      lastPrice: 931.6,
      dayChangePct: 0.9,
      prePostChangePct: 0.2,
      sevenDayChangePct: 4.1,
      relativeStrengthLabel: "跟随板块",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "先进制程设备订单观察",
    catalystType: "earnings",
    catalystSummary: "投资人等待订单能见度和中国区收入变化的更新。",
    revenue: "€6.7B",
    revenueYoY: "+10%",
    eps: "€4.85",
    grossMargin: "51.0%",
    freeCashFlow: "€1.9B",
    nextEarningsDate: "2026-07-16",
  }),
  buildStock({
    ticker: "AMD",
    companyName: "Advanced Micro Devices",
    sectorId: "semiconductors",
    businessTags: ["GPU", "CPU", "MI 系列"],
    priority: "A",
    summary: "MI 系列 GPU 渗透率和服务器 CPU 份额是重估关键。",
    market: {
      lastPrice: 158.8,
      dayChangePct: -0.8,
      prePostChangePct: 0.1,
      sevenDayChangePct: 5.5,
      relativeStrengthLabel: "回踩观察",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "AI GPU 份额预期分歧",
    catalystType: "product",
    catalystSummary: "市场交易 MI 系列放量速度，同时担心与龙头差距扩大。",
    revenue: "$6.2B",
    revenueYoY: "+12%",
    eps: "$0.88",
    grossMargin: "52.0%",
    freeCashFlow: "$0.9B",
    nextEarningsDate: "2026-07-30",
  }),
  buildStock({
    ticker: "AVGO",
    companyName: "Broadcom",
    sectorId: "semiconductors",
    businessTags: ["ASIC", "网络芯片", "软件"],
    priority: "A",
    summary: "定制 ASIC 和高速网络芯片受益于云厂商自研 AI 芯片。",
    market: {
      lastPrice: 1374.5,
      dayChangePct: 2.2,
      prePostChangePct: 0.7,
      sevenDayChangePct: 8.9,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "定制 AI 芯片需求升温",
    catalystType: "industry-event",
    catalystSummary: "云厂商自研芯片带动 ASIC 和网络芯片订单预期。",
    revenue: "$12.5B",
    revenueYoY: "+21%",
    eps: "$10.96",
    grossMargin: "63.8%",
    freeCashFlow: "$5.1B",
    nextEarningsDate: "2026-06-05",
  }),
  buildStock({
    ticker: "LRCX",
    companyName: "Lam Research",
    sectorId: "semiconductors",
    businessTags: ["刻蚀", "沉积", "存储设备"],
    priority: "B",
    summary: "存储资本开支恢复和先进封装需求是主要弹性来源。",
    market: {
      lastPrice: 948.3,
      dayChangePct: 1.1,
      prePostChangePct: 0.2,
      sevenDayChangePct: 3.7,
      relativeStrengthLabel: "温和修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "存储设备周期修复",
    catalystType: "supply-chain",
    catalystSummary: "HBM 与 NAND 供需改善推动设备订单预期改善。",
    revenue: "$3.9B",
    revenueYoY: "+8%",
    eps: "$7.80",
    grossMargin: "47.5%",
    freeCashFlow: "$1.1B",
    nextEarningsDate: "2026-07-25",
  }),
  buildStock({
    ticker: "COHR",
    companyName: "Coherent",
    sectorId: "optical",
    businessTags: ["光模块", "光材料", "800G/1.6T"],
    priority: "A",
    summary: "高速光模块需求和利润率修复是当前交易主线。",
    market: {
      lastPrice: 74.8,
      dayChangePct: 5.6,
      prePostChangePct: 1.4,
      sevenDayChangePct: 14.2,
      relativeStrengthLabel: "组内最强",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "1.6T 光模块需求预期升温",
    catalystType: "industry-event",
    catalystSummary: "AI 数据中心互联升级推动高速光模块订单预期上行。",
    revenue: "$1.2B",
    revenueYoY: "+11%",
    eps: "$0.72",
    grossMargin: "34.5%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-08-06",
  }),
  buildStock({
    ticker: "LITE",
    companyName: "Lumentum",
    sectorId: "optical",
    businessTags: ["光器件", "激光器", "云互联"],
    priority: "B",
    summary: "光器件订单恢复和客户库存去化是主要观察点。",
    market: {
      lastPrice: 58.2,
      dayChangePct: 2.1,
      prePostChangePct: 0.6,
      sevenDayChangePct: 7.5,
      relativeStrengthLabel: "强于板块",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "云客户订单恢复",
    catalystType: "supply-chain",
    catalystSummary: "投资人关注光器件库存调整后的订单回补速度。",
    revenue: "$0.4B",
    revenueYoY: "+6%",
    eps: "$0.29",
    grossMargin: "31.2%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-08-12",
  }),
  buildStock({
    ticker: "IPGP",
    companyName: "IPG Photonics",
    sectorId: "optical",
    businessTags: ["光纤激光器", "工业激光", "光学"],
    priority: "C",
    summary: "工业激光周期偏弱，AI 光学相关弹性仍需验证。",
    market: {
      lastPrice: 84.9,
      dayChangePct: 0.4,
      prePostChangePct: 0,
      sevenDayChangePct: 1.8,
      relativeStrengthLabel: "低弹性",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "工业需求底部观察",
    catalystType: "macro",
    catalystSummary: "市场等待工业需求改善和高端光学应用扩展证据。",
    revenue: "$0.3B",
    revenueYoY: "-2%",
    eps: "$0.48",
    grossMargin: "38.0%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-07-31",
  }),
  buildStock({
    ticker: "FN",
    companyName: "Fabrinet",
    sectorId: "optical",
    businessTags: ["光模块代工", "数据中心", "制造"],
    priority: "A",
    summary: "高速光模块代工需求直接反映云厂商互联升级。",
    market: {
      lastPrice: 228.6,
      dayChangePct: 3.2,
      prePostChangePct: 0.9,
      sevenDayChangePct: 10.4,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "高速光模块代工订单",
    catalystType: "supply-chain",
    catalystSummary: "客户升级 800G/1.6T 互联带动代工能见度改善。",
    revenue: "$0.7B",
    revenueYoY: "+15%",
    eps: "$2.10",
    grossMargin: "12.8%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-05-20",
  }),
  buildStock({
    ticker: "CIEN",
    companyName: "Ciena",
    sectorId: "optical",
    businessTags: ["网络设备", "光传输", "运营商"],
    priority: "B",
    summary: "数据中心互联强度需要抵消运营商需求波动。",
    market: {
      lastPrice: 51.7,
      dayChangePct: 1.7,
      prePostChangePct: 0.3,
      sevenDayChangePct: 4.9,
      relativeStrengthLabel: "跟随修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "数据中心互联项目更新",
    catalystType: "product",
    catalystSummary: "市场关注云互联需求能否提高订单质量。",
    revenue: "$1.0B",
    revenueYoY: "+5%",
    eps: "$0.67",
    grossMargin: "43.1%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-06-06",
  }),
  buildStock({
    ticker: "GLW",
    companyName: "Corning",
    sectorId: "optical",
    businessTags: ["光纤", "材料", "连接器"],
    priority: "B",
    summary: "光纤材料需求受益于数据中心建设和网络升级。",
    market: {
      lastPrice: 36.4,
      dayChangePct: 0.8,
      prePostChangePct: 0.1,
      sevenDayChangePct: 2.6,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "光纤需求温和改善",
    catalystType: "industry-event",
    catalystSummary: "AI 数据中心建设提供中期需求支撑。",
    revenue: "$3.3B",
    revenueYoY: "+4%",
    eps: "$0.38",
    grossMargin: "35.0%",
    freeCashFlow: "$0.5B",
    nextEarningsDate: "2026-07-29",
  }),
  buildStock({
    ticker: "MSFT",
    companyName: "Microsoft",
    sectorId: "cloud-software",
    businessTags: ["Azure", "Copilot", "企业软件"],
    priority: "A",
    summary: "Azure AI 增速、Copilot 渗透率和资本开支效率是核心变量。",
    market: {
      lastPrice: 429.5,
      dayChangePct: 1.5,
      prePostChangePct: 0.4,
      sevenDayChangePct: 5.8,
      relativeStrengthLabel: "稳健强势",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "Azure AI 消费增长",
    catalystType: "earnings",
    catalystSummary: "财报后市场继续关注 AI 服务对云增速的拉动。",
    revenue: "$61.9B",
    revenueYoY: "+17%",
    eps: "$2.94",
    grossMargin: "69.3%",
    freeCashFlow: "$21.0B",
    nextEarningsDate: "2026-07-24",
  }),
  buildStock({
    ticker: "AMZN",
    companyName: "Amazon",
    sectorId: "cloud-software",
    businessTags: ["AWS", "自研芯片", "电商现金流"],
    priority: "A",
    summary: "AWS AI 增速和资本开支回报决定云链条情绪。",
    market: {
      lastPrice: 184.1,
      dayChangePct: 1.2,
      prePostChangePct: 0.3,
      sevenDayChangePct: 4.3,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "AWS AI 订单观察",
    catalystType: "earnings",
    catalystSummary: "市场关注 AWS AI 收入贡献和 Trainium 进展。",
    revenue: "$143.3B",
    revenueYoY: "+12%",
    eps: "$0.98",
    grossMargin: "48.0%",
    freeCashFlow: "$36.8B",
    nextEarningsDate: "2026-08-01",
  }),
  buildStock({
    ticker: "GOOG",
    companyName: "Alphabet",
    sectorId: "cloud-software",
    businessTags: ["Google Cloud", "TPU", "搜索 AI"],
    priority: "A",
    summary: "Google Cloud 增速、TPU 生态和搜索 AI 货币化是关键。",
    market: {
      lastPrice: 171.9,
      dayChangePct: 0.9,
      prePostChangePct: 0.2,
      sevenDayChangePct: 3.9,
      relativeStrengthLabel: "跟随大盘",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "TPU 与云 AI 进展",
    catalystType: "product",
    catalystSummary: "投资人关注 AI 产品迭代是否转化为云增长和广告效率。",
    revenue: "$80.5B",
    revenueYoY: "+14%",
    eps: "$1.89",
    grossMargin: "57.0%",
    freeCashFlow: "$16.8B",
    nextEarningsDate: "2026-07-23",
  }),
  buildStock({
    ticker: "ORCL",
    companyName: "Oracle",
    sectorId: "cloud-software",
    businessTags: ["OCI", "数据库", "AI 云合同"],
    priority: "A",
    summary: "OCI 大单和数据库迁移是云基础设施补涨线索。",
    market: {
      lastPrice: 124.6,
      dayChangePct: 2.6,
      prePostChangePct: 0.8,
      sevenDayChangePct: 9.1,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "AI 云合同积压提升",
    catalystType: "earnings",
    catalystSummary: "市场交易 OCI 合同积压和 GPU 云交付速度。",
    revenue: "$13.3B",
    revenueYoY: "+11%",
    eps: "$1.41",
    grossMargin: "72.0%",
    freeCashFlow: "$8.5B",
    nextEarningsDate: "2026-06-12",
  }),
  buildStock({
    ticker: "NOW",
    companyName: "ServiceNow",
    sectorId: "cloud-software",
    businessTags: ["工作流", "企业 AI", "SaaS"],
    priority: "B",
    summary: "企业 AI 工作流变现和续约质量是核心观察点。",
    market: {
      lastPrice: 742.3,
      dayChangePct: 0.7,
      prePostChangePct: 0.2,
      sevenDayChangePct: 2.7,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "企业 AI 工作流采用",
    catalystType: "product",
    catalystSummary: "市场关注 AI 功能能否提升客单价和净留存。",
    revenue: "$2.6B",
    revenueYoY: "+22%",
    eps: "$3.41",
    grossMargin: "79.0%",
    freeCashFlow: "$0.8B",
    nextEarningsDate: "2026-07-24",
  }),
  buildStock({
    ticker: "SNOW",
    companyName: "Snowflake",
    sectorId: "cloud-software",
    businessTags: ["数据云", "AI 数据层", "消费型 SaaS"],
    priority: "B",
    summary: "数据云消费恢复和 AI 应用层拉动是估值修复关键。",
    market: {
      lastPrice: 151.2,
      dayChangePct: 1.9,
      prePostChangePct: 0.5,
      sevenDayChangePct: 6.1,
      relativeStrengthLabel: "修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "数据消费趋势改善",
    catalystType: "earnings",
    catalystSummary: "投资人关注客户优化压力是否缓解。",
    revenue: "$0.8B",
    revenueYoY: "+26%",
    eps: "$0.35",
    grossMargin: "72.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-05-28",
  }),
  buildStock({
    ticker: "PLTR",
    companyName: "Palantir",
    sectorId: "cloud-software",
    businessTags: ["AI 平台", "政府", "企业数据"],
    priority: "B",
    summary: "AIP 商业化速度和政府订单能见度决定高估值承接。",
    market: {
      lastPrice: 22.7,
      dayChangePct: 3.4,
      prePostChangePct: 1.1,
      sevenDayChangePct: 12.8,
      relativeStrengthLabel: "高弹性",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "AIP 商业客户扩张",
    catalystType: "product",
    catalystSummary: "市场交易 AI 平台从试点转向生产部署的速度。",
    revenue: "$0.7B",
    revenueYoY: "+20%",
    eps: "$0.08",
    grossMargin: "81.0%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-08-05",
  }),
  buildStock({
    ticker: "DELL",
    companyName: "Dell Technologies",
    sectorId: "data-center",
    businessTags: ["AI 服务器", "企业硬件", "存储"],
    priority: "A",
    summary: "AI 服务器订单和毛利率是服务器链条核心验证点。",
    market: {
      lastPrice: 132.8,
      dayChangePct: 1.1,
      prePostChangePct: 0.4,
      sevenDayChangePct: 5.9,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "AI 服务器订单积压",
    catalystType: "earnings",
    catalystSummary: "市场关注订单增长能否转化为利润率改善。",
    revenue: "$22.3B",
    revenueYoY: "+7%",
    eps: "$1.88",
    grossMargin: "23.1%",
    freeCashFlow: "$1.4B",
    nextEarningsDate: "2026-05-30",
  }),
  buildStock({
    ticker: "VRT",
    companyName: "Vertiv",
    sectorId: "data-center",
    businessTags: ["电力", "散热", "数据中心"],
    priority: "A",
    summary: "AI 数据中心电力和液冷需求是基础设施强势主线。",
    market: {
      lastPrice: 92.5,
      dayChangePct: 2.9,
      prePostChangePct: 0.9,
      sevenDayChangePct: 10.7,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "液冷和电力需求上行",
    catalystType: "industry-event",
    catalystSummary: "AI 集群功耗提升推动电力与散热基础设施订单。",
    revenue: "$1.9B",
    revenueYoY: "+15%",
    eps: "$0.43",
    grossMargin: "36.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-07-31",
  }),
  buildStock({
    ticker: "CLS",
    companyName: "Celestica",
    sectorId: "data-center",
    businessTags: ["服务器代工", "网络硬件", "EMS"],
    priority: "B",
    summary: "云客户硬件需求和网络设备订单决定弹性。",
    market: {
      lastPrice: 52.3,
      dayChangePct: 2.0,
      prePostChangePct: 0.4,
      sevenDayChangePct: 7.9,
      relativeStrengthLabel: "强于板块",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "云硬件订单改善",
    catalystType: "supply-chain",
    catalystSummary: "市场关注 AI 服务器和网络硬件代工需求。",
    revenue: "$2.1B",
    revenueYoY: "+13%",
    eps: "$0.86",
    grossMargin: "10.4%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-07-26",
  }),
  buildStock({
    ticker: "CRWV",
    companyName: "CoreWeave",
    sectorId: "data-center",
    businessTags: ["GPU 云", "AI 基础设施", "租赁"],
    priority: "B",
    summary: "GPU 云利用率、融资成本和客户集中度是核心变量。",
    market: {
      lastPrice: 41.6,
      dayChangePct: 4.2,
      prePostChangePct: 1.6,
      sevenDayChangePct: 13.5,
      relativeStrengthLabel: "高弹性",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "GPU 云需求升温",
    catalystType: "industry-event",
    catalystSummary: "AI 训练需求继续支撑 GPU 云租赁和基础设施扩张叙事。",
    revenue: "$0.6B",
    revenueYoY: "+55%",
    eps: "$0.12",
    grossMargin: "51.0%",
    freeCashFlow: "-$0.4B",
    nextEarningsDate: "2026-08-14",
  }),
  buildStock({
    ticker: "NBIS",
    companyName: "Nebius",
    sectorId: "data-center",
    businessTags: ["AI 云", "欧洲算力", "GPU 集群"],
    priority: "C",
    summary: "小市值 AI 云弹性高，但融资和执行风险也更高。",
    market: {
      lastPrice: 29.8,
      dayChangePct: 3.1,
      prePostChangePct: 1.0,
      sevenDayChangePct: 9.6,
      relativeStrengthLabel: "高波动",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "欧洲 AI 云扩张",
    catalystType: "industry-event",
    catalystSummary: "市场关注区域 AI 云需求和 GPU 集群建设进度。",
    revenue: "$0.2B",
    revenueYoY: "+35%",
    eps: "-$0.20",
    grossMargin: "38.0%",
    freeCashFlow: "-$0.2B",
    nextEarningsDate: "2026-08-20",
  }),
  buildStock({
    ticker: "MU",
    companyName: "Micron",
    sectorId: "storage",
    businessTags: ["HBM", "DRAM", "NAND"],
    priority: "A",
    summary: "HBM 供给紧张和存储价格周期是核心弹性来源。",
    market: {
      lastPrice: 118.4,
      dayChangePct: 2.8,
      prePostChangePct: 0.7,
      sevenDayChangePct: 8.4,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "HBM 价格与产能改善",
    catalystType: "supply-chain",
    catalystSummary: "AI GPU 需求拉动 HBM 价格和供给能见度。",
    revenue: "$5.8B",
    revenueYoY: "+32%",
    eps: "$0.45",
    grossMargin: "28.0%",
    freeCashFlow: "$0.4B",
    nextEarningsDate: "2026-06-26",
  }),
  buildStock({
    ticker: "WDC",
    companyName: "Western Digital",
    sectorId: "storage",
    businessTags: ["HDD", "NAND", "数据中心存储"],
    priority: "B",
    summary: "数据中心 HDD 需求和 NAND 周期决定利润率恢复。",
    market: {
      lastPrice: 72.1,
      dayChangePct: 1.6,
      prePostChangePct: 0.3,
      sevenDayChangePct: 6.2,
      relativeStrengthLabel: "修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "数据中心存储需求改善",
    catalystType: "supply-chain",
    catalystSummary: "云客户存储采购改善支撑 HDD 与 NAND 定价。",
    revenue: "$3.5B",
    revenueYoY: "+18%",
    eps: "$0.71",
    grossMargin: "26.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-08-01",
  }),
  buildStock({
    ticker: "SNDK",
    companyName: "SanDisk",
    sectorId: "storage",
    businessTags: ["NAND", "SSD", "消费存储"],
    priority: "C",
    summary: "NAND 周期修复提供弹性，但业务质量需要继续验证。",
    market: {
      lastPrice: 39.6,
      dayChangePct: 1.0,
      prePostChangePct: 0.2,
      sevenDayChangePct: 4.1,
      relativeStrengthLabel: "跟随修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "NAND 定价修复",
    catalystType: "macro",
    catalystSummary: "市场观察 NAND 价格和库存去化的持续性。",
    revenue: "$1.7B",
    revenueYoY: "+10%",
    eps: "$0.22",
    grossMargin: "24.0%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-08-08",
  }),
  buildStock({
    ticker: "STX",
    companyName: "Seagate",
    sectorId: "storage",
    businessTags: ["HDD", "Nearline", "数据中心"],
    priority: "B",
    summary: "Nearline HDD 需求和价格恢复是数据中心存储链条补涨点。",
    market: {
      lastPrice: 92.4,
      dayChangePct: 1.3,
      prePostChangePct: 0.3,
      sevenDayChangePct: 5.4,
      relativeStrengthLabel: "稳健修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "Nearline HDD 需求恢复",
    catalystType: "supply-chain",
    catalystSummary: "AI 数据增长推动大容量 HDD 需求改善。",
    revenue: "$1.9B",
    revenueYoY: "+12%",
    eps: "$0.74",
    grossMargin: "28.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-07-24",
  }),
];

export function getAlphaResearchSectorById(
  id: string,
): AlphaResearchSector | null {
  return (
    ALPHA_RESEARCH_SECTORS.find((sector) => sector.id === id) ?? null
  );
}

export function getAlphaResearchStockByTicker(
  ticker: string,
): AlphaResearchStock | null {
  const normalized = ticker.trim().toUpperCase();
  return (
    ALPHA_RESEARCH_STOCKS.find((stock) => stock.ticker === normalized) ?? null
  );
}

export function getAlphaResearchStocksForSector(
  sectorId: AlphaResearchSectorId,
): AlphaResearchStock[] {
  const sector = getAlphaResearchSectorById(sectorId);
  if (!sector) return [];
  const rank = new Map(sector.tickers.map((ticker, index) => [ticker, index]));
  return ALPHA_RESEARCH_STOCKS.filter((stock) => stock.sectorId === sectorId).sort(
    (left, right) => (rank.get(left.ticker) ?? 0) - (rank.get(right.ticker) ?? 0),
  );
}

export function getDefaultAlphaResearchStock(): AlphaResearchStock {
  return (
    getAlphaResearchStockByTicker(ALPHA_RESEARCH_DEFAULT_TICKER) ??
    ALPHA_RESEARCH_STOCKS[0]
  );
}
```

- [ ] **Step 4: Run the data test and verify it passes**

Run:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
```

Expected: PASS and prints `ok - alpha research pool data`.

- [ ] **Step 5: Commit data model work**

Run when `git` is available:

```bash
git add src/lib/alpha-research-pool.ts src/lib/alpha-research-pool.test.mjs
git commit -m "feat: add alpha research pool data"
```

Expected: commit succeeds. In the current Windows shell, `git` is not available; record that in the implementation notes instead of blocking the task.

---

### Task 2: Alpha Route, Navigation, and Page Container

**Files:**
- Create: `src/app/alpha/page.tsx`
- Create: `src/components/alpha-research-page.tsx`
- Create: `src/components/alpha-research-pool.tsx`
- Modify: `src/components/app-shell.tsx`
- Test: `src/lib/alpha-research-pool.test.mjs`

- [ ] **Step 1: Change the sidebar Alpha href**

In `src/components/app-shell.tsx`, update the Alpha nav item to use `/alpha`:

```ts
const shellNavItems = [
  { key: "signals", label: "信号", href: "/", icon: "signals" },
  { key: "holding", label: "Holding", href: "/holding", icon: "wallet" },
  { key: "alpha", label: "Alpha", href: "/alpha", icon: "spark" },
  { key: "markets", label: "市场", href: "/#markets", icon: "chart" },
  { key: "settings", label: "设置", href: "/settings", icon: "settings" },
] as const;
```

- [ ] **Step 2: Create the `/alpha` route**

Create `src/app/alpha/page.tsx`:

```tsx
import { AlphaResearchPage } from "@/components/alpha-research-page";
import { AppShell } from "@/components/app-shell";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";

export const dynamic = "force-dynamic";

export default function AlphaPage() {
  const strongCount = ALPHA_RESEARCH_STOCKS.filter(
    (stock) => stock.market.dayChangePct > 2,
  ).length;
  const upcomingEarnings = ALPHA_RESEARCH_STOCKS.filter(
    (stock) => stock.market.earningsStatus === "upcoming",
  ).length;

  return (
    <AppShell
      activeNav="alpha"
      subtitle="AI / 算力链美股投研池 · 消息 Alpha 辅助视图"
      mainClassName="mx-auto w-full max-w-[1780px] min-h-0 px-3 py-4 sm:px-5"
      statusPills={[
        {
          label: "Pool",
          status: "Mock",
          tone: "text-info",
          children: `${ALPHA_RESEARCH_STOCKS.length} tickers`,
        },
        {
          label: "Strong",
          status: "今日",
          tone: "text-success",
          children: `${strongCount} 只`,
        },
        {
          label: "Earnings",
          status: "临近",
          tone: "text-warning",
          children: `${upcomingEarnings} 只`,
        },
      ]}
    >
      <AlphaResearchPage />
    </AppShell>
  );
}
```

- [ ] **Step 3: Create the tab-owning client container**

Create `src/components/alpha-research-page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { AlphaResearchPool } from "@/components/alpha-research-pool";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import {
  ALPHA_RESEARCH_DEFAULT_TICKER,
  getAlphaResearchStockByTicker,
} from "@/lib/alpha-research-pool";

type AlphaTab = "research" | "messages";

const tabs: { id: AlphaTab; label: string; description: string }[] = [
  {
    id: "research",
    label: "美股投研池",
    description: "AI / 算力链股票池、催化事件和财报速览",
  },
  {
    id: "messages",
    label: "消息 Alpha",
    description: "Telegram / X 消息总结",
  },
];

export function AlphaResearchPage() {
  const [activeTab, setActiveTab] = useState<AlphaTab>("research");
  const [selectedTicker, setSelectedTicker] = useState(
    ALPHA_RESEARCH_DEFAULT_TICKER,
  );
  const selectedStock = useMemo(
    () => getAlphaResearchStockByTicker(selectedTicker),
    [selectedTicker],
  );

  return (
    <div className="grid min-h-0 gap-4">
      <section className="rounded-lg border border-line/70 bg-panel/95 shadow-sm backdrop-blur-xl">
        <div className="flex flex-col gap-3 border-b border-line/60 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">
              Alpha 美股投研池
            </h1>
            <p className="mt-1 text-xs text-muted">
              第一版使用本地 mock 数据验证投研工作流，不接真实行情和财务 API。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-line/70 bg-background/45 p-1 sm:w-[24rem]">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "min-h-10 rounded-[6px] px-2 py-1.5 text-left transition-colors",
                    selected
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted hover:bg-panel hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="block text-xs font-semibold">{tab.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] opacity-75">
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {activeTab === "research" ? (
        <AlphaResearchPool
          selectedStock={selectedStock}
          selectedTicker={selectedTicker}
          onSelectTicker={setSelectedTicker}
        />
      ) : (
        <AlphaSummaryCard />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create a minimal research pool composition**

Create `src/components/alpha-research-pool.tsx`:

```tsx
"use client";

import type { AlphaResearchStock } from "@/lib/alpha-research-pool";
import {
  ALPHA_RESEARCH_SECTORS,
  getAlphaResearchStocksForSector,
} from "@/lib/alpha-research-pool";

type AlphaResearchPoolProps = {
  selectedStock: AlphaResearchStock | null;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

export function AlphaResearchPool({
  selectedStock,
  selectedTicker,
  onSelectTicker,
}: AlphaResearchPoolProps) {
  return (
    <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(20rem,0.74fr)_minmax(0,1.26fr)]">
      <aside className="rounded-lg border border-line/70 bg-panel/95 p-3 shadow-sm backdrop-blur-xl">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">产业链股票池</h2>
          <p className="mt-1 text-xs text-muted">
            按板块分组，组内保留固定产业链顺序。
          </p>
        </div>
        <div className="space-y-4">
          {ALPHA_RESEARCH_SECTORS.map((sector) => (
            <section key={sector.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold text-foreground">
                  {sector.name}
                </h3>
                <span className="text-[11px] text-muted">
                  {sector.themeScore}
                </span>
              </div>
              <div className="space-y-1.5">
                {getAlphaResearchStocksForSector(sector.id).map((stock) => {
                  const selected = stock.ticker === selectedTicker;
                  return (
                    <button
                      key={stock.ticker}
                      type="button"
                      onClick={() => onSelectTicker(stock.ticker)}
                      className={[
                        "grid w-full grid-cols-[4.5rem_minmax(0,1fr)_4.25rem] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                        selected
                          ? "border-info/40 bg-info-soft"
                          : "border-line/60 bg-panel-strong/70 hover:border-line hover:bg-panel-strong",
                      ].join(" ")}
                    >
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {stock.ticker}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {stock.companyName}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {stock.businessTags.slice(0, 2).join(" / ")}
                        </span>
                      </span>
                      <span
                        className={`text-right font-mono text-xs font-semibold ${changeTone(
                          stock.market.dayChangePct,
                        )}`}
                      >
                        {formatSignedPercent(stock.market.dayChangePct)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </aside>

      <article className="rounded-lg border border-line/70 bg-panel/95 p-4 shadow-sm backdrop-blur-xl">
        {selectedStock ? (
          <div>
            <div className="flex flex-col gap-2 border-b border-line/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-mono text-2xl font-semibold text-foreground">
                    {selectedStock.ticker}
                  </h2>
                  <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
                    Priority {selectedStock.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {selectedStock.companyName}
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                  {selectedStock.summary}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  当日
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.dayChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.dayChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  盘前/盘后
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.prePostChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.prePostChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  7 日
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.sevenDayChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.sevenDayChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  财报
                </p>
                <p className="mt-2 text-sm font-semibold text-warning">
                  {selectedStock.market.earningsStatus}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
            暂无可展示 ticker
          </div>
        )}
      </article>
    </section>
  );
}
```

- [ ] **Step 5: Run focused test and build**

Run:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
& $NODE $PNPM build
```

Expected:

- Data test prints `ok - alpha research pool data`.
- Build succeeds with `/alpha` route included.

- [ ] **Step 6: Commit page shell work**

Run when `git` is available:

```bash
git add src/app/alpha/page.tsx src/components/alpha-research-page.tsx src/components/alpha-research-pool.tsx src/components/app-shell.tsx
git commit -m "feat: add alpha research page shell"
```

Expected: commit succeeds. In the current Windows shell, `git` is not available; record that in the implementation notes instead of blocking the task.

---

### Task 3: Extract and Polish the Sector List

**Files:**
- Create: `src/components/alpha-sector-list.tsx`
- Modify: `src/components/alpha-research-pool.tsx`
- Test: `src/lib/alpha-research-pool.test.mjs`

- [ ] **Step 1: Create `AlphaSectorList`**

Create `src/components/alpha-sector-list.tsx`:

```tsx
"use client";

import {
  ALPHA_RESEARCH_SECTORS,
  getAlphaResearchStocksForSector,
  type AlphaResearchEarningsStatus,
} from "@/lib/alpha-research-pool";

type AlphaSectorListProps = {
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function earningsLabel(status: AlphaResearchEarningsStatus) {
  const labels: Record<AlphaResearchEarningsStatus, string> = {
    recent: "已披露",
    upcoming: "临近",
    watch: "观察",
    quiet: "平静",
  };
  return labels[status];
}

function earningsTone(status: AlphaResearchEarningsStatus) {
  if (status === "upcoming") return "bg-warning-soft text-warning";
  if (status === "recent") return "bg-success-soft text-success";
  if (status === "watch") return "bg-info-soft text-info";
  return "bg-panel text-muted";
}

export function AlphaSectorList({
  selectedTicker,
  onSelectTicker,
}: AlphaSectorListProps) {
  return (
    <aside className="rounded-lg border border-line/70 bg-panel/95 p-3 shadow-sm backdrop-blur-xl">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">产业链股票池</h2>
        <p className="mt-1 text-xs text-muted">
          按板块分组，组内保留固定产业链顺序。
        </p>
      </div>

      <div className="space-y-4">
        {ALPHA_RESEARCH_SECTORS.map((sector) => (
          <section key={sector.id}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-foreground">
                  {sector.name}
                </h3>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted">
                  {sector.description}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 font-mono text-[11px] font-semibold text-accent">
                {sector.themeScore}
              </span>
            </div>

            <div className="space-y-1.5">
              {getAlphaResearchStocksForSector(sector.id).map((stock) => {
                const selected = stock.ticker === selectedTicker;
                return (
                  <button
                    key={stock.ticker}
                    type="button"
                    onClick={() => onSelectTicker(stock.ticker)}
                    className={[
                      "grid w-full grid-cols-[4.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                      selected
                        ? "border-info/40 bg-info-soft shadow-sm"
                        : "border-line/60 bg-panel-strong/70 hover:border-line hover:bg-panel-strong",
                    ].join(" ")}
                  >
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {stock.ticker}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {stock.companyName}
                      </span>
                      <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                        {stock.businessTags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-background/55 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="grid justify-items-end gap-1">
                      <span
                        className={`font-mono text-xs font-semibold ${changeTone(
                          stock.market.dayChangePct,
                        )}`}
                      >
                        {formatSignedPercent(stock.market.dayChangePct)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${earningsTone(
                          stock.market.earningsStatus,
                        )}`}
                      >
                        {earningsLabel(stock.market.earningsStatus)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Update `AlphaResearchPool` to use `AlphaSectorList`**

Replace the inline left list in `src/components/alpha-research-pool.tsx` with:

```tsx
"use client";

import { AlphaSectorList } from "@/components/alpha-sector-list";
import type { AlphaResearchStock } from "@/lib/alpha-research-pool";

type AlphaResearchPoolProps = {
  selectedStock: AlphaResearchStock | null;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

export function AlphaResearchPool({
  selectedStock,
  selectedTicker,
  onSelectTicker,
}: AlphaResearchPoolProps) {
  return (
    <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(20rem,0.74fr)_minmax(0,1.26fr)]">
      <AlphaSectorList
        selectedTicker={selectedTicker}
        onSelectTicker={onSelectTicker}
      />

      <article className="rounded-lg border border-line/70 bg-panel/95 p-4 shadow-sm backdrop-blur-xl">
        {selectedStock ? (
          <div>
            <div className="flex flex-col gap-2 border-b border-line/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-mono text-2xl font-semibold text-foreground">
                    {selectedStock.ticker}
                  </h2>
                  <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
                    Priority {selectedStock.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {selectedStock.companyName}
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                  {selectedStock.summary}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  当日
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.dayChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.dayChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  盘前/盘后
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.prePostChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.prePostChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  7 日
                </p>
                <p
                  className={`mt-2 font-mono text-xl font-semibold ${changeTone(
                    selectedStock.market.sevenDayChangePct,
                  )}`}
                >
                  {formatSignedPercent(selectedStock.market.sevenDayChangePct)}
                </p>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted">
                  财报
                </p>
                <p className="mt-2 text-sm font-semibold text-warning">
                  {selectedStock.market.earningsStatus}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
            暂无可展示 ticker
          </div>
        )}
      </article>
    </section>
  );
}
```

- [ ] **Step 3: Run data test and lint**

Run:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
& $NODE $PNPM lint
```

Expected:

- Data test prints `ok - alpha research pool data`.
- Lint exits without errors.

- [ ] **Step 4: Commit sector list work**

Run when `git` is available:

```bash
git add src/components/alpha-sector-list.tsx src/components/alpha-research-pool.tsx
git commit -m "feat: add alpha sector list"
```

Expected: commit succeeds. In the current Windows shell, `git` is not available; record that in the implementation notes instead of blocking the task.

---

### Task 4: Extract and Complete the Stock Detail Panel

**Files:**
- Create: `src/components/alpha-stock-detail.tsx`
- Modify: `src/components/alpha-research-pool.tsx`
- Test: `src/lib/alpha-research-pool.test.mjs`

- [ ] **Step 1: Create `AlphaStockDetail`**

Create `src/components/alpha-stock-detail.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import {
  getAlphaResearchSectorById,
  type AlphaCatalystType,
  type AlphaResearchEarningsStatus,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";

type AlphaStockDetailProps = {
  stock: AlphaResearchStock | null;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function earningsLabel(status: AlphaResearchEarningsStatus) {
  const labels: Record<AlphaResearchEarningsStatus, string> = {
    recent: "已披露",
    upcoming: "临近",
    watch: "观察",
    quiet: "平静",
  };
  return labels[status];
}

function catalystLabel(type: AlphaCatalystType) {
  const labels: Record<AlphaCatalystType, string> = {
    earnings: "财报",
    product: "产品",
    "supply-chain": "供应链",
    analyst: "机构",
    macro: "宏观",
    regulatory: "监管",
    "industry-event": "行业事件",
  };
  return labels[type];
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-normal text-muted">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <p key={item} className="break-words text-sm leading-6 text-foreground">
          {item}
        </p>
      ))}
    </div>
  );
}

export function AlphaStockDetail({ stock }: AlphaStockDetailProps) {
  if (!stock) {
    return (
      <article className="rounded-lg border border-line/70 bg-panel/95 p-4 shadow-sm backdrop-blur-xl">
        <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
          暂无可展示 ticker
        </div>
      </article>
    );
  }

  const sector = getAlphaResearchSectorById(stock.sectorId);

  return (
    <article className="rounded-lg border border-line/70 bg-panel/95 p-4 shadow-sm backdrop-blur-xl">
      <div className="flex flex-col gap-3 border-b border-line/60 pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-2xl font-semibold text-foreground">
              {stock.ticker}
            </h2>
            <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
              {sector?.name ?? stock.sectorId}
            </span>
            <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
              Priority {stock.priority}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">
            {stock.companyName}
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {stock.summary}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stock.businessTags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] font-medium text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
          <p className="text-[11px] font-semibold uppercase text-muted">当日</p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.dayChangePct,
            )}`}
          >
            {formatSignedPercent(stock.market.dayChangePct)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Last {formatUsd(stock.market.lastPrice)}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
          <p className="text-[11px] font-semibold uppercase text-muted">
            盘前 / 盘后
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.prePostChangePct,
            )}`}
          >
            {formatSignedPercent(stock.market.prePostChangePct)}
          </p>
          <p className="mt-1 text-xs text-muted">{stock.market.marketSession}</p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
          <p className="text-[11px] font-semibold uppercase text-muted">
            最近 7 日
          </p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${changeTone(
              stock.market.sevenDayChangePct,
            )}`}
          >
            {formatSignedPercent(stock.market.sevenDayChangePct)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {stock.market.relativeStrengthLabel}
          </p>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel-strong/80 p-3">
          <p className="text-[11px] font-semibold uppercase text-muted">财报</p>
          <p className="mt-2 text-lg font-semibold text-warning">
            {earningsLabel(stock.market.earningsStatus)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {stock.financialSnapshot.nextEarningsDate}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
        <div className="space-y-4">
          <Section title="催化事件 / 新闻驱动">
            <div className="space-y-2">
              {stock.catalysts.map((catalyst) => (
                <article
                  key={`${catalyst.date}-${catalyst.title}`}
                  className="rounded-md border border-line/60 bg-panel px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">
                      {catalystLabel(catalyst.type)}
                    </span>
                    <span className="text-[11px] text-muted">
                      {catalyst.date}
                    </span>
                    <span className="text-[11px] text-muted">
                      {catalyst.impact}
                    </span>
                  </div>
                  <h4 className="mt-2 text-sm font-semibold text-foreground">
                    {catalyst.title}
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {catalyst.summary}
                  </p>
                </article>
              ))}
            </div>
          </Section>

          <Section title="财报解读">
            <BulletList items={stock.financialReadthrough} />
          </Section>

          <Section title="研究要点">
            <BulletList items={stock.thesis} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="财报速览">
            <div className="grid gap-2 text-sm">
              {[
                ["营收", stock.financialSnapshot.revenue],
                ["营收同比", stock.financialSnapshot.revenueYoY],
                ["EPS", stock.financialSnapshot.eps],
                ["毛利率", stock.financialSnapshot.grossMargin],
                ["自由现金流", stock.financialSnapshot.freeCashFlow],
                ["指引", stock.financialSnapshot.guidance],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 rounded-md bg-background/45 px-2 py-1.5"
                >
                  <span className="text-muted">{label}</span>
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="观察点">
            <BulletList items={stock.watchPoints} />
          </Section>

          <Section title="风险">
            <div className="space-y-2">
              {stock.risks.map((risk) => (
                <p key={risk} className="text-sm leading-6 text-warning">
                  {risk}
                </p>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Update `AlphaResearchPool` to use `AlphaStockDetail`**

Replace `src/components/alpha-research-pool.tsx` with:

```tsx
"use client";

import { AlphaSectorList } from "@/components/alpha-sector-list";
import { AlphaStockDetail } from "@/components/alpha-stock-detail";
import type { AlphaResearchStock } from "@/lib/alpha-research-pool";

type AlphaResearchPoolProps = {
  selectedStock: AlphaResearchStock | null;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

export function AlphaResearchPool({
  selectedStock,
  selectedTicker,
  onSelectTicker,
}: AlphaResearchPoolProps) {
  return (
    <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(20rem,0.74fr)_minmax(0,1.26fr)]">
      <AlphaSectorList
        selectedTicker={selectedTicker}
        onSelectTicker={onSelectTicker}
      />
      <AlphaStockDetail stock={selectedStock} />
    </section>
  );
}
```

- [ ] **Step 3: Run data test, lint, and build**

Run:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
& $NODE $PNPM lint
& $NODE $PNPM build
```

Expected:

- Data test prints `ok - alpha research pool data`.
- Lint exits without errors.
- Build exits without errors.

- [ ] **Step 4: Commit stock detail work**

Run when `git` is available:

```bash
git add src/components/alpha-stock-detail.tsx src/components/alpha-research-pool.tsx
git commit -m "feat: add alpha stock detail"
```

Expected: commit succeeds. In the current Windows shell, `git` is not available; record that in the implementation notes instead of blocking the task.

---

### Task 5: Final Verification and Visual Check

**Files:**
- Modify only if verification finds a concrete issue in files from Tasks 1-4.
- Test: `src/lib/alpha-research-pool.test.mjs`

- [ ] **Step 1: Run the focused data test**

Run:

```powershell
& $NODE --experimental-strip-types --experimental-transform-types src\lib\alpha-research-pool.test.mjs
```

Expected: PASS and prints `ok - alpha research pool data`.

- [ ] **Step 2: Run lint**

Run:

```powershell
& $NODE $PNPM lint
```

Expected: lint exits without errors.

- [ ] **Step 3: Run build**

Run:

```powershell
& $NODE $PNPM build
```

Expected: build exits without errors and includes the `/alpha` route.

- [ ] **Step 4: Inspect the UI in browser**

Start the dev server:

```powershell
& $NODE $PNPM dev
```

Open `http://localhost:3000/alpha`.

Expected visual checks:

- Sidebar Alpha item is active on `/alpha`.
- Default tab is `美股投研池`.
- `消息 Alpha` tab switches to the existing Alpha summary card.
- Left side shows all five sectors.
- `NVDA` is selected by default.
- Clicking `COHR`, `ORCL`, `VRT`, and `MU` changes the right detail.
- Right detail includes market strength, catalyst/news driver, financial snapshot, financial readthrough, thesis, watch points, and risks.
- At mobile width, list and detail stack vertically without text overlap.

- [ ] **Step 5: Commit final verification fixes**

Run when `git` is available and verification produced file changes:

```bash
git add src/app/alpha/page.tsx src/components/alpha-research-page.tsx src/components/alpha-research-pool.tsx src/components/alpha-sector-list.tsx src/components/alpha-stock-detail.tsx src/components/app-shell.tsx src/lib/alpha-research-pool.ts src/lib/alpha-research-pool.test.mjs
git commit -m "fix: polish alpha research pool"
```

Expected: commit succeeds. In the current Windows shell, `git` is not available; record that in the implementation notes instead of blocking the task.
