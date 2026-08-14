import assert from "node:assert/strict";
import {
  completeStocksEarningsComparison,
  deriveNetIncome,
  mergeStocksEarningsFallbackCandidate,
  parseAlphaVantageEarningsCandidate,
  parseEodhdEarningsCandidate,
  parseFinnhubEarningsCandidate,
} from "./stocks-earnings-fallback.ts";

const target = {
  ticker: "NBIS",
  fiscalYear: 2026,
  quarter: "Q2",
  fiscalDateEnding: "2026-06-30",
  reportDate: "2026-08-12",
  reportTiming: "before-market",
  currency: "USD",
};

const finnhubPayload = {
  earningsCalendar: [
    {
      symbol: "NBIS",
      year: 2026,
      quarter: 2,
      date: "2026-08-12",
      hour: "bmo",
      revenueActual: 582_300_000,
      revenueEstimate: 573_937_500,
      epsActual: -1.9,
      epsEstimate: -2.74,
    },
  ],
};

const eodhdPayload = {
  trends: [
    {
      date: "2026-06-30",
      fiscalYear: 2026,
      quarter: 2,
      revenueEstimate: 573_937_500,
      epsEstimate: -2.74,
    },
  ],
};

const alphaVantagePayload = {
  incomeStatement: {
    quarterlyReports: [
      {
        fiscalDateEnding: "2026-06-30",
        totalRevenue: "582300000",
        netIncome: "-190400000",
        reportedEPS: "-1.90",
      },
    ],
  },
  earningsEstimates: {
    quarterlyEstimates: [
      {
        fiscalDateEnding: "2026-06-30",
        estimatedRevenue: "573937500",
        estimatedEPS: "-2.74",
      },
    ],
  },
};

assert.equal(
  parseFinnhubEarningsCandidate(finnhubPayload, target)?.revenueEstimate,
  573_937_500,
);
assert.equal(
  parseEodhdEarningsCandidate(eodhdPayload, target)?.epsEstimate,
  -2.74,
);
assert.equal(
  parseAlphaVantageEarningsCandidate(alphaVantagePayload, target)
    ?.netIncomeActual,
  -190_400_000,
);
assert.equal(deriveNetIncome(-2.74, 100_000_000), -274_000_000);
assert.equal(
  parseFinnhubEarningsCandidate(
    { earningsCalendar: [{ ...finnhubPayload.earningsCalendar[0], quarter: 3 }] },
    target,
  ),
  null,
);

function metric(actual, estimate, source = "direct") {
  return {
    actual,
    actualSource:
      actual === null
        ? undefined
        : {
            provider: "fmp",
            method: source,
            accountingBasis:
              source === "direct"
                ? "FMP standardized"
                : "Derived from EPS times diluted shares",
          },
    estimate,
    estimateSource:
      estimate === null
        ? undefined
        : {
            provider: "fmp",
            method: source,
            accountingBasis:
              source === "direct"
                ? "FMP standardized"
                : "Derived from EPS times diluted shares",
          },
    previousYearActual: null,
    estimateYoYPct: null,
    actualYoYPct: null,
    surprise: actual === null || estimate === null ? null : actual - estimate,
    surprisePct: null,
  };
}

function baseCandidate({ revenueEstimate = 573_937_500, netIncomeEstimate = -274_000_000 } = {}) {
  return {
    ...target,
    provider: "fmp",
    revenueActual: 582_300_000,
    revenueEstimate,
    netIncomeActual: -190_400_000,
    netIncomeEstimate,
    epsActual: -1.9,
    epsEstimate: netIncomeEstimate === null ? null : -2.74,
    dilutedShares: 100_000_000,
    comparison: {
      ...target,
      provider: "fmp",
      generatedAt: "2026-08-15T00:00:00.000Z",
      accountingBasis: "FMP standardized",
      revenue: metric(582_300_000, revenueEstimate),
      netIncome: metric(-190_400_000, netIncomeEstimate),
    },
  };
}

const alreadyCompleteUrls = [];
const alreadyComplete = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate(),
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-secret",
    STOCKS_EODHD_API_KEY: "eodhd-secret",
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-secret",
  },
  fetchImpl: async (input) => {
    alreadyCompleteUrls.push(String(input));
    throw new Error("Fallback request was not needed");
  },
});
assert.equal(alreadyCompleteUrls.length, 0);
assert.equal(alreadyComplete.comparison.revenue.estimate, 573_937_500);
assert.deepEqual(alreadyComplete.errors, []);

const fallbackUrls = [];
const fallback = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-secret",
    STOCKS_EODHD_API_KEY: "eodhd-secret",
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-secret",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    fallbackUrls.push(url);
    assert.equal(url.hostname, "finnhub.io");
    assert.equal(url.pathname, "/api/v1/calendar/earnings");
    assert.equal(url.searchParams.get("symbol"), "NBIS");
    return Response.json(finnhubPayload);
  },
});
assert.equal(fallbackUrls.length, 1);
assert.equal(fallback.comparison.revenue.estimate, 573_937_500);
assert.equal(fallback.comparison.netIncome.estimate, -274_000_000);
assert.deepEqual(fallback.comparison.revenue.estimateSource, {
  provider: "finnhub",
  method: "direct",
  accountingBasis: "Finnhub consensus",
});
assert.deepEqual(fallback.comparison.netIncome.estimateSource, {
  provider: "finnhub",
  method: "eps-times-diluted-shares",
  accountingBasis: "Derived from EPS times diluted shares",
});
assert.deepEqual(fallback.errors, []);

const protectedErrors = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: { STOCKS_FINNHUB_API_KEY: "finnhub-secret" },
  fetchImpl: async () => {
    throw new Error("Request failed for token=finnhub-secret");
  },
});
assert.ok(protectedErrors.errors.length > 0);
assert.ok(
  protectedErrors.errors.every((error) => !error.includes("finnhub-secret")),
);

const derivedCandidate = {
  ...target,
  provider: "finnhub",
  revenueActual: null,
  revenueEstimate: null,
  netIncomeActual: null,
  netIncomeEstimate: null,
  epsActual: null,
  epsEstimate: -2.74,
  dilutedShares: 100_000_000,
};
const directCandidate = {
  ...derivedCandidate,
  provider: "alpha-vantage",
  netIncomeEstimate: -260_000_000,
  epsEstimate: null,
};
const derivedFirst = mergeStocksEarningsFallbackCandidate(
  baseCandidate({ netIncomeEstimate: null }),
  derivedCandidate,
);
const directWins = mergeStocksEarningsFallbackCandidate(derivedFirst, directCandidate);
assert.equal(directWins.comparison.netIncome.estimate, -260_000_000);
assert.equal(directWins.comparison.netIncome.estimateSource?.method, "direct");
const derivedAfterDirect = mergeStocksEarningsFallbackCandidate(directWins, derivedCandidate);
assert.equal(derivedAfterDirect.comparison.netIncome.estimate, -260_000_000);
assert.equal(derivedAfterDirect.comparison.netIncome.estimateSource?.method, "direct");

console.log("ok - stocks earnings fallback");
