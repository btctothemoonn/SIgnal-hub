import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeterministicEarningsInsight,
  enrichStocksFinancialSnapshotWithInsights,
  getOrCreateStocksEarningsInsight,
} from "./stocks-earnings-insight.ts";

const comparison = {
  ticker: "NBIS",
  fiscalYear: 2026,
  quarter: "Q2",
  fiscalDateEnding: "2026-06-30",
  reportDate: "2026-08-12",
  reportTiming: "before-market",
  currency: "USD",
  accountingBasis: "FMP standardized",
  provider: "fmp",
  generatedAt: "2026-08-14T00:00:00.000Z",
  revenue: {
    estimate: 573_937_500,
    actual: 582_300_000,
    previousYearActual: 105_100_000,
    estimateYoYPct: 446.087,
    actualYoYPct: 454.044,
    surprise: 8_362_500,
    surprisePct: 1.457,
  },
  netIncome: {
    estimate: -273_800_000,
    actual: -190_400_000,
    previousYearActual: -143_600_000,
    estimateYoYPct: -90.669,
    actualYoYPct: -32.591,
    surprise: 83_400_000,
    surprisePct: 30.46,
  },
};

const fallback = buildDeterministicEarningsInsight(comparison, {
  generatedAt: "2026-08-14T01:00:00.000Z",
});
assert.match(fallback.conclusion, /营收超预期/);
assert.match(fallback.conclusion, /净利润好于预期/);
assert.match(fallback.driver, /净亏损较预期收窄/);
assert.match(fallback.risk, /仍处于净亏损/);
assert.equal(fallback.source, "rules");
assert.equal(fallback.model, null);

const noEstimate = buildDeterministicEarningsInsight({
  ...comparison,
  revenue: { ...comparison.revenue, estimate: null, surprise: null, surprisePct: null },
  netIncome: {
    ...comparison.netIncome,
    estimate: null,
    surprise: null,
    surprisePct: null,
  },
});
assert.match(noEstimate.conclusion, /暂无完整一致预期/);
assert.doesNotMatch(noEstimate.conclusion, /超预期|不及预期|好于预期/);

const enrichedWithoutAi = await enrichStocksFinancialSnapshotWithInsights(
  {
    generatedAt: comparison.generatedAt,
    source: "live",
    provider: "fmp",
    errors: [],
    financials: {
      NBIS: {
        ticker: "NBIS",
        revenue: "$582.30M",
        revenueYoY: "454.0%",
        eps: "n/a",
        grossMargin: "n/a",
        freeCashFlow: "n/a",
        nextEarningsDate: comparison.reportDate,
        guidance: "No forward estimate",
        periodLabel: "Q2 2026",
        source: "live",
        updatedAt: comparison.generatedAt,
        latestEarnings: comparison,
        earningsHistory: [comparison],
      },
    },
  },
  { env: {}, now: new Date("2026-08-14T01:00:00.000Z") },
);
assert.equal(enrichedWithoutAi.financials.NBIS.earningsInsight.source, "rules");

const cacheDir = mkdtempSync(join(tmpdir(), "stocks-earnings-insight-"));
let fetchCalls = 0;
try {
  const request = {
    comparison,
    cacheDir,
    env: {
      MINIMAX_API_KEY: "test-key",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      AI_SUMMARY_MODEL: "MiniMax-M2.7",
    },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "MiniMax-M2.7");
      assert.match(body.messages[1].content, /estimatedRevenueAvg|"estimate"/);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                conclusion: "营收与净利润均好于 FMP 一致预期。",
                driver: "营收超预期且净亏损低于预期。",
                risk: "公司仍处于亏损阶段。",
              }),
            },
          },
        ],
      });
    },
    now: new Date("2026-08-14T02:00:00.000Z"),
  };

  const first = await getOrCreateStocksEarningsInsight(request);
  const second = await getOrCreateStocksEarningsInsight(request);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(second, first);
  assert.equal(first.source, "ai");
  assert.equal(first.model, "MiniMax-M2.7");

  const otherQuarter = await getOrCreateStocksEarningsInsight({
    ...request,
    comparison: { ...comparison, quarter: "Q3" },
  });
  assert.equal(otherQuarter.source, "ai");
  assert.equal(fetchCalls, 2);

  const malformed = await getOrCreateStocksEarningsInsight({
    ...request,
    cacheDir: join(cacheDir, "malformed"),
    fetchImpl: async () =>
      Response.json({ choices: [{ message: { content: "not json" } }] }),
  });
  assert.equal(malformed.source, "rules");
  assert.match(malformed.conclusion, /营收超预期/);
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}

console.log("ok - stocks earnings insight cache");
