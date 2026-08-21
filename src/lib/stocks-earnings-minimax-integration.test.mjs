import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import * as stocksFinancialData from "./stocks-financial-data.ts";
import { clearMiniMaxEarningsSearchMemoryCacheForTests } from "./stocks-earnings-minimax-search.ts";
import {
  getCachedStocksFinancialSnapshot,
  getCachedStocksSnapshot,
  writeStocksSnapshotCache,
} from "./stocks-prewarm.ts";

const { completeCalendarYearEarnings } = stocksFinancialData;

const runtimeDir = await mkdtemp(join(tmpdir(), "signal-hub-minimax-integration-"));
try {
  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const metric = (actual, estimate) => ({
    actual,
    estimate,
    previousYearActual: null,
    estimateYoYPct: null,
    actualYoYPct: null,
    surprise: null,
    surprisePct: null,
  });
  const history = [
    {
      ticker: "TEST",
      fiscalYear: 2026,
      quarter: "Q2",
      fiscalDateEnding: "2026-06-30",
      reportDate: "2026-08-10",
      reportTiming: "after-market",
      currency: "USD",
      accountingBasis: "FMP standardized",
      provider: "fmp",
      generatedAt: "2026-08-20T00:00:00.000Z",
      revenue: metric(2_200_000_000, null),
      netIncome: metric(410_000_000, null),
    },
  ];
  const upcomingHistory = structuredClone(history);
  upcomingHistory[0].ticker = "UPCOMING";
  upcomingHistory[0].status = "incomplete";
  upcomingHistory[0].completeness = {
    complete: false,
    missing: ["revenue-estimate", "net-income-estimate"],
    attemptedProviders: ["fmp"],
  };
  const ordinaryHistory = structuredClone(history);
  ordinaryHistory[0].ticker = "ORDINARY";
  ordinaryHistory[0].status = "incomplete";
  ordinaryHistory[0].completeness = {
    complete: false,
    missing: [
      "revenue-estimate",
      "net-income-estimate",
      "revenue-actual",
    ],
    attemptedProviders: ["fmp"],
  };
  const backfillSnapshot = {
    generatedAt: "2026-08-20T00:00:00.000Z",
    source: "live",
    provider: "fmp",
    errors: [],
    financials: {
      ORDINARY: {
        ticker: "ORDINARY",
        nextEarningsDate: "2026-10-20",
        calendarYearEarnings: ordinaryHistory,
      },
      UPCOMING: {
        ticker: "UPCOMING",
        nextEarningsDate: "2026-08-26",
        calendarYearEarnings: upcomingHistory,
      },
    },
  };
  const selectedBackfillStocks =
    stocksFinancialData.selectMiniMaxEarningsBackfillStocks?.({
      stocks: [
        { ticker: "ORDINARY" },
        { ticker: "UPCOMING" },
      ],
      snapshot: backfillSnapshot,
      now: new Date("2026-08-20T00:00:00.000Z"),
      env: { STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "2" },
    }) ?? [];
  assert.deepEqual(
    selectedBackfillStocks.map((stock) => stock.ticker),
    ["UPCOMING", "ORDINARY"],
  );

  const rotationStocks = ["R1", "R2", "R3", "R4", "R5"].map((ticker) => ({
    ticker,
  }));
  const rotationSnapshot = {
    ...backfillSnapshot,
    financials: Object.fromEntries(
      rotationStocks.map(({ ticker }) => {
        const item = structuredClone(ordinaryHistory[0]);
        item.ticker = ticker;
        return [
          ticker,
          {
            ticker,
            nextEarningsDate: "n/a",
            calendarYearEarnings: [item],
          },
        ];
      }),
    ),
  };
  const rotationEnv = {
    STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "2",
    STOCKS_EARNINGS_MINIMAX_BACKFILL_ROTATION_INTERVAL_MS: String(
      7 * 24 * 60 * 60 * 1000,
    ),
  };
  assert.deepEqual(
    stocksFinancialData
      .selectMiniMaxEarningsBackfillStocks({
        stocks: rotationStocks,
        snapshot: rotationSnapshot,
        now: new Date(0),
        env: rotationEnv,
      })
      .map((stock) => stock.ticker),
    ["R1", "R2"],
  );
  assert.deepEqual(
    stocksFinancialData
      .selectMiniMaxEarningsBackfillStocks({
        stocks: rotationStocks,
        snapshot: rotationSnapshot,
        now: new Date(7 * 24 * 60 * 60 * 1000),
        env: rotationEnv,
      })
      .map((stock) => stock.ticker),
    ["R3", "R4"],
  );

  const missedUpcomingItem = structuredClone(upcomingHistory[0]);
  missedUpcomingItem.ticker = "MISS";
  missedUpcomingItem.reportDate = "2026-08-26";
  missedUpcomingItem.status = "upcoming";
  const missedSnapshot = {
    ...backfillSnapshot,
    financials: {
      MISS: {
        ticker: "MISS",
        nextEarningsDate: "2026-08-26",
        calendarYearEarnings: [missedUpcomingItem],
      },
    },
  };
  const preservedMiss = await stocksFinancialData.backfillMiniMaxEarningsSnapshot({
    stocks: [{ ticker: "MISS", companyName: "Miss Corporation" }],
    snapshot: missedSnapshot,
    now: new Date("2026-08-20T00:00:00.000Z"),
    env: {
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
      STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "1",
    },
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  assert.deepEqual(
    preservedMiss.financials.MISS.calendarYearEarnings,
    [missedUpcomingItem],
  );
  assert.ok(
    preservedMiss.errors.some((error) =>
      error.includes("MISS: MiniMax search HTTP 503"),
    ),
  );

  const questionableItem = structuredClone(history[0]);
  questionableItem.ticker = "QUALITY";
  questionableItem.revenue = metric(10_253_000_000, null);
  questionableItem.netIncome = metric(1_383_000_000, null);
  questionableItem.status = "incomplete";
  questionableItem.completeness = {
    complete: false,
    missing: ["revenue-estimate", "net-income-estimate"],
    attemptedProviders: ["sec"],
  };
  const qualityChecked = await stocksFinancialData.backfillMiniMaxEarningsSnapshot({
    stocks: [{ ticker: "QUALITY", companyName: "Quality Corporation" }],
    snapshot: {
      ...backfillSnapshot,
      financials: {
        QUALITY: {
          ticker: "QUALITY",
          nextEarningsDate: "2026-11-01",
          calendarYearEarnings: [questionableItem],
        },
      },
    },
    now: new Date("2026-08-20T00:00:00.000Z"),
    env: {
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
      STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "1",
    },
    fetchImpl: async (input) => {
      if (String(input).endsWith("/v1/coding_plan/search")) {
        return Response.json({
          organic: [
            {
              title: "QUALITY Q2 2026 earnings",
              link: "https://finance.example.com/quality-q2-estimates",
              snippet:
                "QUALITY Q2 2026 revenue was expected at $5.80 billion and net income was expected at $1.383 billion.",
            },
            {
              title: "QUALITY Q2 2026 results",
              link: "https://finance.example.com/quality-q2-results",
              snippet:
                "QUALITY Q2 2026 revenue actual reported was $10.253 billion and net income actual reported was $1.380 billion.",
            },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        });
      }
      return new Response("unavailable", { status: 503 });
    },
  });
  const qualityCheckedItem =
    qualityChecked.financials.QUALITY.calendarYearEarnings[0];
  assert.equal(qualityCheckedItem.revenue.estimate, null);
  assert.equal(qualityCheckedItem.netIncome.estimate, null);
  assert.deepEqual(qualityCheckedItem.completeness.missing, [
    "revenue-estimate",
    "net-income-estimate",
  ]);

  const staleMiniMaxItem = structuredClone(history[0]);
  staleMiniMaxItem.ticker = "STALE";
  staleMiniMaxItem.revenue = metric(10_253_000_000, 5_800_000_000);
  staleMiniMaxItem.revenue.estimateSource = { provider: "minimax-web" };
  staleMiniMaxItem.netIncome = metric(1_383_000_000, 1_383_000_000);
  staleMiniMaxItem.netIncome.estimateSource = { provider: "minimax-web" };
  staleMiniMaxItem.status = "reported";
  staleMiniMaxItem.completeness = {
    complete: true,
    missing: [],
    attemptedProviders: ["sec", "minimax-web"],
  };
  const scrubbedSnapshot = await stocksFinancialData.backfillMiniMaxEarningsSnapshot({
    stocks: [{ ticker: "STALE", companyName: "Stale Corporation" }],
    snapshot: {
      ...backfillSnapshot,
      financials: {
        STALE: {
          ticker: "STALE",
          nextEarningsDate: "2026-11-01",
          calendarYearEarnings: [staleMiniMaxItem],
        },
      },
    },
    now: new Date("2026-08-20T00:00:00.000Z"),
    env: {},
  });
  const scrubbedItem =
    scrubbedSnapshot.financials.STALE.calendarYearEarnings[0];
  assert.equal(scrubbedItem.revenue.estimate, null);
  assert.equal(scrubbedItem.netIncome.estimate, null);
  assert.equal(scrubbedItem.completeness.complete, false);
  await writeStocksSnapshotCache({
    kind: "financial",
    env: { SIGNAL_HUB_RUNTIME_DIR: runtimeDir },
    snapshot: {
      ...backfillSnapshot,
      financials: {
        STALE: {
          ticker: "STALE",
          nextEarningsDate: "2026-11-01",
          calendarYearEarnings: [staleMiniMaxItem],
        },
      },
    },
  });
  const persistedScrub = await getCachedStocksSnapshot({
    kind: "financial",
    env: { SIGNAL_HUB_RUNTIME_DIR: runtimeDir },
    force: true,
    mergeCached: false,
    loader: async () => scrubbedSnapshot,
  });
  assert.equal(
    persistedScrub.financials.STALE.calendarYearEarnings[0].revenue.estimate,
    null,
  );
  assert.equal(
    persistedScrub.financials.STALE.calendarYearEarnings[0].netIncome.estimate,
    null,
  );

  const backfilledSnapshot =
    (await stocksFinancialData.backfillMiniMaxEarningsSnapshot?.({
      stocks: [{ ticker: "ORDINARY", companyName: "Ordinary Corporation" }],
      snapshot: {
        ...backfillSnapshot,
        financials: { ORDINARY: backfillSnapshot.financials.ORDINARY },
      },
      now: new Date("2026-08-20T00:00:00.000Z"),
      env: {
        MINIMAX_API_KEY: "sk-cp-test",
        AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
        SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
        STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "1",
      },
      fetchImpl: async (input) => {
        if (String(input).endsWith("/v1/coding_plan/search")) {
          return Response.json({
            organic: [
              {
                title: "ORDINARY Q2 2026 earnings consensus",
                link: "https://finance.example.com/ordinary-q2",
                snippet:
                  "ORDINARY Q2 2026 revenue consensus was $2.10 billion and net income consensus was $390 million.",
              },
            ],
            base_resp: { status_code: 0, status_msg: "success" },
          });
        }
        return new Response("unavailable", { status: 503 });
      },
    })) ?? backfillSnapshot;
  const backfilledItem =
    backfilledSnapshot.financials.ORDINARY.calendarYearEarnings[0];
  assert.equal(backfilledItem.revenue.estimate, 2_100_000_000);
  assert.equal(backfilledItem.netIncome.estimate, 390_000_000);
  assert.equal(backfilledItem.completeness.complete, true);

  await writeStocksSnapshotCache({
    kind: "financial",
    env: { SIGNAL_HUB_RUNTIME_DIR: runtimeDir },
    snapshot: {
      ...backfillSnapshot,
      financials: { ORDINARY: backfillSnapshot.financials.ORDINARY },
    },
  });
  const stockTemplate = getAlphaResearchStockByTicker("NVDA");
  assert.ok(stockTemplate);
  const ordinaryStock = {
    ...structuredClone(stockTemplate),
    ticker: "ORDINARY",
    companyName: "Ordinary Corporation",
  };
  const fmpUrls = [];
  const cachedBackfill = await getCachedStocksFinancialSnapshot({
    stocks: [stockTemplate, ordinaryStock],
    force: true,
    provider: "fmp",
    env: {
      STOCKS_FMP_API_KEY: "fmp-key",
      STOCKS_FMP_FINANCIAL_TICKERS: "NVDA",
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
      STOCKS_EARNINGS_MINIMAX_BACKFILL_BATCH_SIZE: "1",
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("financialmodelingprep.com")) {
        fmpUrls.push(url);
        if (url.includes("income-statement")) {
          return Response.json([
            {
              date: "2026-01-31",
              fiscalYear: "2026",
              period: "FY",
              revenue: 26_040_000_000,
              eps: 6.12,
              grossProfitRatio: 0.745,
            },
          ]);
        }
        if (url.includes("cash-flow-statement")) {
          return Response.json([{ freeCashFlow: 14_900_000_000 }]);
        }
        if (url.includes("financial-growth")) {
          return Response.json([{ revenueGrowth: 0.182 }]);
        }
        return Response.json([]);
      }
      if (url.endsWith("/v1/coding_plan/search")) {
        return Response.json({
          organic: [
            {
              title: "ORDINARY Q2 2026 earnings consensus",
              link: "https://finance.example.com/ordinary-q2",
              snippet:
                "ORDINARY Q2 2026 revenue consensus was $2.10 billion and net income consensus was $390 million.",
            },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        });
      }
      return new Response("unavailable", { status: 503 });
    },
  });
  const cachedBackfillItem =
    cachedBackfill.financials.ORDINARY.calendarYearEarnings[0];
  assert.equal(cachedBackfillItem.revenue.estimate, 2_100_000_000);
  assert.equal(cachedBackfillItem.netIncome.estimate, 390_000_000);
  assert.ok(fmpUrls.length > 0);
  assert.equal(fmpUrls.some((url) => url.includes("symbol=ORDINARY")), false);
  const result = await completeCalendarYearEarnings({
    stock: {
      ticker: "TEST",
      companyName: "Test Corporation",
      companyNameZh: "测试公司",
      listing: { market: "US", exchange: "NASDAQ", currency: "USD" },
    },
    apiHistory: history,
    now: new Date("2026-08-20T00:00:00.000Z"),
    env: {
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/coding_plan/search")) {
        return Response.json({
          organic: [
            {
              title: "TEST Q2 consensus",
              link: "https://finance.example.com/test-q2",
              snippet:
                "TEST Q2 2026 revenue consensus was $2.10 billion and net income consensus was $390 million.",
            },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  periods: [
                    {
                      fiscalYear: 2026,
                      quarter: "Q2",
                      currency: "USD",
                      revenueEstimate: {
                        value: 2_100_000_000,
                        sourceValue: "$2.10 billion",
                        sourceUrl: "https://finance.example.com/test-q2",
                      },
                      netIncomeEstimate: {
                        value: 390_000_000,
                        sourceValue: "$390 million",
                        sourceUrl: "https://finance.example.com/test-q2",
                      },
                    },
                  ],
                }),
              },
            },
          ],
        });
      }
      return new Response("unavailable", { status: 503 });
    },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].completeness.complete, true);
  assert.equal(result.items[0].revenue.estimate, 2_100_000_000);
  assert.equal(result.items[0].netIncome.estimate, 390_000_000);
  assert.equal(result.items[0].revenue.estimateSource.provider, "minimax-web");
  assert.equal(result.items[0].netIncome.estimateSource.provider, "minimax-web");
} finally {
  await rm(runtimeDir, { recursive: true, force: true });
}

console.log("ok - MiniMax earnings fallback integration");
