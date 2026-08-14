import assert from "node:assert/strict";
import {
  completeStocksEarningsComparison,
  deriveNetIncome,
  mergeStocksEarningsFallbackCandidate,
  parseAlphaVantageEarningsCandidate,
  parseEodhdEarningsCandidate,
  parseFinnhubEarningsCandidate,
  parseYahooEarningsCandidate,
} from "./stocks-earnings-fallback.ts";

const target = {
  ticker: "NBIS",
  fiscalYear: 2026,
  quarter: "Q2",
  fiscalDateEnding: "2026-06-30",
  reportDate: "2026-08-12",
  reportTiming: "before-market",
  currency: "USD",
  market: "US",
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

const eodhdNestedPayload = {
  type: "Trends",
  symbols: "NBIS.US,OTHER.US",
  trends: [
    [
      {
        code: "NBIS.US",
        date: "2026-06-30",
        period: "0q",
        revenueEstimateAvg: "573937500.00",
        earningsEstimateAvg: "-2.74",
      },
    ],
    [
      {
        code: "OTHER.US",
        date: "2026-06-30",
        period: "0q",
        revenueEstimateAvg: "1.00",
        earningsEstimateAvg: "0.01",
      },
    ],
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
assert.equal(parseEodhdEarningsCandidate(eodhdPayload, target)?.currency, null);
assert.equal(parseEodhdEarningsCandidate(eodhdPayload, target)?.revenueUnit, null);
assert.equal(
  parseEodhdEarningsCandidate(eodhdNestedPayload, target)?.revenueEstimate,
  573_937_500,
);
assert.equal(
  parseEodhdEarningsCandidate(eodhdNestedPayload, target)?.epsEstimate,
  -2.74,
);
assert.equal(
  parseAlphaVantageEarningsCandidate(alphaVantagePayload, target)
    ?.netIncomeActual,
  -190_400_000,
);
assert.equal(
  parseYahooEarningsCandidate(
    {
      quoteSummary: {
        result: [
          {
            currency: "USD",
            incomeStatementHistoryQuarterly: {
              incomeStatementHistory: [
                {
                  endDate: { raw: 1782777600 },
                  totalRevenue: { raw: 582_300_000 },
                  netIncome: { raw: -190_400_000 },
                },
              ],
            },
          },
        ],
      },
    },
    target,
  )?.revenueActual,
  582_300_000,
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

function baseCandidate({
  revenueActual = 582_300_000,
  revenueEstimate = 573_937_500,
  netIncomeActual = -190_400_000,
  netIncomeEstimate = -274_000_000,
} = {}) {
  return {
    ...target,
    provider: "fmp",
    revenueActual,
    revenueEstimate,
    netIncomeActual,
    netIncomeEstimate,
    epsActual: -1.9,
    epsEstimate: netIncomeEstimate === null ? null : -2.74,
    dilutedShares: 100_000_000,
    revenueUnit: "raw",
    netIncomeUnit: "raw",
    epsCurrency: "USD",
    epsUnit: "per-share",
    dilutedSharesUnit: "shares",
    comparison: {
      ...target,
      provider: "fmp",
      generatedAt: "2026-08-15T00:00:00.000Z",
      accountingBasis: "FMP standardized",
      revenue: metric(revenueActual, revenueEstimate),
      netIncome: metric(netIncomeActual, netIncomeEstimate),
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
    assert.equal(url.searchParams.get("from"), "2026-08-12");
    assert.equal(url.searchParams.get("to"), "2026-08-12");
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

const noReportDateUrls = [];
const withoutReportDate = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: {
    ...baseCandidate({ revenueEstimate: null }),
    reportDate: null,
    comparison: { ...baseCandidate({ revenueEstimate: null }).comparison, reportDate: null },
  },
  env: { STOCKS_FINNHUB_API_KEY: "finnhub-secret" },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    noReportDateUrls.push(url);
    return Response.json(finnhubPayload);
  },
});
assert.equal(noReportDateUrls[0]?.searchParams.get("from"), "2026-07-14");
assert.equal(noReportDateUrls[0]?.searchParams.get("to"), "2026-10-28");
assert.equal(withoutReportDate.comparison.revenue.estimate, 573_937_500);

const incompatibleCurrency = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null }),
  env: { STOCKS_FINNHUB_API_KEY: "finnhub-secret" },
  fetchImpl: async () =>
    Response.json({
      earningsCalendar: [
        {
          ...finnhubPayload.earningsCalendar[0],
          currency: "KRW",
          revenueUnit: "raw",
        },
      ],
    }),
});
assert.equal(incompatibleCurrency.comparison.revenue.estimate, null);
assert.ok(incompatibleCurrency.errors.some((error) => /currency/i.test(error)));
assert.ok(
  incompatibleCurrency.errors.every((error) => !error.includes("finnhub-secret")),
);

const yahooUrls = [];
const yahooFallback = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueActual: null, netIncomeActual: null }),
  env: {},
  fetchImpl: async (input) => {
    yahooUrls.push(new URL(String(input)));
    return Response.json({
      quoteSummary: {
        result: [
          {
            incomeStatementHistoryQuarterly: {
              incomeStatementHistory: [
                {
                  endDate: { fmt: "2026-06-30", raw: 1782777600 },
                  totalRevenue: { raw: 582_300_000 },
                  netIncome: { raw: -190_400_000 },
                },
              ],
            },
          },
        ],
      },
    });
  },
});
assert.equal(yahooUrls.length, 1);
assert.equal(yahooFallback.comparison.revenue.actual, 582_300_000);
assert.equal(yahooFallback.comparison.netIncome.actual, -190_400_000);

const eodhdFallback = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: { STOCKS_EODHD_API_KEY: "eodhd-secret" },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "eodhd.com");
    assert.equal(url.searchParams.get("symbols"), "NBIS.US");
    return Response.json(eodhdNestedPayload);
  },
});
assert.equal(eodhdFallback.comparison.revenue.estimate, 573_937_500);
assert.equal(eodhdFallback.comparison.netIncome.estimate, -274_000_000);

const unknownMarket = baseCandidate({ revenueEstimate: null, netIncomeEstimate: null });
delete unknownMarket.market;
const unknownMarketFallback = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: unknownMarket,
  env: { STOCKS_FINNHUB_API_KEY: "finnhub-secret" },
  fetchImpl: async () => Response.json(finnhubPayload),
});
assert.equal(unknownMarketFallback.comparison.revenue.estimate, null);
assert.equal(unknownMarketFallback.comparison.netIncome.estimate, null);
assert.ok(unknownMarketFallback.errors.some((error) => /US listing context/i.test(error)));

const noKeyUrls = [];
const noKeys = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: {},
  fetchImpl: async (input) => {
    noKeyUrls.push(String(input));
    throw new Error("No keyed provider should be requested");
  },
});
assert.equal(noKeyUrls.length, 0);
assert.deepEqual(noKeys.errors, []);

let emptyResultRequests = 0;
const emptyResults = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: { STOCKS_FINNHUB_API_KEY: "finnhub-secret" },
  fetchImpl: async () => {
    emptyResultRequests += 1;
    return Response.json({ earningsCalendar: [] });
  },
});
assert.equal(emptyResultRequests, 1);
assert.deepEqual(emptyResults.errors, []);

const isolatedProviderErrors = await completeStocksEarningsComparison({
  ticker: "NBIS",
  base: baseCandidate({ revenueEstimate: null, netIncomeEstimate: null }),
  env: {
    STOCKS_FINNHUB_API_KEY: "finnhub-secret",
    STOCKS_EODHD_API_KEY: "eodhd-secret",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    return new Response("provider failure", {
      status: url.hostname === "finnhub.io" ? 429 : 400,
    });
  },
});
assert.ok(isolatedProviderErrors.errors.some((error) => /finnhub.*429/i.test(error)));
assert.ok(isolatedProviderErrors.errors.some((error) => /eodhd.*400/i.test(error)));
assert.ok(
  isolatedProviderErrors.errors.every(
    (error) => !error.includes("finnhub-secret") && !error.includes("eodhd-secret"),
  ),
);

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
  currency: "USD",
  revenueActual: null,
  revenueEstimate: null,
  revenueUnit: "raw",
  netIncomeActual: null,
  netIncomeEstimate: null,
  netIncomeUnit: "raw",
  epsActual: null,
  epsEstimate: -2.74,
  epsCurrency: "USD",
  epsUnit: "per-share",
  dilutedShares: 100_000_000,
  dilutedSharesUnit: "shares",
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
const incompatibleEpsBasis = mergeStocksEarningsFallbackCandidate(
  baseCandidate({ netIncomeEstimate: null }),
  { ...derivedCandidate, epsCurrency: "KRW" },
);
assert.equal(incompatibleEpsBasis.comparison.netIncome.estimate, null);
const nonUsdEpsBasis = mergeStocksEarningsFallbackCandidate(
  {
    ...baseCandidate({ netIncomeEstimate: null }),
    currency: "EUR",
    epsCurrency: "EUR",
    comparison: { ...baseCandidate({ netIncomeEstimate: null }).comparison, currency: "EUR" },
  },
  { ...derivedCandidate, currency: "EUR", epsCurrency: "EUR" },
);
assert.equal(nonUsdEpsBasis.comparison.netIncome.estimate, null);
const directWins = mergeStocksEarningsFallbackCandidate(derivedFirst, directCandidate);
assert.equal(directWins.comparison.netIncome.estimate, -260_000_000);
assert.equal(directWins.comparison.netIncome.estimateSource?.method, "direct");
const derivedAfterDirect = mergeStocksEarningsFallbackCandidate(directWins, derivedCandidate);
assert.equal(derivedAfterDirect.comparison.netIncome.estimate, -260_000_000);
assert.equal(derivedAfterDirect.comparison.netIncome.estimateSource?.method, "direct");

console.log("ok - stocks earnings fallback");
