import assert from "node:assert/strict";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import {
  buildStocksIntelligence,
  buildSubscriptionReportInsight,
  resolveEarningsStatus,
} from "./stocks-intelligence.ts";

const earningsNow = new Date("2026-07-24T12:00:00.000Z");
assert.equal(resolveEarningsStatus("2026-07-30", earningsNow), "upcoming");
assert.equal(resolveEarningsStatus("2026-07-20", earningsNow), "recent");
assert.equal(resolveEarningsStatus("2026-08-20", earningsNow), "watch");
assert.equal(resolveEarningsStatus("2026-10-20", earningsNow), "quiet");
assert.equal(
  resolveEarningsStatus("n/a", earningsNow, "upcoming"),
  "upcoming",
);

const nvda = getAlphaResearchStockByTicker("NVDA");
assert.ok(nvda);

const upcomingHighMomentum = {
  ...nvda,
  market: {
    ...nvda.market,
    source: "live",
    candlesSource: "live",
    dayChangePct: 6.2,
    sevenDayChangePct: 13.4,
    earningsStatus: "upcoming",
    provider: "fmp",
    freshness: "realtime",
  },
  financialSnapshot: {
    ...nvda.financialSnapshot,
    source: "live",
    guidance: "Next EPS 6.35 / Revenue $27.80B",
  },
};

const intelligence = buildStocksIntelligence(upcomingHighMomentum);

const catalystSentinelStock = {
  ...upcomingHighMomentum,
};
Object.defineProperty(catalystSentinelStock, "catalysts", {
  get() {
    throw new Error("stocks intelligence must not read catalyst history");
  },
});
assert.doesNotThrow(() => buildStocksIntelligence(catalystSentinelStock));

assert.equal(intelligence.tickerContext.price.value, "$921.40");
assert.equal(intelligence.earningsBrief.mode, "pre");
assert.match(intelligence.earningsBrief.title, /财报前/);
assert.match(intelligence.earningsBrief.points[0], /当前状态为临近/);
assert.match(intelligence.earningsBrief.points[2], /今日 \+6\.2%，7日 \+13\.4%/);
assert.equal(intelligence.structure.label, "强势");
assert.ok(intelligence.structure.points.some((point) => point.includes("7日")));

const mockWeakData = {
  ...nvda,
  market: {
    ...nvda.market,
    source: "mock",
    candlesSource: "mock",
    dayChangePct: 0,
    sevenDayChangePct: 0,
  },
  financialSnapshot: {
    ...nvda.financialSnapshot,
    source: "mock",
    revenue: "n/a",
    eps: "n/a",
    grossMargin: "n/a",
    freeCashFlow: "n/a",
  },
};

const weakIntelligence = buildStocksIntelligence(mockWeakData);
assert.equal(weakIntelligence.structure.label, "结构未确认");
assert.equal(weakIntelligence.structure.score, 0);
assert.equal(weakIntelligence.earningsBrief.confidence, "limited");
assert.equal(weakIntelligence.tickerContext.revenue.value, "n/a");

const subscriptionInsight = buildSubscriptionReportInsight({
  title: "2026年5月10日：Melt-Up最后阶段，MU、SNDK逼近终极目标",
  summary:
    "存储仓位Regroup，DRAM/HBM/NAND价格继续修复，但需要警惕短线拥挤。",
  fullSummary:
    "核心观点：存储链仍在价格修复阶段。影响链条：DRAM、HBM、NAND。风险：短线涨幅过大后容易回撤。",
  impact: "positive",
  tickers: ["MU", "SNDK", "DRAM"],
});

assert.equal(subscriptionInsight.impactLabel, "利多");
assert.deepEqual(subscriptionInsight.relatedTickers, ["MU", "SNDK", "DRAM"]);
assert.match(subscriptionInsight.coreConclusion, /存储链/);
assert.match(subscriptionInsight.impactChain, /存储/);
assert.match(subscriptionInsight.riskNote, /短线|回撤/);
assert.equal(subscriptionInsight.fallbackUsed, false);

const fallbackInsight = buildSubscriptionReportInsight({
  title: "Patreon note",
  summary: "",
  impact: "neutral",
  tickers: [],
});
assert.equal(fallbackInsight.fallbackUsed, true);
assert.match(fallbackInsight.coreConclusion, /总结未生成/);

console.log("ok - stocks intelligence rules");
