import assert from "node:assert/strict";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import {
  buildStocksIntelligence,
  buildSubscriptionReportInsight,
} from "./stocks-intelligence.ts";

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

assert.equal(intelligence.tickerContext.price.value, "$921.40");
assert.equal(intelligence.earningsBrief.mode, "pre");
assert.match(intelligence.earningsBrief.title, /财报前/);
assert.ok(
  intelligence.riskTags.some((tag) => tag.label === "财报临近"),
  "upcoming earnings should produce 财报临近",
);
assert.ok(
  intelligence.riskTags.some((tag) => tag.label === "追高风险"),
  "high day/seven-day move should produce 追高风险",
);
assert.ok(
  intelligence.riskTags.some((tag) => tag.label === "趋势偏强"),
  "live strong candles should produce 趋势偏强",
);
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
assert.ok(
  weakIntelligence.riskTags.some((tag) => tag.label === "数据不足"),
  "mock/missing data should produce 数据不足",
);
assert.equal(weakIntelligence.structure.label, "结构未确认");
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
