# Signal Hub Opportunity Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-noise `机会` view inside Signal Flow that turns existing cached information into 5-10 evidence-backed opportunities per day.

**Architecture:** A new hourly worker reads existing Telegram, X, Stocks catalyst, Patreon, Douyin, Holding, and market caches without contacting those upstream providers again. Pure rules normalize and cluster candidate events, SQLite persists evidence and state, and a batched Minimax-first/DeepSeek-fallback evaluator applies a bounded adjustment before the API and UI expose qualifying opportunities.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, TypeScript, Node.js `node:sqlite`, native Node contract tests, existing OpenAI-compatible AI provider fallback, pnpm 11, systemd on Ubuntu 24.04.

## Global Constraints

- Do not change Signal Flow collection, feed ordering, reading-position, or existing feed-tab behavior.
- Do not add a paid API, a new upstream request, or a new runtime dependency.
- Run opportunity processing once per hour; manual UI refresh must never force AI generation.
- Use existing cached Telegram, X, Stocks catalyst/Patreon, Douyin, Holding, and market data only.
- Require `finalScore >= 75`; keep no more than 10 qualifying opportunities per Asia/Shanghai calendar day.
- Do not impose fixed market quotas across US equities, A-shares, and crypto.
- Minimax is first choice and DeepSeek is fallback; rule-only results remain usable when both fail.
- Every AI conclusion must cite evidence IDs supplied in the request.
- Keep the UI disabled during a one-to-two-day shadow run through `OPPORTUNITY_RADAR_UI_ENABLED=0`.
- Do not log API keys, cookies, passwords, full private Patreon text, or unredacted AI request bodies.

---

## File Map

**New domain and persistence files**

- `src/lib/opportunity-types.ts`: public domain types and enums.
- `src/lib/opportunity-rules.ts`: pure normalization, clustering, scoring, lifecycle, and daily selection.
- `src/lib/opportunity-store.ts`: SQLite schema, transactions, queries, preferences, evaluations, and worker state.
- `src/lib/opportunity-sources.ts`: adapters over existing local snapshots and priority assets.
- `src/lib/opportunity-ai.ts`: provider ordering, batched prompt, OpenAI-compatible request, structured validation, and fallback.
- `src/lib/opportunity-worker.ts`: one complete hourly processing cycle.
- `scripts/opportunity-worker.mjs`: long-running systemd entry point and `--once` mode.

**New API and UI files**

- `src/app/api/opportunities/route.ts`: list endpoint.
- `src/app/api/opportunities/refresh/route.ts`: cache-only refresh endpoint.
- `src/app/api/opportunities/[id]/follow/route.ts`: follow mutation.
- `src/app/api/opportunities/[id]/dismiss/route.ts`: dismiss mutation.
- `src/components/opportunity-radar.tsx`: filters, compact cards, expansion, follow, dismiss, and evidence links.

**Existing integration files**

- `src/app/page.tsx`: pass the server-side feature flag.
- `src/components/signals-responsive-layout.tsx`: add the desktop primary view and third mobile panel.
- `src/lib/system-health.ts`: summarize worker/database health.
- `src/lib/signal-hub-services.ts`: register the ninth systemd service.
- `src/app/api/system-health/route.ts`: automatically checks the expanded registry.
- `scripts/deploy-vps.sh`: install, enable, and restart the worker.
- `package.json`: add worker and one-shot scripts.

---

### Task 1: Domain Types, Clustering, And Deterministic Scoring

**Files:**
- Create: `src/lib/opportunity-types.ts`
- Create: `src/lib/opportunity-rules.ts`
- Test: `src/lib/opportunity-rules.test.mjs`

**Interfaces:**
- Consumes: normalized source text, timestamps, asset keys, priority asset keys, and market-reaction facts.
- Produces: `OpportunitySourceItem`, `OpportunityCandidate`, `OpportunityScore`, `clusterOpportunityItems()`, `scoreOpportunityCandidate()`, `selectDailyOpportunities()`, `deriveOpportunityStatus()`, and `formatOpportunityDateKey()`.

- [ ] **Step 1: Write the failing pure-rule tests**

```js
import assert from "node:assert/strict";
import {
  clusterOpportunityItems,
  deriveOpportunityStatus,
  scoreOpportunityCandidate,
  selectDailyOpportunities,
} from "./opportunity-rules.ts";

const base = {
  market: "us",
  assetKeys: ["NVDA"],
  eventType: "order",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "NVDA supplier confirms a new AI accelerator order for Q3 delivery",
  translation: null,
  originalUrl: "https://example.com/a",
};

const clustered = clusterOpportunityItems([
  { ...base, id: "x:1", sourceType: "x", sourceName: "analyst-a" },
  { ...base, id: "telegram:2", sourceType: "telegram", sourceName: "channel-b" },
]);
assert.equal(clustered.length, 1);
assert.equal(clustered[0].evidence.length, 2);

const score = scoreOpportunityCandidate(clustered[0], {
  priorityAssetKeys: new Set(["NVDA"]),
  marketReaction: { available: true, absoluteMovePercent: 1.2 },
  now: new Date("2026-07-12T02:00:00.000Z"),
});
assert.ok(score.ruleScore >= 75);

const selected = selectDailyOpportunities(
  Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    finalScore: 100 - index,
    dismissed: false,
  })),
  10,
);
assert.equal(selected.length, 10);
assert.equal(deriveOpportunityStatus({ validUntil: "2026-07-11T00:00:00.000Z" }, new Date("2026-07-12T00:00:00.000Z")), "expired");
assert.equal(deriveOpportunityStatus({ independentSourceCount: 2, finalScore: 82, confidence: "medium" }), "tracking");
assert.equal(deriveOpportunityStatus({ independentSourceCount: 3, finalScore: 88, confidence: "high" }), "confirmed");
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-rules.test.mjs`

Expected: FAIL because `opportunity-rules.ts` does not exist.

- [ ] **Step 3: Define the domain types**

```ts
export const OPPORTUNITY_MARKETS = ["us", "cn", "crypto"] as const;
export type OpportunityMarket = (typeof OPPORTUNITY_MARKETS)[number];
export type OpportunityEventType =
  | "earnings"
  | "order"
  | "policy"
  | "product"
  | "capital"
  | "supply-chain"
  | "other";
export type OpportunityStatus = "new" | "tracking" | "confirmed" | "expired";
export type OpportunitySourceType = "telegram" | "x" | "patreon" | "douyin" | "news";

export type OpportunitySourceItem = {
  id: string;
  sourceType: OpportunitySourceType;
  sourceName: string;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  publishedAt: string;
  text: string;
  translation: string | null;
  originalUrl: string;
};

export type OpportunityCandidate = {
  canonicalKey: string;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: OpportunitySourceItem[];
};

export type OpportunityScore = {
  ruleScore: number;
  components: Record<string, number>;
  penalties: string[];
};

export type OpportunityMarketFilter = OpportunityMarket | "all";
export type OpportunitySort = "score" | "latest";
export type OpportunityListStatus = "active" | "history";
export type OpportunityEvidenceView = {
  id: string;
  sourceType: OpportunitySourceType;
  sourceName: string;
  publishedAt: string;
  textExcerpt: string;
  originalUrl: string;
};
export type OpportunityCard = {
  id: number;
  market: OpportunityMarket;
  assetKeys: string[];
  eventType: OpportunityEventType;
  status: OpportunityStatus;
  finalScore: number;
  confidence: string;
  thesis: string;
  reasons: string[];
  risks: string[];
  invalidation: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  validUntil: string | null;
  selectedAt: string;
  followed: boolean;
  dismissed: boolean;
  aiPending: boolean;
  marketReaction: { available: boolean; absoluteMovePercent: number | null };
  evidence: OpportunityEvidenceView[];
};
export type OpportunitySnapshot = {
  generatedAt: string;
  lastWorkerSuccessAt: string | null;
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  items: OpportunityCard[];
  error: string | null;
};
```

- [ ] **Step 4: Implement deterministic clustering and scoring**

```ts
import { createHash } from "node:crypto";
import type { OpportunityCandidate, OpportunityScore, OpportunitySourceItem } from "./opportunity-types.ts";

function normalizeOpportunityText(text: string) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}$]+/gu, " ").trim();
}

function opportunityTokens(text: string) {
  return new Set(normalizeOpportunityText(text).split(/\s+/).filter((token) => token.length >= 2));
}

export function textJaccardSimilarity(left: string, right: string) {
  const a = opportunityTokens(left);
  const b = opportunityTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

export function clusterOpportunityItems(items: OpportunitySourceItem[]) {
  const clusters: OpportunityCandidate[] = [];
  for (const item of [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))) {
    const assets = [...new Set(item.assetKeys.map((value) => value.toUpperCase()))].sort();
    const current = clusters.find((candidate) =>
      candidate.market === item.market &&
      candidate.eventType === item.eventType &&
      candidate.assetKeys.join(",") === assets.join(",") &&
      Math.abs(Date.parse(item.publishedAt) - Date.parse(candidate.lastSeenAt)) <= 6 * 60 * 60 * 1000 &&
      candidate.evidence.some((entry) => textJaccardSimilarity(entry.translation || entry.text, item.translation || item.text) >= 0.45),
    );
    if (!current) {
      const fingerprint = createHash("sha256").update(normalizeOpportunityText(item.translation || item.text)).digest("hex").slice(0, 12);
      clusters.push({
        canonicalKey: `${item.market}:${item.eventType}:${assets.join(",")}:${item.publishedAt.slice(0, 10)}:${fingerprint}`,
        market: item.market,
        assetKeys: assets,
        eventType: item.eventType,
        firstSeenAt: item.publishedAt,
        lastSeenAt: item.publishedAt,
        evidence: [item],
      });
      continue;
    }
    if (!current.evidence.some((entry) => entry.id === item.id)) current.evidence.push(item);
    if (item.publishedAt < current.firstSeenAt) current.firstSeenAt = item.publishedAt;
    if (item.publishedAt > current.lastSeenAt) current.lastSeenAt = item.publishedAt;
  }
  return clusters;
}

export function scoreOpportunityCandidate(candidate, context): OpportunityScore {
  const independentSources = new Set(candidate.evidence.map((item) => `${item.sourceType}:${item.sourceName}`)).size;
  const sourceQuality = Math.min(20, independentSources * 10);
  const specificity = candidate.assetKeys.length > 0 ? 15 : 0;
  const catalyst = candidate.eventType === "other" ? 6 : 20;
  const corroboration = Math.min(15, Math.max(0, independentSources - 1) * 8);
  const ageMs = context.now.getTime() - Date.parse(candidate.lastSeenAt);
  const freshness = ageMs <= 6 * 60 * 60 * 1000 ? 10 : ageMs <= 24 * 60 * 60 * 1000 ? 6 : 0;
  const priority = candidate.assetKeys.some((key) => context.priorityAssetKeys.has(key)) ? 10 : 0;
  const reaction = !context.marketReaction.available
    ? 5
    : context.marketReaction.absoluteMovePercent <= 3
      ? 10
      : context.marketReaction.absoluteMovePercent <= 7
        ? 4
        : 0;
  const components = { sourceQuality, specificity, catalyst, corroboration, freshness, priority, reaction };
  return { ruleScore: Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)), components, penalties: [] };
}

export function selectDailyOpportunities<T extends { finalScore: number; dismissed: boolean }>(items: T[], limit = 10) {
  return items
    .filter((item) => !item.dismissed && item.finalScore >= 75)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, Math.min(10, Math.max(0, limit)));
}

export function deriveOpportunityStatus(
  value: { validUntil?: string | null; invalidatedAt?: string | null; independentSourceCount?: number; finalScore?: number; confidence?: string },
  now = new Date(),
): OpportunityStatus {
  if (value.invalidatedAt || (value.validUntil && Date.parse(value.validUntil) <= now.getTime())) return "expired";
  if ((value.independentSourceCount ?? 0) >= 3 && (value.finalScore ?? 0) >= 85 && value.confidence === "high") return "confirmed";
  return (value.independentSourceCount ?? 0) >= 2 ? "tracking" : "new";
}

export function formatOpportunityDateKey(date: Date, timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
```

- [ ] **Step 5: Run the focused test**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-rules.test.mjs`

Expected: PASS with clustering, threshold, daily-cap, and expiry assertions.

- [ ] **Step 6: Commit the domain layer**

```bash
git add src/lib/opportunity-types.ts src/lib/opportunity-rules.ts src/lib/opportunity-rules.test.mjs
git commit -m "feat: add opportunity scoring rules"
```

---

### Task 2: SQLite Persistence And Idempotency

**Files:**
- Create: `src/lib/opportunity-store.ts`
- Test: `src/lib/opportunity-store.test.mjs`

**Interfaces:**
- Consumes: Task 1 candidates, scores, evidence, evaluations, and preferences.
- Produces: `openOpportunityDb()`, `initOpportunityDb()`, `upsertOpportunityCluster()`, `upsertOpportunityEvidence()`, `updateOpportunityAnalysis()`, `saveOpportunityEvaluation()`, `getOpportunityEvaluationByInputHash()`, `listOpportunities()`, `setOpportunityPreference()`, `selectUnselectedDailyOpportunities()`, `getOpportunityWorkerState()`, and `setOpportunityWorkerState()`.

- [ ] **Step 1: Write failing in-memory SQLite tests**

```js
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  getOpportunityEvaluationByInputHash,
  initOpportunityDb,
  listOpportunities,
  saveOpportunityEvaluation,
  setOpportunityPreference,
  upsertOpportunityCluster,
  upsertOpportunityEvidence,
} from "./opportunity-store.ts";

const db = new DatabaseSync(":memory:");
initOpportunityDb(db);
const clusterId = upsertOpportunityCluster(db, {
  canonicalKey: "us:order:NVDA:2026-07-12T01",
  market: "us",
  eventType: "order",
  assetKeys: ["NVDA"],
  firstSeenAt: "2026-07-12T01:00:00.000Z",
  lastSeenAt: "2026-07-12T01:10:00.000Z",
  ruleScore: 82,
});
upsertOpportunityEvidence(db, clusterId, {
  id: "x:1",
  sourceType: "x",
  sourceName: "analyst-a",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "order confirmed",
  translation: null,
  originalUrl: "https://example.com/a",
  assetKeys: ["NVDA"],
});
upsertOpportunityEvidence(db, clusterId, {
  id: "x:1",
  sourceType: "x",
  sourceName: "analyst-a",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "order confirmed",
  translation: null,
  originalUrl: "https://example.com/a",
  assetKeys: ["NVDA"],
});
saveOpportunityEvaluation(db, { clusterId, inputHash: "hash-1", provider: "minimax", model: "m", status: "generated", result: { aiAdjustment: 3 } });
assert.ok(getOpportunityEvaluationByInputHash(db, clusterId, "hash-1"));
setOpportunityPreference(db, clusterId, { followed: true, dismissed: false });
const rows = listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 10 });
assert.equal(rows.length, 1);
assert.equal(rows[0].evidence.length, 1);
assert.equal(rows[0].followed, true);
db.close();
```

- [ ] **Step 2: Run the store test and confirm failure**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-store.test.mjs`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Add the database path and complete schema**

```ts
export function getOpportunityDbPath(env: EnvLike = process.env) {
  return env.OPPORTUNITY_DB?.trim() || getRuntimeDataPath(env, "opportunities.sqlite");
}

export function initOpportunityDb(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS opportunity_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT NOT NULL UNIQUE,
      market TEXT NOT NULL,
      event_type TEXT NOT NULL,
      asset_keys_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      rule_score INTEGER NOT NULL DEFAULT 0,
      ai_adjustment INTEGER NOT NULL DEFAULT 0,
      final_score INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'rule-only',
      thesis TEXT NOT NULL DEFAULT '',
      reasons_json TEXT NOT NULL DEFAULT '[]',
      risks_json TEXT NOT NULL DEFAULT '[]',
      invalidation_json TEXT NOT NULL DEFAULT '[]',
      market_reaction_json TEXT NOT NULL DEFAULT '{"available":false,"absoluteMovePercent":null}',
      valid_until TEXT,
      invalidated_at TEXT,
      selected_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      published_at TEXT NOT NULL,
      text_excerpt TEXT NOT NULL,
      original_url TEXT NOT NULL,
      asset_keys_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(cluster_id, source_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS opportunity_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(cluster_id, input_hash)
    );
    CREATE TABLE IF NOT EXISTS opportunity_preferences (
      cluster_id INTEGER PRIMARY KEY,
      followed INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_worker_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opportunity_clusters_score ON opportunity_clusters(final_score DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opportunity_clusters_selected ON opportunity_clusters(selected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opportunity_evidence_cluster ON opportunity_evidence(cluster_id, published_at DESC);
  `);
}
```

- [ ] **Step 4: Implement transactional upserts and bounded list queries**

Use parameterized statements only. Serialize arrays with `JSON.stringify`, hash evidence with SHA-256, clamp `limit` to `1..100`, and join preferences without allowing a dismissed row into the default active result. `upsertOpportunityEvidence()` must use `ON CONFLICT(cluster_id, source_type, source_id) DO UPDATE` so edited source text updates evidence without creating a duplicate.

```ts
export function setOpportunityPreference(db, clusterId, preference) {
  db.prepare(`
    INSERT INTO opportunity_preferences(cluster_id, followed, dismissed, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cluster_id) DO UPDATE SET
      followed = excluded.followed,
      dismissed = excluded.dismissed,
      updated_at = excluded.updated_at
  `).run(clusterId, preference.followed ? 1 : 0, preference.dismissed ? 1 : 0, new Date().toISOString());
}

export function updateOpportunityAnalysis(db, clusterId, analysis, updatedAt) {
  db.prepare(`
    UPDATE opportunity_clusters SET
      ai_adjustment = ?, final_score = ?, confidence = ?, thesis = ?,
      reasons_json = ?, risks_json = ?, invalidation_json = ?, valid_until = ?,
      status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    analysis.aiAdjustment,
    Math.max(0, Math.min(100, analysis.finalScore)),
    analysis.confidence,
    analysis.thesis,
    JSON.stringify(analysis.reasons),
    JSON.stringify(analysis.risks),
    JSON.stringify(analysis.invalidation),
    analysis.validUntil,
    analysis.status,
    updatedAt,
    clusterId,
  );
}

export function selectUnselectedDailyOpportunities(db, { dateKey, threshold, limit, selectedAt }) {
  const selectedToday = Number(db.prepare(`
    SELECT count(*) AS count FROM opportunity_clusters
    WHERE selected_at IS NOT NULL AND substr(datetime(selected_at, '+8 hours'), 1, 10) = ?
  `).get(dateKey)?.count ?? 0);
  const remaining = Math.max(0, Math.min(10, limit) - selectedToday);
  if (remaining === 0) return [];
  const rows = db.prepare(`
    SELECT id FROM opportunity_clusters
    WHERE selected_at IS NULL AND final_score >= ? AND status != 'expired'
    ORDER BY final_score DESC, updated_at DESC
    LIMIT ?
  `).all(threshold, remaining);
  const update = db.prepare("UPDATE opportunity_clusters SET selected_at = ?, updated_at = ? WHERE id = ?");
  for (const row of rows) update.run(selectedAt, selectedAt, row.id);
  return rows.map((row) => Number(row.id));
}
```

`listOpportunities()` includes only rows with non-null `selected_at`. The active view excludes expired and dismissed rows; history includes expired rows and can include dismissed rows only when explicitly requested by store options.

- [ ] **Step 5: Run store tests and inspect the schema**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-store.test.mjs`

Expected: PASS; duplicate evidence remains one row and evaluation hashes remain idempotent.

- [ ] **Step 6: Commit persistence**

```bash
git add src/lib/opportunity-store.ts src/lib/opportunity-store.test.mjs
git commit -m "feat: persist opportunity radar state"
```

---

### Task 3: Existing-Cache Source Adapters

**Files:**
- Create: `src/lib/opportunity-sources.ts`
- Test: `src/lib/opportunity-sources.test.mjs`
- Modify: `src/lib/binance-holdings-cache.ts`
- Modify: `src/lib/binance-holdings-cache.test.mjs`

**Interfaces:**
- Consumes: `getTelegramPipelineSnapshot()`, `getXPipelineSnapshot()`, `readStocksSnapshotCache()`, `getDouyinSnapshot()`, `readPersistedTigerHoldingData()`, `readPersistedBinanceHoldingSnapshot()`, and `ALPHA_RESEARCH_STOCK_UNIVERSE`.
- Produces: `normalizeTelegramOpportunityItems()`, `normalizeXOpportunityItems()`, `normalizeCatalystOpportunityItems()`, `normalizeDouyinOpportunityItems()`, `loadOpportunitySourceItems()`, `loadOpportunityPriorityAssetKeys()`, and `loadOpportunityMarketReaction()`.

- [ ] **Step 1: Write fixture-based adapter tests**

```js
import assert from "node:assert/strict";
import {
  normalizeCatalystOpportunityItems,
  normalizeDouyinOpportunityItems,
  normalizeTelegramOpportunityItems,
  normalizeXOpportunityItems,
} from "./opportunity-sources.ts";

const xItems = normalizeXOpportunityItems({ feed: [{ id: "1", text: "$NVDA wins new AI order", createdAt: "2026-07-12T01:00:00.000Z", username: "a", tweetUrl: "https://x.com/a/1", translation: null }] });
assert.equal(xItems.length, 1);
assert.equal(xItems[0].id, "x:1");
assert.deepEqual(xItems[0].assetKeys, ["NVDA"]);
assert.equal(xItems[0].eventType, "order");
assert.equal(normalizeTelegramOpportunityItems({ feed: [] }).length, 0);
assert.equal(normalizeCatalystOpportunityItems({ catalysts: {} }).length, 0);
assert.equal(normalizeDouyinOpportunityItems({ videos: [] }).length, 0);
```

- [ ] **Step 2: Run and confirm the adapters are missing**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-sources.test.mjs`

Expected: FAIL because `opportunity-sources.ts` does not exist.

- [ ] **Step 3: Implement pure normalizers before I/O**

```ts
const TICKER_PATTERN = /\$([A-Z][A-Z0-9.]{0,9})\b/g;
const ORDER_TERMS = /order|contract|订单|中标|采购/i;
const EARNINGS_TERMS = /earnings|revenue|eps|guidance|财报|业绩|指引/i;
const POLICY_TERMS = /policy|regulation|tariff|ban|政策|监管|关税|禁令/i;

export function inferOpportunityEventType(text: string): OpportunityEventType {
  if (ORDER_TERMS.test(text)) return "order";
  if (EARNINGS_TERMS.test(text)) return "earnings";
  if (POLICY_TERMS.test(text)) return "policy";
  return "other";
}

export function extractOpportunityAssetKeys(text: string) {
  return [...new Set([...text.matchAll(TICKER_PATTERN)].map((match) => match[1].toUpperCase()))];
}
```

Preserve full source text only in memory. Store a bounded `text_excerpt` of at most 2,000 characters. For Patreon, use the already-generated Stocks catalyst summary/translation and original link; do not copy private full post bodies into logs.

- [ ] **Step 4: Add cache-only loaders and priority assets**

```ts
export async function loadOpportunitySourceItems({ env = process.env } = {}) {
  const telegram = getTelegramPipelineSnapshot(1000);
  const x = getXPipelineSnapshot(1000);
  const catalysts = await readStocksSnapshotCache<StocksCatalystSnapshot>({ kind: "catalysts", env, allowStale: true });
  const douyin = await getDouyinSnapshot({ env });
  return dedupeOpportunitySourceItems([
    ...normalizeTelegramOpportunityItems(telegram),
    ...normalizeXOpportunityItems(x),
    ...normalizeCatalystOpportunityItems(catalysts),
    ...normalizeDouyinOpportunityItems(douyin),
  ]);
}
```

Export the existing private `readPersistedBinanceHoldingSnapshot()` from `binance-holdings-cache.ts`; do not call `getCachedBinanceHoldingSnapshot()` because its cache miss path contacts Binance. Protect the export with the existing cache test.

Each normalizer filters to a bounded seven-day window before returning items. Douyin uses `summary.assets`, `summary.recommendationReasons`, and `summary.catalysts` so A-share names and abbreviations already recognized by the video summary remain available as asset keys. `loadOpportunityPriorityAssetKeys()` merges the Stocks research universe, current Tiger equity/option underlyings, persisted Binance futures symbols, and non-stablecoin Binance spot assets. `loadOpportunityMarketReaction()` reads only the existing Stocks market snapshot and persisted Binance snapshot; unsupported A-share assets return `{ available: false, absoluteMovePercent: 0 }`. Failures in one cache return an empty contribution and do not abort the full load.

- [ ] **Step 5: Run adapter tests**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-sources.test.mjs`

Run: `node --experimental-strip-types --experimental-transform-types src/lib/binance-holdings-cache.test.mjs`

Expected: PASS with no network mocks because all tested functions are pure.

- [ ] **Step 6: Commit source adapters**

```bash
git add src/lib/binance-holdings-cache.ts src/lib/binance-holdings-cache.test.mjs src/lib/opportunity-sources.ts src/lib/opportunity-sources.test.mjs
git commit -m "feat: read opportunity candidates from local caches"
```

---

### Task 4: Batched AI Evaluation With Evidence Validation

**Files:**
- Create: `src/lib/opportunity-ai.ts`
- Test: `src/lib/opportunity-ai.test.mjs`
- Modify: `src/lib/ai-provider-fallback.ts`
- Modify: `src/lib/ai-provider-fallback.test.mjs`

**Interfaces:**
- Consumes: Task 1 candidates/scores and `runWithAiProviderFallback()`.
- Produces: `getOpportunityProviderCandidates()`, `buildOpportunityInputHash()`, `buildOpportunityPrompt()`, `parseOpportunityAiBatch()`, `validateOpportunityAiBatch()`, and `evaluateOpportunityBatch()`.

- [ ] **Step 1: Write failing parser, evidence, and fallback tests**

```js
import assert from "node:assert/strict";
import {
  buildOpportunityInputHash,
  parseOpportunityAiBatch,
  validateOpportunityAiBatch,
} from "./opportunity-ai.ts";

const candidates = [{ canonicalKey: "us:order:NVDA:1", evidence: [{ id: "x:1" }] }];
const validBatch = {
  opportunities: [{ canonicalKey: "us:order:NVDA:1", aiAdjustment: 5, thesis: "Q3 order", reasons: ["confirmed order"], risks: ["delivery"], invalidation: ["order cancelled"], validUntil: "2026-08-01T00:00:00.000Z", confidence: "high", evidenceIds: ["x:1"] }],
};
assert.equal(buildOpportunityInputHash(candidates, 1), buildOpportunityInputHash(candidates, 1));
const parsed = parseOpportunityAiBatch(JSON.stringify(validBatch));
assert.equal(validateOpportunityAiBatch(parsed, new Map([["us:order:NVDA:1", new Set(["x:1"])]]))[0].aiAdjustment, 5);
assert.throws(() => validateOpportunityAiBatch(parsed, new Map([["us:order:NVDA:1", new Set(["missing"])]])), /evidence/i);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-ai.test.mjs`

Expected: FAIL because the AI module does not exist.

- [ ] **Step 3: Implement a versioned batch prompt and strict parser**

```ts
export const OPPORTUNITY_PROMPT_VERSION = 1;
export const OPPORTUNITY_SYSTEM_PROMPT = `You classify investment information. Return JSON only.
Use only supplied evidence. Never invent facts, numbers, assets, or sources.
aiAdjustment must be an integer from -15 through 15.
Every conclusion must cite one or more supplied evidenceIds.
Do not raise an unverified single-source candidate above the display threshold.`;

export type OpportunityAiEvaluation = {
  canonicalKey: string;
  aiAdjustment: number;
  thesis: string;
  reasons: string[];
  risks: string[];
  invalidation: string[];
  validUntil: string | null;
  confidence: "low" | "medium" | "high";
  evidenceIds: string[];
};

export type OpportunityAiBatch = { opportunities: OpportunityAiEvaluation[] };

export function buildOpportunityPrompt(candidates: OpportunityCandidate[]) {
  return JSON.stringify({
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    candidates: candidates.map((candidate) => ({
      canonicalKey: candidate.canonicalKey,
      market: candidate.market,
      assetKeys: candidate.assetKeys,
      eventType: candidate.eventType,
      evidence: candidate.evidence.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        text: (item.translation || item.text).slice(0, 2000),
      })),
    })),
    responseShape: {
      opportunities: [{ canonicalKey: "string", aiAdjustment: 0, thesis: "string", reasons: ["string"], risks: ["string"], invalidation: ["string"], validUntil: null, confidence: "low|medium|high", evidenceIds: ["source:id"] }],
    },
  });
}

export function buildOpportunityInputHash(candidates, promptVersion) {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion, candidates }))
    .digest("hex");
}

export function parseOpportunityAiBatch(content: string): OpportunityAiBatch {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as { opportunities?: unknown };
  if (!Array.isArray(parsed.opportunities)) throw new Error("Opportunity AI response has no opportunities array");
  return {
    opportunities: parsed.opportunities.map((raw) => {
      if (!raw || typeof raw !== "object") throw new Error("Invalid opportunity AI item");
      const item = raw as Record<string, unknown>;
      const stringArray = (key: string) => Array.isArray(item[key]) ? item[key].filter((value): value is string => typeof value === "string") : [];
      return {
        canonicalKey: String(item.canonicalKey || ""),
        aiAdjustment: Number(item.aiAdjustment),
        thesis: String(item.thesis || ""),
        reasons: stringArray("reasons").slice(0, 3),
        risks: stringArray("risks"),
        invalidation: stringArray("invalidation"),
        validUntil: typeof item.validUntil === "string" ? item.validUntil : null,
        confidence: item.confidence === "high" || item.confidence === "medium" ? item.confidence : "low",
        evidenceIds: stringArray("evidenceIds"),
      };
    }),
  };
}

export function validateOpportunityAiBatch(result, evidenceByCluster) {
  return result.opportunities.map((item) => {
    if (!Number.isInteger(item.aiAdjustment) || item.aiAdjustment < -15 || item.aiAdjustment > 15) {
      throw new Error(`Invalid AI adjustment for ${item.canonicalKey}`);
    }
    const allowed = evidenceByCluster.get(item.canonicalKey);
    if (!allowed || item.evidenceIds.length === 0 || item.evidenceIds.some((id) => !allowed.has(id))) {
      throw new Error(`Invalid evidence IDs for ${item.canonicalKey}`);
    }
    return item;
  });
}
```

The prompt must instruct the model to return JSON only, never introduce an unseen fact, keep `aiAdjustment` within `-15..15`, cite supplied evidence IDs, and avoid raising an unverified single-source candidate above the display threshold.

- [ ] **Step 4: Implement OpenAI-compatible requests and existing fallback**

```ts
export function getOpportunityProviderCandidates(env: EnvLike = process.env): AiProviderConfig[] {
  const minimaxKey = env.MINIMAX_API_KEY?.trim() || (/minimax/i.test(env.AI_SUMMARY_BASE_URL || "") ? env.AI_SUMMARY_API_KEY?.trim() : "") || "";
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim() || env.AI_SUMMARY_FALLBACK_API_KEY?.trim() || "";
  return [
    minimaxKey ? { id: "minimax", baseUrl: (env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, ""), apiKey: minimaxKey, model: env.MINIMAX_MODEL || "MiniMax-M2.7" } : null,
    deepseekKey ? { id: "deepseek", baseUrl: (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""), apiKey: deepseekKey, model: env.DEEPSEEK_MODEL || "deepseek-chat" } : null,
  ].filter((provider): provider is AiProviderConfig => provider !== null);
}

export async function evaluateOpportunityBatch({ candidates, env = process.env, fetchImpl = fetch }) {
  const providers = getOpportunityProviderCandidates(env);
  if (providers.length === 0) throw new Error("No configured AI provider");
  const evidenceByCluster = new Map(candidates.map((candidate) => [candidate.canonicalKey, new Set(candidate.evidence.map((item) => item.id))]));
  const result = await runWithAiProviderFallback({
    providers,
    cooldownMs: 60 * 60 * 1000,
    request: async (provider) => {
      const response = await fetchImpl(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: provider.model, temperature: 0.1, messages: [{ role: "system", content: OPPORTUNITY_SYSTEM_PROMPT }, { role: "user", content: buildOpportunityPrompt(candidates) }] }),
      });
      if (!response.ok) throw new Error(`Opportunity AI HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const payload = await response.json();
      return validateOpportunityAiBatch(parseOpportunityAiBatch(payload.choices?.[0]?.message?.content ?? ""), evidenceByCluster);
    },
    shouldFallback: (error) => isQuotaExhaustedError(error) || /HTTP (408|429|5\d\d)|timeout|fetch failed/i.test(error instanceof Error ? error.message : String(error)),
  });
  return { evaluations: result.value, provider: result.provider };
}
```

Extend `runWithAiProviderFallback()` with optional `shouldFallback?: (error: unknown) => boolean`. Default it to `isQuotaExhaustedError`, preserving every existing caller. Opportunity evaluation supplies the retriable-error predicate above; validation errors remain terminal and cannot silently switch to another model.

```diff
 export async function runWithAiProviderFallback<T>({
   providers,
   request,
   now = Date.now(),
   cooldownMs = DEFAULT_COOLDOWN_MS,
+  shouldFallback = isQuotaExhaustedError,
 }: {
   providers: AiProviderConfig[];
   request: (provider: AiProviderConfig) => Promise<T>;
   now?: Date | number;
   cooldownMs?: number;
+  shouldFallback?: (error: unknown) => boolean;
 }) {
@@
-      if (!isQuotaExhaustedError(error)) {
+      if (!shouldFallback(error)) {
         throw error;
 }
```

Add this regression to `ai-provider-fallback.test.mjs`:

```js
resetAiProviderCircuitBreakers();
let attempts = 0;
const result = await runWithAiProviderFallback({
  providers,
  shouldFallback: (error) => /HTTP 500/.test(String(error)),
  request: async (candidate) => {
    attempts += 1;
    if (candidate.id === "minimax") throw new Error("HTTP 500");
    return "fallback-ok";
  },
});
assert.equal(result.value, "fallback-ok");
assert.equal(result.provider.id, "deepseek");
assert.equal(attempts, 2);
```

- [ ] **Step 5: Test Minimax failure and DeepSeek fallback with mocked fetch**

```js
resetAiProviderCircuitBreakers();
const urls = [];
const fetchImpl = async (url) => {
  urls.push(String(url));
  if (String(url).includes("minimaxi")) return new Response("quota exceeded", { status: 429 });
  return Response.json({ choices: [{ message: { content: JSON.stringify(validBatch) } }] });
};
const result = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl,
});
assert.equal(result.provider.id, "deepseek");
assert.deepEqual(urls.map((url) => new URL(url).hostname), ["api.minimaxi.com", "api.deepseek.com"]);
```

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-ai.test.mjs`

Expected: PASS for parser, evidence rejection, deterministic hash, and fallback.

- [ ] **Step 6: Commit AI evaluation**

```bash
git add src/lib/ai-provider-fallback.ts src/lib/ai-provider-fallback.test.mjs src/lib/opportunity-ai.ts src/lib/opportunity-ai.test.mjs
git commit -m "feat: evaluate opportunity batches with evidence"
```

---

### Task 5: Hourly Worker Cycle And Recovery

**Files:**
- Create: `src/lib/opportunity-worker.ts`
- Create: `scripts/opportunity-worker.mjs`
- Test: `src/lib/opportunity-worker.test.mjs`
- Test: `scripts/opportunity-worker-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1-4 loaders, rules, store, and evaluator.
- Produces: `runOpportunityCycle()`, `getOpportunityWorkerIntervalMs()`, `opportunity:worker`, and `opportunity:worker:once`.

- [ ] **Step 1: Write failing orchestration tests with injected dependencies**

```js
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initOpportunityDb, listOpportunities } from "./opportunity-store.ts";
import { runOpportunityCycle } from "./opportunity-worker.ts";

const db = new DatabaseSync(":memory:");
initOpportunityDb(db);
let aiCalls = 0;
const fixtures = [
  { id: "x:1", sourceType: "x", sourceName: "analyst-a", market: "us", assetKeys: ["NVDA"], eventType: "order", publishedAt: "2026-07-12T01:00:00.000Z", text: "$NVDA confirms a Q3 AI order", translation: null, originalUrl: "https://example.com/x/1" },
  { id: "telegram:2", sourceType: "telegram", sourceName: "channel-b", market: "us", assetKeys: ["NVDA"], eventType: "order", publishedAt: "2026-07-12T01:10:00.000Z", text: "NVDA confirms the Q3 AI order", translation: null, originalUrl: "https://example.com/tg/2" },
];
await runOpportunityCycle({
  db,
  now: new Date("2026-07-12T02:00:00.000Z"),
  loadItems: async () => fixtures,
  loadPriorityAssets: async () => new Set(["NVDA"]),
  loadMarketReaction: async () => ({ available: true, absoluteMovePercent: 1 }),
  evaluateBatch: async (candidates) => {
    aiCalls += 1;
    return { provider: { id: "minimax", model: "m" }, evaluations: candidates.map((item) => ({ canonicalKey: item.canonicalKey, aiAdjustment: 3, thesis: "order", reasons: ["confirmed"], risks: [], invalidation: ["cancelled"], validUntil: null, confidence: "high", evidenceIds: item.evidence.map((e) => e.id) })) };
  },
});
await runOpportunityCycle({ db, now: new Date("2026-07-12T03:00:00.000Z"), loadItems: async () => fixtures, loadPriorityAssets: async () => new Set(["NVDA"]), loadMarketReaction: async () => ({ available: true, absoluteMovePercent: 1 }), evaluateBatch: async () => { aiCalls += 1; return { evaluations: [] }; } });
assert.equal(aiCalls, 1);
assert.equal(listOpportunities(db, { market: "all", sort: "score", status: "active", limit: 10 }).length, 1);
db.close();
```

- [ ] **Step 2: Run tests and confirm the worker is absent**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-worker.test.mjs`

Expected: FAIL because `runOpportunityCycle()` does not exist.

- [ ] **Step 3: Implement one transactional cycle**

```ts
export async function runOpportunityCycle({
  db = openOpportunityDb(),
  now = new Date(),
  loadItems = loadOpportunitySourceItems,
  loadPriorityAssets = loadOpportunityPriorityAssetKeys,
  loadMarketReaction = loadOpportunityMarketReaction,
  evaluateBatch = evaluateOpportunityBatch,
} = {}) {
  const items = await loadItems();
  const priorityAssetKeys = await loadPriorityAssets();
  const candidates = clusterOpportunityItems(items);
  const scored = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    score: scoreOpportunityCandidate(candidate, { priorityAssetKeys, marketReaction: await loadMarketReaction(candidate.assetKeys), now }),
  })));
  const aiCandidates = scored.filter((entry) => entry.score.ruleScore >= 60).slice(0, 20);
  const persisted = persistOpportunityRuleCandidates(db, scored, now);
  const pending = persisted.filter((entry) => {
    const inputHash = buildOpportunityInputHash(entry.candidate, OPPORTUNITY_PROMPT_VERSION);
    return !getOpportunityEvaluationByInputHash(db, entry.clusterId, inputHash);
  });
  let aiResult = null;
  let aiError = null;
  if (pending.length > 0) {
    try {
      aiResult = await evaluateBatch(pending.map((entry) => entry.candidate));
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error);
    }
  }
  applyOpportunityEvaluations(db, { pending, aiResult, aiError, now });
  selectUnselectedDailyOpportunities(db, {
    dateKey: formatOpportunityDateKey(now, "Asia/Shanghai"),
    threshold: 75,
    limit: 10,
    selectedAt: now.toISOString(),
  });
  const result = buildOpportunityCycleResult(db, now, { candidateCount: scored.length, evaluatedCount: aiResult?.evaluations.length ?? 0, provider: aiResult?.provider.id ?? null, model: aiResult?.provider.model ?? null, error: aiError });
  setOpportunityWorkerState(db, "last_cycle", result, now.toISOString());
  return result;
}
```

`persistOpportunityRuleCandidates()` wraps cluster and evidence upserts in a transaction and returns `{ clusterId, candidate, score }[]`. `getOpportunityEvaluationByInputHash()` treats only `generated` rows as reusable; an `error` row remains visible for diagnostics but is retried on the next hourly cycle. `saveOpportunityEvaluation()` uses `ON CONFLICT(cluster_id, input_hash) DO UPDATE` so a successful retry replaces the error result.

`applyOpportunityEvaluations()` maps responses by `canonicalKey`, rejects unknown keys, stores one evaluation per `(clusterId, inputHash)`, computes `finalScore = clamp(ruleScore + aiAdjustment, 0, 100)`, and calls `updateOpportunityAnalysis()`. A failed or invalid new AI response never overwrites an older valid analysis. A cluster that has never had a valid AI result uses adjustment 0, confidence `rule-only`, and thesis `AI 待补充`. `buildOpportunityCycleResult()` reads today's selected count and returns the persisted health fields.

Persist the worker state only after all data writes succeed. `selectUnselectedDailyOpportunities()` counts rows whose `selected_at` falls on the current Asia/Shanghai date, fills only the remaining slots with unselected rows ordered by score, and never reselects an old cluster. Store rule-only results when AI fails. Never log item text or the AI request body; structured logs may include counts, provider ID, model, duration, and error class.

- [ ] **Step 4: Add the long-running entry point and scripts**

```json
{
  "opportunity:worker": "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs",
  "opportunity:worker:once": "node --experimental-strip-types --experimental-transform-types scripts/opportunity-worker.mjs --once"
}
```

The script follows existing worker conventions: load `.env.local` and `.env`, run once at startup, honor `--once`, prevent overlapping runs, sleep `OPPORTUNITY_WORKER_INTERVAL_MS` with a default of `3600000`, and handle `SIGINT`/`SIGTERM`.

- [ ] **Step 5: Run worker tests and one local rule-only cycle**

Run: `node --experimental-strip-types --experimental-transform-types src/lib/opportunity-worker.test.mjs`

Run: `pnpm opportunity:worker:once`

Expected: tests pass; one-shot exits zero and writes worker state even when AI is unavailable.

- [ ] **Step 6: Commit worker orchestration**

```bash
git add package.json scripts/opportunity-worker.mjs scripts/opportunity-worker-contract.test.mjs src/lib/opportunity-worker.ts src/lib/opportunity-worker.test.mjs
git commit -m "feat: run hourly opportunity processing"
```

---

### Task 6: Authenticated Opportunity APIs

**Files:**
- Create: `src/app/api/opportunities/route.ts`
- Create: `src/app/api/opportunities/refresh/route.ts`
- Create: `src/app/api/opportunities/[id]/follow/route.ts`
- Create: `src/app/api/opportunities/[id]/dismiss/route.ts`
- Test: `src/app/api/opportunities/route.test.mjs`
- Test: `src/app/api/opportunities/mutations.test.mjs`

**Interfaces:**
- Consumes: Task 2 store queries and preferences.
- Produces: `OpportunitySnapshot` JSON and preference mutation responses.

- [ ] **Step 1: Write failing API contract tests**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const refresh = readFileSync(new URL("./refresh/route.ts", import.meta.url), "utf8");
assert.match(list, /listOpportunities/);
assert.match(list, /market/);
assert.match(list, /sort/);
assert.match(list, /status/);
assert.match(refresh, /getOpportunitySnapshot/);
assert.doesNotMatch(refresh, /runOpportunityCycle|evaluateOpportunityBatch/);
```

- [ ] **Step 2: Run and verify route files are missing**

Run: `node src/app/api/opportunities/route.test.mjs`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement validated list and cache-only refresh routes**

```ts
export async function GET(request: NextRequest) {
  const market = parseOpportunityMarketFilter(request.nextUrl.searchParams.get("market"));
  const sort = request.nextUrl.searchParams.get("sort") === "latest" ? "latest" : "score";
  const status = request.nextUrl.searchParams.get("status") === "history" ? "history" : "active";
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 10));
  return NextResponse.json(getOpportunitySnapshot({ market, sort, status, limit }));
}
```

The refresh POST calls the same snapshot reader and returns `Cache-Control: no-store`; it must not import the worker or AI modules.

- [ ] **Step 4: Implement follow and dismiss mutations**

Parse `[id]` as a positive integer, return `400` for invalid IDs and `404` for missing clusters, and call `setOpportunityPreference()`. Follow accepts `{ followed: boolean }`; dismiss sets `{ dismissed: true }`. Existing `proxy.ts` already protects all `/api/*` routes, so do not add a second auth system.

- [ ] **Step 5: Run API contracts and full proxy tests**

Run: `node src/app/api/opportunities/route.test.mjs`

Run: `node src/app/api/opportunities/mutations.test.mjs`

Run: `node src/proxy.test.mjs`

Expected: all pass; refresh source contains no AI call.

- [ ] **Step 6: Commit APIs**

```bash
git add src/app/api/opportunities
git commit -m "feat: expose opportunity radar APIs"
```

---

### Task 7: Opportunity Cards And Signal Flow Integration

**Files:**
- Create: `src/components/opportunity-radar.tsx`
- Test: `src/components/opportunity-radar.test.mjs`
- Modify: `src/components/signals-responsive-layout.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/app/homepage-mobile-layout.test.mjs`
- Test: `src/components/signals-responsive-layout.test.mjs`

**Interfaces:**
- Consumes: Task 6 `OpportunitySnapshot`, follow, dismiss, and refresh endpoints.
- Produces: desktop `推送 / 机会` primary switch and mobile `最新推送 / 机会 / AI 总结` pager.

- [ ] **Step 1: Write failing component and layout contracts**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const radar = readFileSync(new URL("./opportunity-radar.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("./signals-responsive-layout.tsx", import.meta.url), "utf8");
assert.match(radar, /\/api\/opportunities/);
assert.match(radar, /关注/);
assert.match(radar, /忽略/);
assert.match(radar, /打开原文/);
assert.match(radar, /价格待获取|AI 待补充/);
assert.match(layout, /opportunities/);
assert.match(layout, /grid-cols-3/);
```

- [ ] **Step 2: Run and confirm the component is absent**

Run: `node src/components/opportunity-radar.test.mjs`

Expected: FAIL because `opportunity-radar.tsx` does not exist.

- [ ] **Step 3: Implement cached loading, filters, and mutations**

```tsx
function OpportunityDetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <div className="mt-2"><h4 className="text-xs font-semibold text-muted">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function OpportunityFilters({ market, sort, status, onMarketChange, onSortChange, onStatusChange }: {
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  onMarketChange: (value: OpportunityMarketFilter) => void;
  onSortChange: (value: OpportunitySort) => void;
  onStatusChange: (value: OpportunityListStatus) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <label className="text-xs text-muted">市场<select aria-label="市场" value={market} onChange={(event) => onMarketChange(event.target.value as OpportunityMarketFilter)}><option value="all">全部</option><option value="us">美股</option><option value="cn">A股</option><option value="crypto">加密</option></select></label>
      <label className="text-xs text-muted">排序<select aria-label="排序" value={sort} onChange={(event) => onSortChange(event.target.value as OpportunitySort)}><option value="score">价值评分</option><option value="latest">最新出现</option></select></label>
      <label className="text-xs text-muted">状态<select aria-label="状态" value={status} onChange={(event) => onStatusChange(event.target.value as OpportunityListStatus)}><option value="active">有效机会</option><option value="history">历史</option></select></label>
    </div>
  );
}

function OpportunityCardView({ item, onChanged }: { item: OpportunityCard; onChanged: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const updateFollow = async () => {
    try {
      const response = await fetch(`/api/opportunities/${item.id}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ followed: !item.followed }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMutationError(null);
      await onChanged();
    } catch (error) { setMutationError(error instanceof Error ? error.message : String(error)); }
  };
  const dismiss = async () => {
    try {
      const response = await fetch(`/api/opportunities/${item.id}/dismiss`, { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMutationError(null);
      await onChanged();
    } catch (error) { setMutationError(error instanceof Error ? error.message : String(error)); }
  };
  return (
    <article className="rounded-lg border border-line/70 bg-panel px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <strong className="text-base text-foreground">{item.finalScore}</strong>
            <span>{item.market}</span><span>{item.eventType}</span><span>{item.confidence}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{item.assetKeys.join(" · ")}</h3>
          <p className="mt-1 text-sm leading-6 text-foreground">{item.thesis || "AI 待补充"}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" title={item.followed ? "取消关注" : "关注"} aria-label={item.followed ? "取消关注" : "关注"} onClick={() => void updateFollow()}>{item.followed ? "★" : "☆"}</button>
          <button type="button" title="忽略" aria-label="忽略" onClick={() => void dismiss()}>×</button>
          <button type="button" title={expanded ? "收起" : "展开"} aria-label={expanded ? "收起" : "展开"} onClick={() => setExpanded((value) => !value)}>{expanded ? "⌃" : "⌄"}</button>
        </div>
      </div>
      {mutationError ? <p className="mt-2 text-xs text-danger">{mutationError}</p> : null}
      {expanded ? (
        <div className="mt-3 border-t border-line/70 pt-3 text-sm leading-6">
          <OpportunityDetailList title="为什么值得关注" items={item.reasons} />
          <OpportunityDetailList title="主要风险" items={item.risks} />
          <OpportunityDetailList title="失效条件" items={item.invalidation} />
          <div className="mt-2 flex flex-col gap-1">
            {item.evidence.map((evidence) => <a key={evidence.id} href={evidence.originalUrl} target="_blank" rel="noreferrer" className="text-info hover:underline">↗ {evidence.sourceName} · {evidence.textExcerpt}</a>)}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function OpportunityRadar() {
  const [market, setMarket] = useState<OpportunityMarketFilter>("all");
  const [sort, setSort] = useState<OpportunitySort>("score");
  const [status, setStatus] = useState<OpportunityListStatus>("active");
  const cacheKey = `signal-hub:opportunities:v1:${market}:${sort}:${status}`;
  const [cached, writeCached] = useBrowserJsonCache<OpportunitySnapshot>(cacheKey);
  const [live, setLive] = useState<{ key: string; snapshot: OpportunitySnapshot } | null>(null);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);
  const snapshot = live?.key === cacheKey ? live.snapshot : cached;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/opportunities?market=${market}&sort=${sort}&status=${status}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();
      setLive({ key: cacheKey, snapshot: next });
      writeCached(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [cacheKey, market, sort, status, writeCached]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  return (
    <section className="min-w-0 rounded-lg border border-line/70 bg-panel-strong/95 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">机会雷达</h2>
        <button type="button" onClick={() => void load()} className="h-9 rounded-lg border border-line/70 px-3 text-xs font-semibold">刷新缓存</button>
      </div>
      <OpportunityFilters market={market} sort={sort} status={status} onMarketChange={setMarket} onSortChange={setSort} onStatusChange={setStatus} />
      {error ? <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error} · 正在保留上次缓存</p> : null}
      {loading && !snapshot ? <p className="py-10 text-center text-sm text-muted">加载机会缓存...</p> : null}
      <div className="mt-3 flex flex-col gap-2">
        {snapshot?.items.map((item) => <OpportunityCardView key={item.id} item={item} onChanged={load} />)}
        {snapshot && snapshot.items.length === 0 ? <p className="py-10 text-center text-sm text-muted">当前没有达到 75 分的机会</p> : null}
      </div>
    </section>
  );
}
```

Use compact cards with 8px-or-less radius, score/confidence, market, assets, event type, thesis, time window, source count, and status. Expansion shows reasons, price response, evidence, risks, and invalidation. Use familiar icons for follow, dismiss, expand, and external link; add tooltips to unfamiliar icons.

- [ ] **Step 4: Integrate the feature flag and responsive views**

In `src/app/page.tsx`:

```tsx
<SignalsResponsiveLayout
  initialTelegramSnapshot={telegramSnapshot}
  initialXSnapshot={xSnapshot}
  pollXSnapshot={pollXSnapshot}
  opportunityEnabled={process.env.OPPORTUNITY_RADAR_UI_ENABLED === "1"}
/>
```

When disabled, render the exact existing two-panel mobile layout and existing desktop layout. When enabled, desktop shows `推送 / 机会` above the left workspace while AI summary stays on the right; mobile uses three equal-width controls and three snap pages. Map indices explicitly as `{ feed: 0, opportunities: 1, summary: 2 }` so scroll state cannot drift.

- [ ] **Step 5: Run focused layout tests and browser verification**

Run: `node src/components/opportunity-radar.test.mjs`

Run: `node src/components/signals-responsive-layout.test.mjs`

Run: `node src/app/homepage-mobile-layout.test.mjs`

Start: `pnpm dev`

Verify at desktop 1440x1000 and mobile 390x844:

- Feature off reproduces the current layout.
- Feature on shows the new controls without horizontal overflow.
- Follow/dismiss update without a full-page reload.
- Expanded text does not overlap the mobile bottom navigation.
- Manual refresh does not produce an AI request.

- [ ] **Step 6: Commit UI integration**

```bash
git add src/app/page.tsx src/app/homepage-mobile-layout.test.mjs src/components/opportunity-radar.tsx src/components/opportunity-radar.test.mjs src/components/signals-responsive-layout.tsx src/components/signals-responsive-layout.test.mjs
git commit -m "feat: add opportunity radar to Signal Flow"
```

---

### Task 8: Health Center, systemd, Shadow Rollout, And Release

**Files:**
- Modify: `src/lib/system-health.ts`
- Modify: `src/lib/signal-hub-services.ts`
- Test: `src/lib/system-health.test.mjs`
- Modify: `scripts/deploy-vps.sh`
- Test: `scripts/deploy-vps.test.mjs`
- Test: `scripts/check-system-health.test.mjs`

**Interfaces:**
- Consumes: Task 2 worker state and Task 5 service entry point.
- Produces: ninth health/service item and shadow-mode production deployment.

- [ ] **Step 1: Write failing health and deploy contracts**

```js
assert.match(serviceRegistry, /signal-hub-opportunity/);
assert.match(deployScript, /signal-hub-opportunity\.service/);
assert.match(deployScript, /scripts\/opportunity-worker\.mjs/);
assert.match(deployScript, /signal-hub-opportunity/);
assert.match(systemHealth, /opportunityHealthItem/);
```

- [ ] **Step 2: Run and confirm the ninth service is missing**

Run: `node scripts/deploy-vps.test.mjs`

Run: `node src/lib/system-health.test.mjs`

Expected: FAIL because the service and health item are not registered.

- [ ] **Step 3: Add opportunity health summarization**

Read `opportunity_worker_state` from `getOpportunityDbPath()`. Report last success, last error, candidate count, AI-evaluated count, selected-today count, provider, and model. Mark stale after two worker intervals (`2 * 60 * 60 * 1000`), warning for rule-only/provider fallback, and error only when the latest completed cycle failed without preserving a readable snapshot.

```ts
function opportunityHealthItem(env: EnvLike, now: Date): SystemHealthItem {
  const state = readOpportunityHealthState(env);
  if (!state) return { id: "opportunity", label: "机会雷达", status: "warning", detail: "opportunity cache missing", updatedAt: null, stale: true };
  const stale = isStale(state.lastSuccessAt, now, 2 * 60 * 60 * 1000);
  return {
    id: "opportunity",
    label: "机会雷达",
    status: state.lastError ? "warning" : stale ? "warning" : "ok",
    detail: state.lastError || `${state.selectedToday} selected · ${ageLabel(state.lastSuccessAt, now)}`,
    updatedAt: state.lastSuccessAt,
    stale,
    meta: { candidates: state.candidateCount, evaluated: state.evaluatedCount, selected: state.selectedToday, provider: state.provider },
  };
}
```

- [ ] **Step 4: Register and install the systemd service**

Add `{ name: "signal-hub-opportunity", label: "机会雷达", category: "ai", required: true }` to `SIGNAL_HUB_SYSTEMD_SERVICES`.

Add this unit creation to `scripts/deploy-vps.sh`:

```ini
[Unit]
Description=Signal Hub Opportunity Radar worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=SIGNAL_HUB_RUNTIME_DIR=$APP_DIR/.signal-hub
ExecStart=$NODE_BIN --experimental-strip-types --experimental-transform-types $APP_DIR/scripts/opportunity-worker.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Render the unit through the existing unquoted shell heredoc so `APP_DIR` and `NODE_BIN` become absolute values when the file is installed. Restart the new service with the existing eight services.

- [ ] **Step 5: Run complete local verification**

Run:

```bash
pnpm test
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm audit --audit-level low
pnpm build
```

Expected: all tests pass, ESLint has zero warnings, TypeScript passes, audit reports zero known vulnerabilities, and the production build succeeds.

- [ ] **Step 6: Deploy shadow mode**

Keep `OPPORTUNITY_RADAR_UI_ENABLED=0` on the VPS. Push `main`, run `scripts/deploy-vps.sh`, and verify:

```bash
systemctl is-active signal-hub-opportunity
journalctl -u signal-hub-opportunity -n 100 --no-pager
pnpm opportunity:worker:once
```

Expected: service is `active`; logs contain counts and duration but no source text or credentials; one-shot reuses the existing input hash instead of issuing a duplicate AI request.

- [ ] **Step 7: Review one-to-two days of shadow results**

Inspect the SQLite snapshot and record:

- qualifying opportunities per day
- percentage with at least two independent sources
- rule-only versus AI-evaluated count
- Minimax and DeepSeek call count
- duplicate-cluster count
- false-positive examples and their score components

Do not lower the evidence requirement to increase volume. Adjust deterministic weights or penalties through focused tests when shadow results reveal a repeatable error.

- [ ] **Step 8: Enable the UI after the shadow gate**

Set `OPPORTUNITY_RADAR_UI_ENABLED=1` in the VPS environment and restart only `signal-hub-web`. Verify authenticated desktop and mobile flows, all nine services, `/api/opportunities`, and `https://holdrich.online/login` status 200.

- [ ] **Step 9: Commit operations and release wiring**

```bash
git add scripts/deploy-vps.sh scripts/deploy-vps.test.mjs scripts/check-system-health.test.mjs src/lib/signal-hub-services.ts src/lib/system-health.ts src/lib/system-health.test.mjs
git commit -m "ops: deploy opportunity radar worker"
```

---

## Final Review Checklist

- [ ] Every displayed claim links to at least one stored evidence item.
- [ ] Edited or repeated source content updates an event instead of duplicating it.
- [ ] Rule-only mode remains readable when both AI providers fail.
- [ ] The daily selection uses Asia/Shanghai and never exceeds 10.
- [ ] Manual refresh performs no AI generation.
- [ ] Feature-off behavior matches the current Signal Flow UI.
- [ ] Existing reading-position, author filters, TG/X tabs, Holding, Stocks, Douyin, and summaries pass regression tests.
- [ ] Shadow logs reveal no secrets or private full text.
- [ ] Local, GitHub, and VPS commit SHAs match after deployment.
