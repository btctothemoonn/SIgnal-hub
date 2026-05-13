import assert from "node:assert/strict";
import {
  ALPHA_RESEARCH_STOCKS,
  getAlphaResearchStockByTicker,
} from "./alpha-research-pool.ts";
import {
  buildMockStocksFinancialSnapshot,
  fetchAlphaVantageStocksFinancialSnapshot,
  fetchFmpStocksFinancialSnapshot,
  getStocksFinancialSnapshot,
  mergeStocksFinancialSnapshot,
  parseAlphaVantageFinancialStatement,
  parseFmpFinancialStatement,
  parseYahooFinancialStatement,
} from "./stocks-financial-data.ts";

const yahooPayload = {
  quoteSummary: {
    result: [
      {
        financialData: {
          totalRevenue: { fmt: "26.04B", raw: 26040000000 },
          revenueGrowth: { fmt: "18.2%", raw: 0.182 },
          grossMargins: { fmt: "74.5%", raw: 0.745 },
          freeCashflow: { fmt: "14.90B", raw: 14900000000 },
        },
        defaultKeyStatistics: {
          trailingEps: { fmt: "6.12", raw: 6.12 },
        },
        calendarEvents: {
          earnings: {
            earningsDate: [{ fmt: "2026-05-22", raw: 1779408000 }],
          },
        },
        earningsTrend: {
          trend: [
            {
              period: "0q",
              earningsEstimate: { avg: { fmt: "6.35" } },
              revenueEstimate: { avg: { fmt: "27.8B" } },
            },
          ],
        },
      },
    ],
  },
};

const parsed = parseYahooFinancialStatement("NVDA", yahooPayload, {
  generatedAt: "2026-05-07T04:00:00.000Z",
});
assert.equal(parsed?.ticker, "NVDA");
assert.equal(parsed?.revenue, "26.04B");
assert.equal(parsed?.revenueYoY, "18.2%");
assert.equal(parsed?.eps, "6.12");
assert.equal(parsed?.grossMargin, "74.5%");
assert.equal(parsed?.freeCashFlow, "14.90B");
assert.equal(parsed?.nextEarningsDate, "2026-05-22");
assert.equal(parsed?.guidance, "Next EPS 6.35 / Revenue 27.8B");
assert.equal(parsed?.periodLabel, "TTM / next quarter");
assert.equal(parsed?.source, "live");

const fmpParsed = parseFmpFinancialStatement(
  "NVDA",
  {
    income: [
      {
        date: "2026-01-31",
        fiscalYear: "2026",
        period: "FY",
        revenue: 26040000000,
        eps: 6.12,
        grossProfitRatio: 0.745,
      },
    ],
    cashFlow: [{ freeCashFlow: 14900000000 }],
    growth: [{ revenueGrowth: 0.182 }],
    estimates: [{ date: "2026-05-22", estimatedEpsAvg: 6.35, estimatedRevenueAvg: 27800000000 }],
  },
  { generatedAt: "2026-05-07T04:00:00.000Z" },
);
assert.equal(fmpParsed?.ticker, "NVDA");
assert.equal(fmpParsed?.revenue, "$26.04B");
assert.equal(fmpParsed?.revenueYoY, "18.2%");
assert.equal(fmpParsed?.eps, "6.12");
assert.equal(fmpParsed?.grossMargin, "74.5%");
assert.equal(fmpParsed?.freeCashFlow, "$14.90B");
assert.equal(fmpParsed?.nextEarningsDate, "2026-05-22");
assert.equal(fmpParsed?.guidance, "Next EPS 6.35 / Revenue $27.80B");
assert.equal(fmpParsed?.periodLabel, "FY 2026");

const alphaVantageParsed = parseAlphaVantageFinancialStatement(
  "NVDA",
  {
    Symbol: "NVDA",
    Name: "NVIDIA",
    RevenueTTM: "26040000000",
    QuarterlyRevenueGrowthYOY: "0.182",
    EPS: "6.12",
    GrossProfitTTM: "19399800000",
    LatestQuarter: "2026-01-31",
    AnalystTargetPrice: "1200.00",
  },
  { generatedAt: "2026-05-07T04:00:00.000Z" },
);
assert.equal(alphaVantageParsed?.ticker, "NVDA");
assert.equal(alphaVantageParsed?.revenue, "$26.04B");
assert.equal(alphaVantageParsed?.revenueYoY, "18.2%");
assert.equal(alphaVantageParsed?.eps, "6.12");
assert.equal(alphaVantageParsed?.grossMargin, "74.5%");
assert.equal(alphaVantageParsed?.nextEarningsDate, "2026-01-31");
assert.equal(alphaVantageParsed?.guidance, "Analyst target $1200.00");

const fmpFinancialUrls = [];
const fmpFinancialSnapshot = await fetchFmpStocksFinancialSnapshot({
  stocks: ALPHA_RESEARCH_STOCKS.slice(0, 2),
  env: {
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FMP_FINANCIAL_MAX_TICKERS: "1",
  },
  fetchImpl: async (url) => {
    fmpFinancialUrls.push(String(url));
    if (String(url).includes("income-statement")) {
      return Response.json([
        {
          date: "2026-01-31",
          fiscalYear: "2026",
          period: "FY",
          revenue: 26040000000,
          eps: 6.12,
          grossProfitRatio: 0.745,
        },
      ]);
    }
    if (String(url).includes("cash-flow-statement")) {
      return Response.json([{ freeCashFlow: 14900000000 }]);
    }
    if (String(url).includes("financial-growth")) {
      return Response.json([{ revenueGrowth: 0.182 }]);
    }
    return Response.json([
      { date: "2026-05-22", estimatedEpsAvg: 6.35, estimatedRevenueAvg: 27800000000 },
    ]);
  },
});
assert.equal(fmpFinancialSnapshot.provider, "fmp");
assert.equal(Object.keys(fmpFinancialSnapshot.financials).length, 1);
assert.equal(fmpFinancialSnapshot.financials.NVDA.revenue, "$26.04B");
assert.ok(fmpFinancialUrls.some((url) => url.includes("income-statement")));

const alphaFinancialUrls = [];
const alphaFinancialSnapshot = await fetchAlphaVantageStocksFinancialSnapshot({
  stocks: ALPHA_RESEARCH_STOCKS.slice(0, 2),
  env: {
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
    STOCKS_ALPHA_VANTAGE_FINANCIAL_MAX_TICKERS: "1",
  },
  fetchImpl: async (url) => {
    alphaFinancialUrls.push(String(url));
    return Response.json({
      Symbol: "NVDA",
      RevenueTTM: "26040000000",
      QuarterlyRevenueGrowthYOY: "0.182",
      EPS: "6.12",
      GrossProfitTTM: "19399800000",
      LatestQuarter: "2026-01-31",
      AnalystTargetPrice: "1200.00",
    });
  },
});
assert.equal(alphaFinancialSnapshot.provider, "alpha-vantage");
assert.equal(Object.keys(alphaFinancialSnapshot.financials).length, 1);
assert.ok(alphaFinancialUrls[0].includes("function=OVERVIEW"));

const financialFallbackSnapshot = await getStocksFinancialSnapshot({
  stocks: [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
  provider: "fmp",
  env: { STOCKS_FMP_API_KEY: "fmp-key" },
  fetchImpl: async (url) => {
    if (String(url).includes("financialmodelingprep.com")) {
      return new Response("rate limit", { status: 429 });
    }
    return Response.json(yahooPayload);
  },
});
assert.equal(financialFallbackSnapshot.provider, "yahoo");
assert.equal(financialFallbackSnapshot.financials.NVDA.revenue, "26.04B");
assert.ok(
  financialFallbackSnapshot.errors.some((error) =>
    error.includes("FMP income-statement HTTP 429") &&
    error.includes("text length="),
  ),
);

const defaultFinancialUrls = [];
const defaultFinancialSnapshot = await getStocksFinancialSnapshot({
  stocks: [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
  env: { STOCKS_FMP_API_KEY: "fmp-key" },
  fetchImpl: async (url) => {
    defaultFinancialUrls.push(String(url));
    assert.ok(!String(url).includes("financialmodelingprep.com"));
    return Response.json(yahooPayload);
  },
});
assert.equal(defaultFinancialSnapshot.provider, "yahoo");
assert.equal(defaultFinancialSnapshot.financials.NVDA.revenue, "26.04B");
assert.ok(defaultFinancialUrls[0].includes("query1.finance.yahoo.com"));

const alphaFallbackSnapshot = await getStocksFinancialSnapshot({
  stocks: [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
  env: { STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key" },
  fetchImpl: async (url) => {
    if (String(url).includes("query1.finance.yahoo.com")) {
      return new Response("forbidden", { status: 403 });
    }
    return Response.json({
      Symbol: "NVDA",
      RevenueTTM: "26040000000",
      QuarterlyRevenueGrowthYOY: "0.182",
      EPS: "6.12",
      GrossProfitTTM: "19399800000",
      LatestQuarter: "2026-01-31",
    });
  },
});
assert.equal(alphaFallbackSnapshot.provider, "alpha-vantage");
assert.equal(alphaFallbackSnapshot.financials.NVDA.revenue, "$26.04B");

await assert.rejects(
  () =>
    fetchFmpStocksFinancialSnapshot({
      stocks: [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
      env: { STOCKS_FMP_API_KEY: "fmp-key" },
      fetchImpl: async () => Response.json([]),
    }),
  (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /FMP financials returned no usable statements/);
    assert.match(error.message, /income-statement array length=0/);
    assert.match(error.message, /cash-flow-statement array length=0/);
    return true;
  },
);

const mockSnapshot = buildMockStocksFinancialSnapshot(
  [getAlphaResearchStockByTicker("NVDA")].filter(Boolean),
);
assert.equal(mockSnapshot.source, "mock");
assert.equal(mockSnapshot.financials.NVDA.source, "mock");

const merged = mergeStocksFinancialSnapshot(ALPHA_RESEARCH_STOCKS, {
  generatedAt: "2026-05-07T04:00:00.000Z",
  source: "live",
  provider: "yahoo",
  errors: [],
  financials: {
    NVDA: parsed,
  },
});

const nvda = merged.find((stock) => stock.ticker === "NVDA");
const tsm = merged.find((stock) => stock.ticker === "TSM");
assert.equal(nvda?.financialSnapshot.revenue, "26.04B");
assert.equal(nvda?.financialSnapshot.source, "live");
assert.equal(tsm?.financialSnapshot.source, undefined);

console.log("ok - stocks financial data");
