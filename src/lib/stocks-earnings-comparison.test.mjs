import assert from "node:assert/strict";
import {
  areStocksEarningsValuesComparable,
  calculateComparisonMetric,
  mergeEarningsMetricValues,
  parseFmpQuarterlyEarnings,
  parseFmpQuarterlyEarningsHistory,
} from "./stocks-earnings-comparison.ts";

const generatedAt = "2026-08-14T00:00:00.000Z";
const nbisPayload = {
  income: [
    {
      date: "2026-06-30",
      fiscalYear: "2026",
      period: "Q2",
      reportedCurrency: "USD",
      revenue: 582_300_000,
      netIncome: -190_400_000,
    },
    {
      date: "2025-06-30",
      fiscalYear: "2025",
      period: "Q2",
      reportedCurrency: "USD",
      revenue: 105_100_000,
      netIncome: -143_600_000,
    },
  ],
  estimates: [
    {
      date: "2026-06-30",
      fiscalYear: "2026",
      period: "Q2",
      estimatedRevenueAvg: 573_937_500,
      estimatedNetIncomeAvg: -273_800_000,
    },
  ],
  earnings: [
    {
      date: "2026-08-12",
      fiscalDateEnding: "2026-06-30",
      time: "bmo",
    },
  ],
};

const comparison = parseFmpQuarterlyEarnings("nbis", nbisPayload, {
  generatedAt,
});

assert.ok(comparison);
assert.equal(comparison.ticker, "NBIS");
assert.equal(comparison.fiscalYear, 2026);
assert.equal(comparison.quarter, "Q2");
assert.equal(comparison.fiscalDateEnding, "2026-06-30");
assert.equal(comparison.reportDate, "2026-08-12");
assert.equal(comparison.reportTiming, "before-market");
assert.equal(comparison.currency, "USD");
assert.equal(comparison.accountingBasis, "FMP standardized");
assert.equal(comparison.provider, "fmp");
assert.equal(comparison.generatedAt, generatedAt);
assert.equal(comparison.revenue.actual, 582_300_000);
assert.equal(comparison.revenue.estimate, 573_937_500);
assert.deepEqual(comparison.revenue.actualSource, {
  provider: "fmp",
  method: "direct",
  accountingBasis: "FMP standardized",
  currency: "USD",
  unit: "monetary",
  scale: "raw",
  metric: "revenue",
  semantics: "statement-actual",
});
assert.deepEqual(comparison.revenue.estimateSource, {
  provider: "fmp",
  method: "direct",
  accountingBasis: "FMP standardized",
  currency: "USD",
  unit: "monetary",
  scale: "raw",
  metric: "revenue",
  semantics: "consensus-estimate",
});
assert.equal(comparison.revenue.previousYearActual, 105_100_000);
assert.equal(comparison.revenue.surprise, 8_362_500);
assert.ok(Math.abs(comparison.revenue.surprisePct - 1.457_04) < 0.000_01);
assert.ok(Math.abs(comparison.revenue.actualYoYPct - 454.043_768) < 0.000_01);
assert.ok(Math.abs(comparison.revenue.estimateYoYPct - 446.087_06) < 0.000_01);
assert.equal(comparison.netIncome.actual, -190_400_000);
assert.equal(comparison.netIncome.estimate, -273_800_000);
assert.equal(comparison.netIncome.surprise, 83_400_000);
assert.ok(Math.abs(comparison.netIncome.surprisePct - 30.460_19) < 0.000_01);
assert.ok(Math.abs(comparison.netIncome.actualYoYPct - -32.590_529) < 0.000_01);

const negativeEstimate = calculateComparisonMetric(-190, -274, -144);
assert.equal(negativeEstimate.surprise, 84);
assert.ok(Math.abs(negativeEstimate.surprisePct - 30.656_934) < 0.000_01);

const zeroEstimate = calculateComparisonMetric(12, 0, 10);
assert.equal(zeroEstimate.surprise, 12);
assert.equal(zeroEstimate.surprisePct, null);

const missingEstimate = calculateComparisonMetric(12, null, 10);
assert.equal(missingEstimate.surprise, null);
assert.equal(missingEstimate.surprisePct, null);
assert.equal(missingEstimate.actualYoYPct, 20);

const filled = mergeEarningsMetricValues(
  calculateComparisonMetric(582_300_000, null, 105_100_000, {
    actualSource: {
      provider: "fmp",
      method: "direct",
      accountingBasis: "FMP standardized",
      currency: "USD",
      unit: "monetary",
      scale: "raw",
      metric: "revenue",
      semantics: "statement-actual",
    },
  }),
  {
    estimate: 573_937_500,
    estimateSource: {
      provider: "finnhub",
      method: "direct",
      accountingBasis: "Unspecified accounting basis",
      currency: "USD",
      unit: "monetary",
      scale: "raw",
      metric: "revenue",
      semantics: "consensus-estimate",
    },
  },
);
assert.equal(filled.actual, 582_300_000);
assert.equal(filled.estimate, 573_937_500);
assert.deepEqual(filled.estimateSource, {
  provider: "finnhub",
  method: "direct",
  accountingBasis: "Unspecified accounting basis",
  currency: "USD",
  unit: "monetary",
  scale: "raw",
  metric: "revenue",
  semantics: "consensus-estimate",
});
assert.ok(Math.abs(filled.surprisePct - 1.45704) < 0.00001);
assert.equal(
  areStocksEarningsValuesComparable(
    filled.actualSource,
    filled.estimateSource,
  ),
  true,
);

const incompatibleMetric = mergeEarningsMetricValues(filled, {
  estimateSource: { ...filled.estimateSource, scale: "millions" },
});
assert.equal(incompatibleMetric.surprise, null);
assert.equal(incompatibleMetric.surprisePct, null);

const withinSevenDays = parseFmpQuarterlyEarnings(
  "TEST",
  {
    income: [
      {
        date: "2026-06-30",
        fiscalYear: "2026",
        period: "Q2",
        revenue: 120,
        netIncome: 20,
      },
    ],
    estimates: [
      {
        date: "2026-07-07",
        estimatedRevenueAvg: 100,
        estimatedNetIncomeAvg: 10,
      },
    ],
    earnings: [],
  },
  { generatedAt },
);
assert.equal(withinSevenDays?.revenue.estimate, 100);

const outsideSevenDays = parseFmpQuarterlyEarnings(
  "TEST",
  {
    income: [
      {
        date: "2026-06-30",
        fiscalYear: "2026",
        period: "Q2",
        revenue: 120,
        netIncome: 20,
      },
    ],
    estimates: [
      {
        date: "2026-07-08",
        estimatedRevenueAvg: 100,
        estimatedNetIncomeAvg: 10,
      },
    ],
    earnings: [],
  },
  { generatedAt },
);
assert.equal(outsideSevenDays?.revenue.estimate, null);

const history = parseFmpQuarterlyEarningsHistory(
  "NBIS",
  {
    income: Array.from({ length: 10 }, (_, index) => ({
      date: `${2026 - Math.floor(index / 4)}-${String(12 - (index % 4) * 3).padStart(2, "0")}-30`,
      fiscalYear: String(2026 - Math.floor(index / 4)),
      period: `Q${4 - (index % 4)}`,
      revenue: 1_000 - index,
      netIncome: 100 - index,
    })),
    estimates: [],
    earnings: [],
  },
  { generatedAt, limit: 8 },
);
assert.equal(history.length, 8);
assert.equal(history[0].fiscalYear, 2026);

assert.equal(
  parseFmpQuarterlyEarnings("EMPTY", { income: [], estimates: [], earnings: [] }, { generatedAt }),
  null,
);

console.log("ok - stocks earnings comparison");
