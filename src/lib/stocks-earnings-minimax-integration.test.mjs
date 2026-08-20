import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeCalendarYearEarnings } from "./stocks-financial-data.ts";
import { clearMiniMaxEarningsSearchMemoryCacheForTests } from "./stocks-earnings-minimax-search.ts";

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
