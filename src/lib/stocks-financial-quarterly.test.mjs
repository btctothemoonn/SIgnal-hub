import assert from "node:assert/strict";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import { fetchFmpStocksFinancialSnapshot } from "./stocks-financial-data.ts";

const nbisStock = getAlphaResearchStockByTicker("NBIS");
assert.ok(nbisStock);

const stocks = ["NBIS", "CBRS", "NVDA", "AMD"].map((ticker) => ({
  ticker,
  marketCode: "US",
}));
const urls = [];
let activeIncomeRequests = 0;
let maxActiveIncomeRequests = 0;

function incomeRows(symbol) {
  return [
    {
      date: "2026-06-30",
      fiscalYear: "2026",
      period: "Q2",
      reportedCurrency: "USD",
      revenue: symbol === "NBIS" ? 582_300_000 : 200_000_000,
      netIncome: symbol === "NBIS" ? -190_400_000 : 20_000_000,
      eps: 0.25,
      grossProfitRatio: 0.5,
    },
    {
      date: "2025-06-30",
      fiscalYear: "2025",
      period: "Q2",
      reportedCurrency: "USD",
      revenue: 105_100_000,
      netIncome: -143_600_000,
      eps: -0.2,
    },
  ];
}

const snapshot = await fetchFmpStocksFinancialSnapshot({
  stocks,
  env: {
    STOCKS_FMP_API_KEYS: "fmp-a,fmp-b",
    STOCKS_FMP_FINANCIAL_CONCURRENCY: "3",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const endpoint = url.pathname.split("/").at(-1);
    const symbol = url.searchParams.get("symbol");
    if (endpoint === "income-statement") {
      activeIncomeRequests += 1;
      maxActiveIncomeRequests = Math.max(
        maxActiveIncomeRequests,
        activeIncomeRequests,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeIncomeRequests -= 1;
      return Response.json(incomeRows(symbol));
    }
    if (endpoint === "analyst-estimates") {
      return Response.json([
        {
          date: "2026-06-30",
          fiscalYear: "2026",
          period: "Q2",
          estimatedRevenueAvg: symbol === "NBIS" ? 573_937_500 : 190_000_000,
          estimatedNetIncomeAvg: symbol === "NBIS" ? -273_800_000 : 18_000_000,
          estimatedEpsAvg: 0.23,
        },
      ]);
    }
    if (endpoint === "earnings") {
      return Response.json([
        {
          date: "2026-08-12",
          fiscalDateEnding: "2026-06-30",
          time: "bmo",
        },
      ]);
    }
    if (endpoint === "cash-flow-statement") {
      return Response.json([{ freeCashFlow: 50_000_000 }]);
    }
    if (endpoint === "financial-growth") {
      return Response.json([{ revenueGrowth: 0.25 }]);
    }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  },
});

assert.equal(Object.keys(snapshot.financials).length, stocks.length);
assert.ok(maxActiveIncomeRequests <= 3);
const incomeUrl = urls.find(
  (url) =>
    url.pathname.endsWith("income-statement") &&
    url.searchParams.get("symbol") === "NBIS",
);
const estimatesUrl = urls.find((url) =>
  url.pathname.endsWith("analyst-estimates"),
);
const earningsUrl = urls.find((url) => url.pathname.endsWith("earnings"));
assert.ok(incomeUrl);
assert.equal(incomeUrl.searchParams.get("period"), "quarter");
assert.equal(incomeUrl.searchParams.get("limit"), "5");
assert.equal(estimatesUrl?.searchParams.get("period"), "quarter");
assert.equal(estimatesUrl?.searchParams.get("limit"), "5");
assert.equal(earningsUrl?.searchParams.get("limit"), "5");
assert.equal(snapshot.financials.NBIS.latestEarnings.revenue.actual, 582_300_000);
assert.equal(snapshot.financials.NBIS.latestEarnings.revenue.estimate, 573_937_500);
assert.equal(snapshot.financials.NBIS.latestEarnings.netIncome.surprise, 83_400_000);
assert.equal(snapshot.financials.NBIS.earningsHistory.length, 2);

let incomeAttempts = 0;
const retried = await fetchFmpStocksFinancialSnapshot({
  stocks: stocks.slice(0, 1),
  env: { STOCKS_FMP_API_KEYS: "retry-a,retry-b" },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "income-statement") {
      incomeAttempts += 1;
      if (incomeAttempts === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return Response.json(incomeRows("NBIS"));
    }
    if (endpoint === "analyst-estimates") return Response.json([]);
    if (endpoint === "earnings") return Response.json([]);
    return Response.json([]);
  },
});
assert.equal(incomeAttempts, 2);
assert.equal(retried.financials.NBIS.latestEarnings.revenue.actual, 582_300_000);

let estimateAttempts = 0;
const restricted = await fetchFmpStocksFinancialSnapshot({
  stocks: stocks.slice(0, 1),
  env: { STOCKS_FMP_API_KEY: "secret-plan-key" },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "income-statement") {
      return Response.json(incomeRows("NBIS"));
    }
    if (endpoint === "analyst-estimates") {
      estimateAttempts += 1;
      return new Response("upgrade plan", { status: 402 });
    }
    return Response.json([]);
  },
});
assert.equal(estimateAttempts, 1);
assert.equal(restricted.financials.NBIS.latestEarnings.revenue.actual, 582_300_000);
assert.equal(restricted.financials.NBIS.latestEarnings.revenue.estimate, null);
assert.ok(restricted.errors.some((error) => /analyst-estimates HTTP 402/.test(error)));
assert.ok(restricted.errors.every((error) => !error.includes("secret-plan-key")));

const completedAfterEstimateRestriction = await fetchFmpStocksFinancialSnapshot({
  stocks: [nbisStock],
  env: {
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (url.hostname === "finnhub.io") {
      return Response.json({
        earningsCalendar: [
          {
            symbol: "NBIS",
            fiscalYear: 2026,
            fiscalPeriod: "2026Q2",
            fiscalDateEnding: "2026-06-30",
            date: "2026-08-12",
            revenueEstimate: 573_937_500,
            epsEstimate: -2.74,
          },
        ],
      });
    }
    if (endpoint === "income-statement") {
      return Response.json(
        incomeRows("NBIS").map((row, index) => ({
          ...row,
          date: index === 0 ? "2026-06-29" : row.date,
          fiscalDateEnding: index === 0 ? "2026-06-30" : undefined,
          weightedAverageShsOutDil: 100_000_000,
        })),
      );
    }
    if (endpoint === "analyst-estimates") {
      return new Response("upgrade plan", { status: 402 });
    }
    if (endpoint === "earnings") {
      return Response.json([
        {
          date: "2026-08-12",
          fiscalDateEnding: "2026-06-30",
          time: "bmo",
        },
      ]);
    }
    return Response.json([]);
  },
});
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.latestEarnings.revenue.estimate,
  573_937_500,
);
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.latestEarnings.revenue
    .estimateSource.provider,
  "finnhub",
);
assert.ok(
  Math.abs(
    completedAfterEstimateRestriction.financials.NBIS.latestEarnings.revenue
      .surprisePct - 1.45704,
  ) < 0.00001,
);
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.latestEarnings.revenue
    .estimateSource.accountingBasis,
  "Unspecified accounting basis",
);
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.latestEarnings.revenue
    .estimateSource.semantics,
  "consensus-estimate",
);
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.latestEarnings.netIncome
    .estimateSource.method,
  "eps-times-diluted-shares",
);
assert.equal(
  completedAfterEstimateRestriction.financials.NBIS.earningsHistory[0].revenue
    .estimateSource.provider,
  "finnhub",
);

let historyFinnhubRequests = 0;
const completedHistory = await fetchFmpStocksFinancialSnapshot({
  stocks: [nbisStock],
  env: {
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (url.hostname === "finnhub.io") {
      historyFinnhubRequests += 1;
      return Response.json({
        earningsCalendar: [
          {
            symbol: "NBIS",
            fiscalYear: 2026,
            fiscalPeriod: "2026Q2",
            fiscalDateEnding: "2026-06-30",
            date: "2026-08-12",
            revenueEstimate: 573_937_500,
            epsEstimate: -2.74,
          },
          {
            symbol: "NBIS",
            fiscalYear: 2026,
            fiscalPeriod: "2026Q1",
            fiscalDateEnding: "2026-03-31",
            date: "2026-05-12",
            revenueEstimate: 410_000_000,
            epsEstimate: -1.8,
          },
        ],
      });
    }
    if (endpoint === "income-statement") {
      return Response.json([
        {
          date: "2026-06-29",
          fiscalDateEnding: "2026-06-30",
          fiscalYear: "2026",
          period: "Q2",
          reportedCurrency: "USD",
          revenue: 582_300_000,
          netIncome: -190_400_000,
          weightedAverageShsOutDil: 100_000_000,
        },
        {
          date: "2026-03-31",
          fiscalYear: "2026",
          period: "Q1",
          reportedCurrency: "USD",
          revenue: 420_000_000,
          netIncome: -180_000_000,
          weightedAverageShsOutDil: 100_000_000,
        },
      ]);
    }
    if (endpoint === "analyst-estimates") {
      return new Response("upgrade plan", { status: 402 });
    }
    if (endpoint === "earnings") {
      return Response.json([
        {
          date: "2026-08-12",
          fiscalDateEnding: "2026-06-30",
          time: "bmo",
        },
        {
          date: "2026-05-12",
          fiscalDateEnding: "2026-03-31",
          time: "bmo",
        },
      ]);
    }
    return Response.json([]);
  },
});
assert.equal(completedHistory.financials.NBIS.earningsHistory.length, 2);
assert.equal(
  completedHistory.financials.NBIS.earningsHistory[0].revenue.estimate,
  573_937_500,
);
assert.equal(
  completedHistory.financials.NBIS.earningsHistory[1].revenue.estimate,
  410_000_000,
);
assert.equal(
  completedHistory.financials.NBIS.earningsHistory[1].netIncome.estimate,
  -180_000_000,
);
assert.equal(historyFinnhubRequests, 1);

const fourQuarterRows = [
  ["Q4", "2026-12-31", 640_000_000, -160_000_000],
  ["Q3", "2026-09-30", 610_000_000, -170_000_000],
  ["Q2", "2026-06-30", 582_300_000, -190_400_000],
  ["Q1", "2026-03-31", 420_000_000, -180_000_000],
].map(([period, fiscalDateEnding, revenue, netIncome]) => ({
  date: fiscalDateEnding,
  fiscalDateEnding,
  fiscalYear: "2026",
  period,
  reportedCurrency: "USD",
  revenue,
  netIncome,
  weightedAverageShsOutDil: 100_000_000,
}));

let terminalFinnhubRequests = 0;
const terminalFinnhubSnapshot = await fetchFmpStocksFinancialSnapshot({
  stocks: [nbisStock],
  env: {
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (url.hostname === "finnhub.io") {
      terminalFinnhubRequests += 1;
      return new Response("plan restricted", { status: 402 });
    }
    if (endpoint === "income-statement") return Response.json(fourQuarterRows);
    if (endpoint === "analyst-estimates") {
      return new Response("upgrade plan", { status: 402 });
    }
    return Response.json([]);
  },
});
assert.equal(terminalFinnhubSnapshot.financials.NBIS.earningsHistory.length, 4);
assert.equal(terminalFinnhubRequests, 1);
assert.equal(
  terminalFinnhubSnapshot.errors.filter((error) =>
    error.includes("finnhub calendar/earnings HTTP 402"),
  ).length,
  1,
);

const fiveQuarterRows = [
  ...fourQuarterRows,
  {
    date: "2025-12-31",
    fiscalDateEnding: "2025-12-31",
    fiscalYear: "2025",
    period: "Q4",
    reportedCurrency: "USD",
    revenue: 390_000_000,
    netIncome: -210_000_000,
    weightedAverageShsOutDil: 100_000_000,
  },
];
const boundedFinnhubUrls = [];
await fetchFmpStocksFinancialSnapshot({
  stocks: [nbisStock],
  env: {
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").at(-1);
    if (url.hostname === "finnhub.io") {
      boundedFinnhubUrls.push(url);
      return Response.json({
        earningsCalendar: [
          {
            symbol: "NBIS",
            fiscalYear: 2026,
            fiscalPeriod: "2026Q1",
            fiscalDateEnding: "2026-03-31",
          },
        ],
      });
    }
    if (endpoint === "income-statement") return Response.json(fiveQuarterRows);
    if (endpoint === "analyst-estimates") {
      return new Response("upgrade plan", { status: 402 });
    }
    return Response.json([]);
  },
});
assert.equal(boundedFinnhubUrls.length, 1);
assert.equal(boundedFinnhubUrls[0].searchParams.get("from"), "2026-01-14");
assert.equal(boundedFinnhubUrls[0].searchParams.get("to"), "2027-04-30");

console.log("ok - stocks FMP quarterly transport");
