# Binance Holding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a professional read-only Holding page that shows Binance spot balances and USD-M futures positions.

**Architecture:** Keep Binance signing and normalization in a server-only library, expose one dynamic API route, and render a dedicated client panel through a shared app shell. The API returns normalized holdings only and never exposes secrets.

**Tech Stack:** Next.js App Router route handlers, React client components, Node `crypto`, built-in `fetch`, existing Tailwind CSS theme tokens.

---

### Task 1: Binance Holdings Library

**Files:**
- Create: `src/lib/binance-holdings.test.mjs`
- Create: `src/lib/binance-holdings.ts`

- [ ] Write failing tests that import `createBinanceSignature`, `buildSignedBinanceQuery`, `normalizeSpotBalances`, `normalizeFuturesPositions`, and `buildHoldingSummary`.
- [ ] Run `node --experimental-strip-types --experimental-transform-types src/lib/binance-holdings.test.mjs` and confirm it fails because `src/lib/binance-holdings.ts` does not exist.
- [ ] Implement HMAC SHA256 signing, deterministic query building, spot balance filtering, futures active-position filtering, and summary totals.
- [ ] Re-run the test and confirm it passes.

### Task 2: Binance Holdings API Route

**Files:**
- Create: `src/app/api/holdings/binance/route.ts`
- Modify: `.env.example`

- [ ] Add `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_SPOT_BASE_URL`, `BINANCE_FUTURES_BASE_URL`, and `BINANCE_RECV_WINDOW` examples.
- [ ] Add a dynamic GET route that calls `getBinanceHoldingSnapshot`.
- [ ] Return 400 for missing credentials and 502 for Binance upstream failures.
- [ ] Ensure the route response does not include API key, secret, request headers, or signed URLs.

### Task 3: Shared Shell

**Files:**
- Create: `src/components/app-shell.tsx`
- Modify: `src/app/page.tsx`

- [ ] Move sidebar glyphs, nav items, status pill rendering, header, and theme/settings controls into `AppShell`.
- [ ] Replace the old "收藏" nav with `Holding` linked to `/holding`.
- [ ] Keep home active state on `/` and use an explicit `activeNav="signals"` prop.
- [ ] Keep the home page main grid behavior unchanged.

### Task 4: Holding Panel UI

**Files:**
- Create: `src/components/holding-panel.tsx`
- Create: `src/app/holding/page.tsx`

- [ ] Build a client panel that fetches `/api/holdings/binance`.
- [ ] Render top summary cards for spot assets, futures positions, futures wallet balance, unrealized PnL, and total futures notional.
- [ ] Render a futures table with symbol, side, leverage, amount, notional, entry price, mark price, liquidation price, margin type, and PnL.
- [ ] Render a spot table with asset, available, frozen, and total balance.
- [ ] Add loading, error, empty, stale-refresh, and manual-refresh states.
- [ ] Use the shared `AppShell` with `activeNav="holding"`.

### Task 5: Verification

**Files:**
- Read only.

- [ ] Run `node --experimental-strip-types --experimental-transform-types src/lib/binance-holdings.test.mjs`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] If a command fails because of environment or existing unrelated issues, capture the exact failure and keep the implementation files intact.

