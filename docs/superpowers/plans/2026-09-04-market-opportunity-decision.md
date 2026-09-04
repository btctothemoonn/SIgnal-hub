# Market Opportunity Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable, rule-selected `做单决策 · Top 5` workspace to the existing contract-alert page for trades held under 12 hours, with bounded Binance enrichment and cached AI explanations.

**Architecture:** A new independent opportunity worker reads the existing market-alert SQLite data, enriches at most 12 symbols through the shared Binance limiter, scores three pure decision models, applies persistent hysteresis, and writes at most five candidates back to the same database. The existing API and SSE stream expose those persisted records additively; the web request path never calls Binance or AI. MiniMax/DeepSeek only explain deterministic decisions and cannot change membership, direction, stage, or score.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node.js 22 `node:sqlite`, Binance public REST APIs, OpenAI-compatible MiniMax/DeepSeek chat completions, Tailwind CSS, Node `assert` tests.

**Spec:** `docs/superpowers/specs/2026-09-04-market-opportunity-decision-design.md`

## Global Constraints

- Keep existing pump, crash, short-squeeze workers, event history, charts, filters, ranking, and health UI.
- Show decisions only on the webpage; add no Telegram, browser, or operating-system notification.
- Never use Binance account, position, order, trading, or withdrawal APIs.
- Target holding periods below 12 hours and expose at most five qualified candidates.
- Enrich at most 12 preliminary candidates and no symbol more often than once every two minutes.
- A score of 70 is the observation threshold; actionable status requires score 80 plus mandatory confirmation.
- New candidates require two qualifying scans; removal requires three scans below 60; hard invalidation removes actionable status immediately.
- A newcomer must beat the fifth candidate by at least five points unless the fifth candidate is invalid.
- No confirmation for two hours downgrades/removes; no qualifying renewal for 12 hours expires the candidate.
- AI is explanatory only, batched, fingerprint-cached, at least 10 minutes apart, and capped at six generations per rolling hour.
- MiniMax is primary and DeepSeek is fallback through the existing provider configuration.
- Preserve the unrelated untracked `monitor-codex-handoff/` directory and all user/runtime secrets.

---

### Task 1: Typed Opportunity Rules And Three Scoring Models

**Files:**
- Create: `src/lib/market-opportunity-config.ts`
- Create: `src/lib/market-opportunity-core.ts`
- Create: `src/lib/market-opportunity-core.test.mjs`

**Interfaces:**
- Consumes: no storage, network, or UI dependencies.
- Produces: `MarketOpportunityMetrics`, `MarketOpportunityDecision`, `scoreCapitalDrivenLong()`, `scoreDistributionShort()`, `scoreSqueezeLong()`, and `chooseMarketOpportunityDecision()`.

- [ ] **Step 1: Write failing scoring tests**

```js
const confirmedLong = scoreCapitalDrivenLong({
  ...completeMetrics,
  pct5m: 3.2, pct15m: 6.4, pct1h: 11.5,
  volumeRatio5m: 2.8, oiGrowth15m: 8.2,
  takerBuySellRatio: 1.34, spotChange15m: 5.8,
  distanceFromHighPct: -1.2, funding: 0.0001,
});
assert.ok(confirmedLong.score >= 80);
assert.equal(confirmedLong.stage, "拉盘做多确认");
assert.equal(confirmedLong.decision, "关注做多");

const missingOi = scoreCapitalDrivenLong({ ...completeMetrics, oiGrowth15m: null });
assert.equal(missingOi.mandatoryComplete, false);
assert.equal(missingOi.decision, "等待确认");
assert.ok(missingOi.score < 80);

const distribution = scoreDistributionShort({
  ...completeMetrics,
  priorRunUpPct: 35, distanceFromHighPct: -8,
  supportBreak: false, lowerStructure: true,
  takerBuySellRatio: 0.72, oiGrowth15m: -14,
});
assert.equal(distribution.stage, "疑似高位派发");
assert.equal(distribution.decision, "等待确认");

const confirmedShort = scoreDistributionShort({
  ...completeMetrics,
  priorRunUpPct: 42, distanceFromHighPct: -12,
  supportBreak: true, lowerStructure: true,
  takerBuySellRatio: 0.68, oiGrowth15m: 5,
});
assert.equal(confirmedShort.stage, "做空结构确认");
assert.equal(confirmedShort.decision, "关注做空");

const squeeze = scoreSqueezeLong({
  ...completeMetrics,
  funding: -0.0012, basis: -0.002,
  oiGrowth15m: 16, globalLongShortRatio: 0.72,
  topTraderLongShortRatio: 0.81, takerBuySellRatio: 1.35,
  breakout20: true,
});
assert.equal(squeeze.stage, "轧空启动");
assert.equal(squeeze.direction, "LONG");

const chase = scoreCapitalDrivenLong({
  ...completeMetrics,
  pct15m: 18, pct1h: 45, distanceFromHighPct: 0,
  funding: 0.003, perpSpotDivergencePct: 5.5,
});
assert.equal(chase.decision, "禁止追单");
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node src/lib/market-opportunity-core.test.mjs`

Expected: FAIL because `market-opportunity-core.ts` does not exist.

- [ ] **Step 3: Add the typed configuration and pure scoring functions**

```ts
export const MARKET_OPPORTUNITY_RULES = {
  observeScore: 70,
  actionableScore: 80,
  exitScore: 60,
  enrichmentLimit: 12,
  outputLimit: 5,
  enrichmentFreshMs: 2 * 60_000,
  confirmationFreshMs: 2 * 60 * 60_000,
  maxLifetimeMs: 12 * 60 * 60_000,
  replacementGap: 5,
} as const;

export type MarketOpportunityDecision = {
  symbol: string;
  model: "capital_long" | "distribution_short" | "short_squeeze";
  direction: "LONG" | "SHORT";
  stage: "疑似资金推动" | "拉盘做多确认" | "疑似高位派发" |
    "做空结构确认" | "轧空蓄势" | "轧空启动" | "杠杆拉盘，谨防回撤";
  decision: "关注做多" | "关注做空" | "等待确认" | "禁止追单";
  score: number;
  confidence: number;
  evidence: string[];
  confirmations: string[];
  invalidations: string[];
  risks: string[];
  mandatoryComplete: boolean;
  hardInvalidated: boolean;
  dataCoverage: number;
  metrics: MarketOpportunityMetrics;
  observedAt: string;
  expiresAt: string;
};
```

Implement all weights in `MARKET_OPPORTUNITY_RULES`, clamp scores to `0..100`, cap incomplete records below 80, force stale records to `等待确认`, and map existing squeeze semantics to `轧空蓄势`/`轧空启动`. `chooseMarketOpportunityDecision()` returns one decision per symbol and prefers a confirmed squeeze over an unconfirmed momentum observation.

- [ ] **Step 4: Run the scoring tests and existing market core tests**

Run: `node src/lib/market-opportunity-core.test.mjs`

Run: `node src/lib/market-alerts-core.test.mjs`

Expected: PASS for both; existing squeeze alert semantics remain unchanged.

- [ ] **Step 5: Commit the scoring layer**

```bash
git add src/lib/market-opportunity-config.ts src/lib/market-opportunity-core.ts src/lib/market-opportunity-core.test.mjs
git commit -m "feat: score market opportunity setups"
```

### Task 2: Stable Top Five State Machine

**Files:**
- Create: `src/lib/market-opportunity-selection.ts`
- Create: `src/lib/market-opportunity-selection.test.mjs`

**Interfaces:**
- Consumes: `MarketOpportunityDecision` and thresholds from Task 1.
- Produces: `MarketOpportunityCandidateState`, `transitionMarketOpportunityCandidates()`, and `buildMarketOpportunityFingerprint()`.

- [ ] **Step 1: Write failing transition tests**

```js
let state = transitionMarketOpportunityCandidates([], [decision("AAAUSDT", 82)], now);
assert.equal(state.selected.length, 0);
state = transitionMarketOpportunityCandidates(state.states, [decision("AAAUSDT", 83)], now + 60_000);
assert.deepEqual(state.selected.map((item) => item.symbol), ["AAAUSDT"]);

state = transitionMarketOpportunityCandidates(state.states, [decision("AAAUSDT", 55)], now + 120_000);
assert.equal(state.selected.length, 1);
state = transitionMarketOpportunityCandidates(state.states, [decision("AAAUSDT", 54)], now + 180_000);
assert.equal(state.selected.length, 1);
state = transitionMarketOpportunityCandidates(state.states, [decision("AAAUSDT", 53)], now + 240_000);
assert.equal(state.selected.length, 0);

const invalid = transitionMarketOpportunityCandidates(
  seededFive,
  [{ ...decision("AAAUSDT", 88), hardInvalidated: true }],
  now,
);
assert.ok(!invalid.selected.some((item) => item.symbol === "AAAUSDT"));

const noGap = transitionMarketOpportunityCandidates(seededFive, [decision("NEWUSDT", 83)], now);
assert.ok(!noGap.selected.some((item) => item.symbol === "NEWUSDT"));
const withGap = transitionMarketOpportunityCandidates(seededFive, [decision("NEWUSDT", 90)], now);
assert.ok(withGap.selected.some((item) => item.symbol === "NEWUSDT"));
assert.equal(new Set(withGap.selected.map((item) => item.symbol)).size, withGap.selected.length);
```

Also assert two-hour confirmation decay, 12-hour expiry, maximum length five, one row per symbol, and fingerprint stability across harmless metric noise within the same material bands.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node src/lib/market-opportunity-selection.test.mjs`

Expected: FAIL because the selection module does not exist.

- [ ] **Step 3: Implement hysteresis, expiry, replacement, and fingerprinting**

```ts
export type MarketOpportunityCandidateState = {
  symbol: string;
  decision: MarketOpportunityDecision;
  entryStreak: number;
  exitStreak: number;
  enteredAt: string | null;
  lastQualifiedAt: string | null;
  lastConfirmedAt: string | null;
  selected: boolean;
  updatedAt: string;
};

export function transitionMarketOpportunityCandidates(
  previous: MarketOpportunityCandidateState[],
  incoming: MarketOpportunityDecision[],
  nowMs = Date.now(),
): { states: MarketOpportunityCandidateState[]; selected: MarketOpportunityDecision[] };

export function buildMarketOpportunityFingerprint(
  selected: MarketOpportunityDecision[],
): string;
```

Fingerprint only membership, rank, direction, stage, 10-point score band, confirmation state, and material OI/funding/taker/price bands. Do not include timestamps or raw floating-point noise.

- [ ] **Step 4: Run transition tests**

Run: `node src/lib/market-opportunity-selection.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the state machine**

```bash
git add src/lib/market-opportunity-selection.ts src/lib/market-opportunity-selection.test.mjs
git commit -m "feat: stabilize market opportunity top five"
```

### Task 3: SQLite Persistence, Migration, Snapshot, And Revision

**Files:**
- Modify: `src/lib/market-alerts-store.ts`
- Modify: `src/lib/market-alerts-store.test.mjs`

**Interfaces:**
- Consumes: candidate and decision types from Tasks 1-2.
- Produces store methods `getOpportunitySeedData()`, `getOpportunityEnrichment()`, `upsertOpportunityEnrichment()`, `getOpportunityCandidateStates()`, `replaceOpportunityCandidateStates()`, `saveOpportunitySelection()`, `saveOpportunityAiResult()`, `getOpportunityAiPolicy()`, and `pruneOpportunityDiagnostics()`; extends snapshots with `opportunities`, `opportunityMeta`, and `health.opportunity`.

- [ ] **Step 1: Add failing migration and restart-persistence assertions**

```js
assert.deepEqual(store.getOpportunityCandidateStates(), []);
store.upsertOpportunityEnrichment({
  symbol: "AAAUSDT",
  metrics: completeMetrics,
  fetchedAt: "2026-09-04T01:00:00.000Z",
  stale: false,
  error: null,
});
store.replaceOpportunityCandidateStates([candidateState]);
store.saveOpportunitySelection({
  selected: [candidateState.decision],
  fingerprint: "fp-1",
  scannedAt: "2026-09-04T01:01:00.000Z",
});
store.close();

const reopened = openMarketAlertsStore(dbPath);
assert.equal(reopened.getOpportunityCandidateStates()[0].symbol, "AAAUSDT");
assert.equal(reopened.getMarketAlertsSnapshot().opportunities[0].symbol, "AAAUSDT");
assert.equal(reopened.getMarketAlertsSnapshot().opportunityMeta.fingerprint, "fp-1");
```

Assert that saving a changed Top 5 increments `getMarketAlertsRevision()`, saving an identical fingerprint does not rewrite the selection, cached enrichment survives restart, AI runs enforce 10-minute and six-per-hour limits, and diagnostics older than seven days are pruned without touching `market_alert_events`.

- [ ] **Step 2: Run store tests and confirm RED**

Run: `node src/lib/market-alerts-store.test.mjs`

Expected: FAIL because opportunity store methods and snapshot fields do not exist.

- [ ] **Step 3: Add focused tables and mappers**

```sql
CREATE TABLE IF NOT EXISTS market_opportunity_candidates (
  symbol TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_opportunity_enrichment (
  symbol TEXT PRIMARY KEY,
  metrics_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_opportunity_selection (
  rank INTEGER PRIMARY KEY CHECK(rank BETWEEN 1 AND 5),
  symbol TEXT NOT NULL UNIQUE,
  decision_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_opportunity_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  fingerprint TEXT,
  last_scan_at TEXT,
  last_success_at TEXT,
  ai_json TEXT,
  ai_provider TEXT,
  ai_generated_at TEXT,
  ai_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_opportunity_ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_opportunity_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Use transactions for replacing candidates/selection. Add all six tables to `revisionTables`, include opportunity timestamps in `latestUpdatedAt`, and map missing/empty databases to `opportunities: []` plus non-null metadata rather than throwing.

- [ ] **Step 4: Implement seed queries and persisted AI policy**

`getOpportunitySeedData({ since, limit: 12 })` returns grouped recent event evidence, current ticker/valuation fields, active-signal state, and the newest fresh squeeze metrics per symbol. `getOpportunityAiPolicy({ fingerprint, nowMs })` returns one of `unchanged`, `cooldown`, `hourly-cap`, or `allowed`; it counts successful and failed attempted generations so repeated provider failures cannot bypass the cap.

- [ ] **Step 5: Run store tests**

Run: `node src/lib/market-alerts-store.test.mjs`

Expected: PASS, including restart, migration, revision, AI policy, and pruning cases.

- [ ] **Step 6: Commit persistence**

```bash
git add src/lib/market-alerts-store.ts src/lib/market-alerts-store.test.mjs
git commit -m "feat: persist market opportunity decisions"
```

### Task 4: Bounded Binance Enrichment

**Files:**
- Modify: `src/lib/market-alerts-binance.ts`
- Create: `src/lib/market-opportunity-enrichment.ts`
- Create: `src/lib/market-opportunity-enrichment.test.mjs`

**Interfaces:**
- Consumes: `BinanceMarketClient`, shared store limiter, seed rows and cached enrichment from Task 3.
- Produces: additional public client methods plus `deriveOpportunityMetrics()` and `enrichOpportunitySeeds()`.

- [ ] **Step 1: Write failing enrichment tests**

```js
const derived = deriveOpportunityMetrics({ futures5m, futures1m, spot5m });
assert.equal(derived.pct15m, 6);
assert.equal(derived.pct1h, 14);
assert.equal(derived.breakout20, true);
assert.ok(derived.priorRunUpPct > 0);
assert.ok(Number.isFinite(derived.perpSpotDivergencePct));

const cached = await enrichOpportunitySeeds({
  seeds: [seed],
  getCached: () => ({ metrics: completeMetrics, fetchedAt: oneMinuteAgo }),
  client: throwingClient,
  nowMs,
});
assert.equal(cached[0].source, "cache");
assert.equal(throwingClient.calls, 0);

const partial = await enrichOpportunitySeeds({
  seeds: [seed],
  getCached: () => null,
  client: clientWhoseSpotEndpointFails,
  nowMs,
});
assert.equal(partial[0].metrics.spotAvailable, false);
assert.equal(partial[0].stale, false);
```

Also assert only the first 12 seeds are enriched, concurrency never exceeds the configured bound, a failed refresh retains stale cached metrics with an error, and fresh squeeze metrics prevent duplicate OI/funding/ratio calls.

- [ ] **Step 2: Run the enrichment test and confirm RED**

Run: `node src/lib/market-opportunity-enrichment.test.mjs`

Expected: FAIL because the enrichment module does not exist.

- [ ] **Step 3: Extend the public Binance client without changing existing callers**

```ts
export interface BinanceMarketClient {
  // existing methods remain
  getOpportunityFuturesContext?(symbol: string): Promise<{
    klines1m: KlineRow[];
    klines5m: KlineRow[];
    premium: JsonRecord | null;
    openInterest: JsonRecord[];
    globalLongShortRatio: number | null;
    topTraderLongShortRatio: number | null;
    takerBuySellRatio: number | null;
  }>;
  getSpotContext?(symbol: string): Promise<{
    ticker: JsonRecord | null;
    klines5m: KlineRow[];
  } | null>;
}
```

Route spot requests to `https://api.binance.com` through the same serialized request gate and shared SQLite backoff. Fetch 24 hours of 5-minute futures candles once and derive 15-minute/1-hour values locally. A spot `400/404` means `spotAvailable: false`, not a worker-wide failure.

- [ ] **Step 4: Implement cache-first enrichment**

```ts
export async function enrichOpportunitySeeds(input: {
  seeds: MarketOpportunitySeed[];
  client: BinanceMarketClient;
  getCached: (symbol: string) => StoredOpportunityEnrichment | null;
  nowMs?: number;
  maxCandidates?: number;
  concurrency?: number;
}): Promise<OpportunityEnrichmentResult[]>;
```

Reuse cache younger than two minutes. Merge fresh squeeze event metrics before network requests. For failed refreshes, return previous metrics as `stale: true`; without previous metrics, return a partial record whose missing critical fields force `等待确认` in Task 1.

- [ ] **Step 5: Run enrichment and existing Binance tests**

Run: `node src/lib/market-opportunity-enrichment.test.mjs`

Run: `node src/lib/market-alerts-binance.test.mjs`

Expected: PASS with no changes to existing volatility/squeeze behavior.

- [ ] **Step 6: Commit enrichment**

```bash
git add src/lib/market-alerts-binance.ts src/lib/market-opportunity-enrichment.ts src/lib/market-opportunity-enrichment.test.mjs
git commit -m "feat: enrich bounded market opportunity candidates"
```

### Task 5: Opportunity Scan Orchestration

**Files:**
- Create: `src/lib/market-opportunity-worker.ts`
- Create: `src/lib/market-opportunity-worker.test.mjs`

**Interfaces:**
- Consumes: store methods from Task 3, enrichment from Task 4, scoring from Task 1, and selection from Task 2.
- Produces: `runMarketOpportunityScan()` returning counts, fingerprint, and selection while making no AI call.

- [ ] **Step 1: Write a failing end-to-end scan test with fakes**

```js
const result = await runMarketOpportunityScan({
  store: fakeStore,
  client: fakeClient,
  nowMs: Date.parse("2026-09-04T02:00:00.000Z"),
});
assert.equal(result.seedCount, 20);
assert.equal(result.enrichedCount, 12);
assert.ok(result.selectedCount <= 5);
assert.equal(fakeStore.savedSelection.length, result.selectedCount);
assert.equal(fakeStore.heartbeats.at(-1).worker, "opportunity");
```

Add cases for no qualifying candidates, partial Binance failure, stale-cache downgrade, duplicate-symbol collapse, deterministic ordering, and diagnostics pruning.

- [ ] **Step 2: Run the worker test and confirm RED**

Run: `node src/lib/market-opportunity-worker.test.mjs`

Expected: FAIL because the orchestration module does not exist.

- [ ] **Step 3: Implement the rule-only scan**

```ts
export async function runMarketOpportunityScan(input: {
  store?: ReturnType<typeof openMarketAlertsStore>;
  client?: BinanceMarketClient;
  nowMs?: number;
}): Promise<{
  seedCount: number;
  enrichedCount: number;
  selectedCount: number;
  fingerprint: string;
}>;
```

Read a two-hour event window, preliminary-rank grouped symbols, enrich at most 12, persist every enrichment result, score all three models, select one result per symbol, transition persistent state, save Top 5, prune seven-day diagnostics, and update `opportunity` heartbeat. Ensure the injected store is not closed by the function; close only stores created internally.

- [ ] **Step 4: Run orchestration tests**

Run: `node src/lib/market-opportunity-worker.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit orchestration**

```bash
git add src/lib/market-opportunity-worker.ts src/lib/market-opportunity-worker.test.mjs
git commit -m "feat: orchestrate market opportunity scans"
```

### Task 6: Cached Batched AI Explanation

**Files:**
- Create: `src/lib/market-opportunity-ai.ts`
- Create: `src/lib/market-opportunity-ai.test.mjs`
- Modify: `src/lib/market-opportunity-worker.ts`
- Modify: `src/lib/market-opportunity-worker.test.mjs`

**Interfaces:**
- Consumes: persisted selection/fingerprint and AI policy from Task 3, `getAlphaSummaryProviderCandidates()`, and `runWithAiProviderFallback()`.
- Produces: `explainMarketOpportunities()` and adds a non-blocking AI phase after deterministic persistence.

- [ ] **Step 1: Write failing AI policy and parsing tests**

```js
const generated = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "fp-2",
  policy: { allowed: true, reason: "allowed" },
  providers: [miniMax, deepSeek],
  fetchImpl: miniMaxQuotaThenDeepSeekJson,
});
assert.equal(generated.provider, "deepseek");
assert.equal(generated.items.length, topFive.length);
assert.deepEqual(
  generated.items.map((item) => item.symbol),
  topFive.map((item) => item.symbol),
);

const malformed = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "fp-3",
  policy: { allowed: true, reason: "allowed" },
  providers: [miniMax],
  fetchImpl: malformedResponse,
});
assert.equal(malformed.status, "failed");
assert.match(malformed.error, /invalid/i);
```

Assert a single HTTP request contains all candidates, unchanged/cooldown/hourly-cap policies make zero requests, concurrent calls for one fingerprint share one promise, and output mentioning leverage/order size is rejected.

- [ ] **Step 2: Run AI tests and confirm RED**

Run: `node src/lib/market-opportunity-ai.test.mjs`

Expected: FAIL because the AI module does not exist.

- [ ] **Step 3: Implement strict batched explanations**

```ts
export type MarketOpportunityAiItem = {
  symbol: string;
  summary: string;
  rationale: string;
  confirmation: string;
  invalidation: string;
  risk: string;
  validFor: string;
};

export async function explainMarketOpportunities(input: {
  decisions: MarketOpportunityDecision[];
  fingerprint: string;
  policy: OpportunityAiPolicy;
  providers?: AiProviderConfig[];
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<MarketOpportunityAiResult>;
```

Send only structured rule outputs, use temperature `0.1`, require one item per input symbol, and reject changed direction/stage, missing symbols, leverage, position sizing, or order-placement language. Use the existing provider candidate order and fallback helper. Keep a module-level `Map<string, Promise<...>>` for single flight.

- [ ] **Step 4: Persist AI outcome after the rule result is already visible**

Call the AI phase only after `saveOpportunitySelection()`. Record an attempted AI run before the provider call, then save success/provider/time or `AI 解释暂不可用` error. Catch every AI error so `runMarketOpportunityScan()` still resolves successfully.

- [ ] **Step 5: Run AI and orchestration tests**

Run: `node src/lib/market-opportunity-ai.test.mjs`

Run: `node src/lib/market-opportunity-worker.test.mjs`

Expected: PASS; provider failure does not erase or delay deterministic Top 5 persistence.

- [ ] **Step 6: Commit AI explanation**

```bash
git add src/lib/market-opportunity-ai.ts src/lib/market-opportunity-ai.test.mjs src/lib/market-opportunity-worker.ts src/lib/market-opportunity-worker.test.mjs
git commit -m "feat: explain market opportunities with cached ai"
```

### Task 7: Worker Process And Service Lifecycle

**Files:**
- Create: `scripts/market-opportunity-worker.mjs`
- Modify: `package.json`
- Modify: `scripts/market-alerts-workers.test.mjs`
- Modify: `scripts/deploy-vps.sh`
- Modify: `scripts/deploy-vps.test.mjs`
- Modify: `scripts/start-signal-hub.ps1`
- Modify: `scripts/start-signal-hub.test.mjs`
- Modify: `src/lib/signal-hub-services.ts`
- Modify: `src/lib/signal-hub-services.test.mjs`

**Interfaces:**
- Consumes: `runMarketOpportunityScan()` from Tasks 5-6 and shared worker runtime helpers.
- Produces: `market:opportunity`, `market:opportunity:once`, `signal-hub-market-opportunity.service`, and health-service registration.

- [ ] **Step 1: Extend worker/service contract tests and confirm RED**

```js
assert.match(opportunity, /runMarketOpportunityScan/);
assert.match(opportunity, /--once/);
assert.match(deploy, /signal-hub-market-opportunity/);
assert.match(localStart, /signal-hub-market-opportunity/);
assert.ok(names.includes("signal-hub-market-opportunity"));
assert.equal(
  getSignalHubSystemdServiceLabel("signal-hub-market-opportunity"),
  "做单决策",
);
```

Replace the obsolete assertions that explicitly prohibit opportunity workers in `deploy-vps.test.mjs` and `signal-hub-services.test.mjs`.

- [ ] **Step 2: Run lifecycle tests and confirm RED**

Run: `node scripts/market-alerts-workers.test.mjs`

Run: `node scripts/deploy-vps.test.mjs`

Run: `node scripts/start-signal-hub.test.mjs`

Run: `node src/lib/signal-hub-services.test.mjs`

Expected: FAIL until the new process is registered.

- [ ] **Step 3: Add the independent one-minute worker**

```js
await loadWorkerEnv();
const controller = new AbortController();
installWorkerShutdown(controller, "market.opportunity");
const once = process.argv.includes("--once");

do {
  const cycleStartedAt = Date.now();
  try {
    await runMarketOpportunityScan();
  } catch (error) {
    logWorker("market.opportunity.error", { error: safeWorkerError(error) });
  }
  if (!once && !controller.signal.aborted) {
    await waitFor(nextWorkerDelay(60_000, cycleStartedAt), controller.signal);
  }
} while (!once && !controller.signal.aborted);
```

Follow existing worker logging and shutdown patterns. The worker exits when `MARKET_ALERTS_ENABLED=false`, and `--once` returns non-zero on scan failure.

- [ ] **Step 4: Wire local and VPS lifecycle**

Add package scripts, stop the process in the default local no-worker branch, start it only under `-WithWorkers`, install a direct-Node systemd unit through `install_market_worker_service`, register it in system health, and include it in the deployment restart list.

- [ ] **Step 5: Run lifecycle tests**

Run the four commands from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit worker lifecycle**

```bash
git add package.json scripts/market-opportunity-worker.mjs scripts/market-alerts-workers.test.mjs scripts/deploy-vps.sh scripts/deploy-vps.test.mjs scripts/start-signal-hub.ps1 scripts/start-signal-hub.test.mjs src/lib/signal-hub-services.ts src/lib/signal-hub-services.test.mjs
git commit -m "feat: run market opportunity worker"
```

### Task 8: Additive API Contract And Top Five UI

**Files:**
- Modify: `src/app/api/market-alerts/route.test.mjs`
- Modify: `src/app/api/market-alerts/stream/route.test.mjs`
- Create: `src/components/market-opportunity-panel.tsx`
- Create: `src/components/market-opportunity-panel.test.mjs`
- Modify: `src/components/market-alerts-panel.tsx`
- Create: `src/components/market-alerts-panel.test.mjs`

**Interfaces:**
- Consumes: `snapshot.opportunities`, `snapshot.opportunityMeta`, and `snapshot.health.opportunity` from Task 3.
- Produces: a stable desktop selection and mobile horizontal-swipe Top 5 panel above `Ranking`.

- [ ] **Step 1: Add failing API and component contract tests**

```js
assert.match(routeSource, /getMarketAlertsSnapshot/);
assert.match(streamSource, /market-alerts-snapshot/);
assert.match(panelSource, /做单决策/);
assert.match(panelSource, /snap-x snap-mandatory/);
assert.match(panelSource, /AI 解释暂不可用/);
assert.match(alertsPanelSource, /<MarketOpportunityPanel/);
assert.ok(
  alertsPanelSource.indexOf("<MarketOpportunityPanel") <
  alertsPanelSource.indexOf("<Ranking"),
);
```

Render with React test renderer and assert empty, one-candidate, fewer-than-five, stale-worker, and AI-failed states. Simulate an SSE snapshot that reorders candidates and assert `selectedSymbol` remains unchanged while that symbol still exists.

- [ ] **Step 2: Run component/API tests and confirm RED**

Run: `node src/components/market-opportunity-panel.test.mjs`

Run: `node src/components/market-alerts-panel.test.mjs`

Run: `node src/app/api/market-alerts/route.test.mjs`

Run: `node src/app/api/market-alerts/stream/route.test.mjs`

Expected: component tests fail until the panel is added; existing API/SSE tests continue to pass because routes remain additive.

- [ ] **Step 3: Build the desktop decision workspace**

Add a compact left list for up to five candidates and a right detail surface for the selected symbol. Show rank, symbol, classification, decision, score/confidence, two leading metrics, deterministic evidence, confirmation, invalidation, risk, freshness, expiry, and cached AI explanation. Keep fixed minimum heights for empty/loading/stale/AI-failed states.

- [ ] **Step 4: Build the mobile swipe layout**

Use `overflow-x-auto`, `snap-x`, `snap-mandatory`, and `min-w-full` so one full candidate is shown at a time. Put decision, confirmation, and invalidation above secondary metrics and show `current / total`; no wide table and no clipped text. Update the indicator with an `IntersectionObserver` or bounded scroll-position handler.

- [ ] **Step 5: Preserve selection across SSE updates**

```ts
useEffect(() => {
  if (selectedSymbol && snapshot.opportunities.some(
    (item) => item.symbol === selectedSymbol,
  )) return;
  setSelectedSymbol(snapshot.opportunities[0]?.symbol ?? null);
}, [selectedSymbol, snapshot.opportunities]);
```

Render one stale warning in the panel header when the opportunity heartbeat or enrichment is stale. Do not repeat that warning in every card.

- [ ] **Step 6: Run component/API tests**

Run the four commands from Step 2.

Expected: PASS.

- [ ] **Step 7: Commit API/UI**

```bash
git add src/app/api/market-alerts/route.test.mjs src/app/api/market-alerts/stream/route.test.mjs src/components/market-opportunity-panel.tsx src/components/market-opportunity-panel.test.mjs src/components/market-alerts-panel.tsx src/components/market-alerts-panel.test.mjs
git commit -m "feat: show top five market decisions"
```

### Task 9: Full Verification, Browser Review, Push, And VPS Deployment

**Files:**
- Modify only files required by verified defects found during this task.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a verified GitHub commit and matching VPS deployment.

- [ ] **Step 1: Run focused opportunity checks**

Run:

```powershell
$node = 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node src/lib/market-opportunity-core.test.mjs
& $node src/lib/market-opportunity-selection.test.mjs
& $node src/lib/market-opportunity-enrichment.test.mjs
& $node src/lib/market-opportunity-worker.test.mjs
& $node src/lib/market-opportunity-ai.test.mjs
& $node src/lib/market-alerts-store.test.mjs
& $node src/components/market-opportunity-panel.test.mjs
& $node scripts/market-alerts-workers.test.mjs
```

Expected: every command prints its `ok - ...` marker and exits zero.

- [ ] **Step 2: Run repository-wide verification**

Run:

```powershell
$env:Path = 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
& 'C:\Users\vicar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/run-tests.mjs
& '.\node_modules\.bin\eslint.cmd' .
& '.\node_modules\.bin\next.cmd' build
```

Expected: all tests pass, ESLint exits zero, and Next reports a successful production build.

- [ ] **Step 3: Run the local app and verify desktop/mobile behavior**

Open `/alerts` at desktop `1440x900` and mobile `390x844`. Confirm Top 5 appears directly below the toolbar, desktop list/detail do not overlap, mobile cards snap one-at-a-time, current/total updates, fewer-than-five and empty states do not shift the page, and existing ranking/alerts/charts/health remain accessible. Confirm no browser console error and that a synthetic SSE reorder preserves the selected symbol.

- [ ] **Step 4: Review the final diff and commit verified corrections**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intentional project files plus the unrelated untracked `monitor-codex-handoff/` are present.

If browser or verification corrections were required, commit only those corrected files:

```bash
git add src/lib/market-opportunity-config.ts src/lib/market-opportunity-core.ts src/lib/market-opportunity-selection.ts src/lib/market-opportunity-enrichment.ts src/lib/market-opportunity-worker.ts src/lib/market-opportunity-ai.ts src/lib/market-alerts-binance.ts src/lib/market-alerts-store.ts src/components/market-opportunity-panel.tsx src/components/market-alerts-panel.tsx scripts/market-opportunity-worker.mjs scripts/deploy-vps.sh scripts/start-signal-hub.ps1 package.json
git commit -m "fix: polish market opportunity decisions"
```

- [ ] **Step 5: Push GitHub**

Run: `git push origin main`

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 6: Deploy to VPS and verify runtime**

Run:

```powershell
ssh -i 'C:\Users\vicar\.ssh\signal_hub_vps_desktop_ed25519' -p 22022 -o BatchMode=yes ubuntu@43.128.146.48 'cd /home/ubuntu/signal-hub && bash scripts/deploy-vps.sh'
ssh -i 'C:\Users\vicar\.ssh\signal_hub_vps_desktop_ed25519' -p 22022 -o BatchMode=yes ubuntu@43.128.146.48 'systemctl is-active signal-hub-web signal-hub-market-volatility-rest signal-hub-market-volatility-ws signal-hub-market-squeeze signal-hub-market-opportunity'
ssh -i 'C:\Users\vicar\.ssh\signal_hub_vps_desktop_ed25519' -p 22022 -o BatchMode=yes ubuntu@43.128.146.48 'curl -fsS http://127.0.0.1:3000/api/market-alerts?limit=5 | /usr/bin/node -e '\''let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log({count:j.opportunities?.length,meta:Boolean(j.opportunityMeta),health:Boolean(j.health?.opportunity)})})'\'''
```

Expected: every service prints `active`; the API check prints a candidate count no greater than five with both metadata and health set to `true`. If the opportunity worker has not completed its first scan, run `npm run market:opportunity:once` in `/home/ubuntu/signal-hub`, then repeat the API check.

- [ ] **Step 7: Verify production UI**

Open `https://holdrich.online/alerts` on desktop and mobile widths. Confirm the deployed revision matches GitHub, SSE reaches `live`, Top 5 contains no more than five unique symbols, stale/AI failure states degrade visibly, and existing alert cards/K-line modal still work.
