import assert from "node:assert/strict";
import { fetchFmpStocksFinancialSnapshot } from "./stocks-financial-data.ts";

const stocks = ["NBIS", "CBRS", "NVDA", "AMD"].map((ticker) => ({ ticker }));
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

console.log("ok - stocks FMP quarterly transport");
