import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearMiniMaxEarningsSearchMemoryCacheForTests,
  fetchMiniMaxEarningsCandidates,
  getMiniMaxEarningsSearchTimeoutMs,
} from "./stocks-earnings-minimax-search.ts";

assert.equal(getMiniMaxEarningsSearchTimeoutMs({}), 55_000);
assert.equal(
  getMiniMaxEarningsSearchTimeoutMs({
    STOCKS_EARNINGS_MINIMAX_TIMEOUT_MS: "90000",
  }),
  60_000,
);

const stock = {
  ticker: "NVDA",
  companyName: "NVIDIA",
  companyNameZh: "英伟达",
  listing: { market: "US", exchange: "NASDAQ", currency: "USD" },
};

function metric(actual, estimate) {
  return {
    actual,
    estimate,
    previousYearActual: null,
    estimateYoYPct: null,
    actualYoYPct: null,
    surprise: null,
    surprisePct: null,
  };
}

const comparisons = [
  {
    ticker: "NVDA",
    fiscalYear: 2027,
    quarter: "Q1",
    fiscalDateEnding: "2026-04-26",
    reportDate: "2026-05-20",
    reportTiming: "after-market",
    currency: "USD",
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt: "2026-08-20T00:00:00.000Z",
    revenue: metric(81_615_000_000, null),
    netIncome: metric(58_321_000_000, null),
  },
  {
    ticker: "NVDA",
    fiscalYear: 2027,
    quarter: "Q2",
    fiscalDateEnding: "2026-07-27",
    reportDate: "2026-08-26",
    reportTiming: "after-market",
    currency: "USD",
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt: "2026-08-20T00:00:00.000Z",
    revenue: metric(null, null),
    netIncome: metric(null, null),
  },
];

const searchPayload = {
  organic: [
    {
      title: "NVIDIA quarterly earnings consensus",
      link: "https://finance.example.com/nvda-q2",
      snippet:
        "For fiscal Q2 2027, revenue consensus is $93.63 billion and net income consensus is $51.20 billion.",
      date: "2026-08-20",
    },
  ],
  base_resp: { status_code: 0, status_msg: "success" },
};

const extractionPayload = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          periods: [
            {
              fiscalYear: 2027,
              quarter: "Q2",
              reportDate: "2026-08-26",
              currency: "USD",
              revenueEstimate: {
                value: 93_630_000_000,
                sourceValue: "$93.63 billion",
                sourceUrl: "https://finance.example.com/nvda-q2",
              },
              revenueActual: null,
              netIncomeEstimate: {
                value: 51_200_000_000,
                sourceValue: "$51.20 billion",
                sourceUrl: "https://finance.example.com/nvda-q2",
              },
              netIncomeActual: null,
            },
          ],
        }),
      },
    },
  ],
};

const cacheDir = await mkdtemp(join(tmpdir(), "signal-hub-minimax-search-"));
try {
  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const calls = [];
  const result = await fetchMiniMaxEarningsCandidates({
    stock,
    comparisons,
    now: new Date("2026-08-20T00:00:00.000Z"),
    cacheDir,
    env: {
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      AI_SUMMARY_MODEL: "MiniMax-M2.7",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/coding_plan/search")) {
        return Response.json(searchPayload);
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json(extractionPayload);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  assert.equal(calls.filter((call) => call.url.includes("coding_plan/search")).length, 2);
  assert.equal(calls.filter((call) => call.url.includes("chat/completions")).length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].quarter, "Q2");
  assert.equal(result.candidates[0].revenueEstimate, 93_630_000_000);
  assert.equal(result.candidates[0].netIncomeEstimate, 51_200_000_000);
  assert.equal(result.candidates[0].fieldSources.revenueEstimate.provider, "minimax-web");
  assert.equal(result.candidates[0].fieldSources.netIncomeEstimate.url, "https://finance.example.com/nvda-q2");

  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const cached = await fetchMiniMaxEarningsCandidates({
    stock,
    comparisons,
    now: new Date("2026-08-20T12:00:00.000Z"),
    cacheDir,
    env: {
      MINIMAX_API_KEY: "sk-cp-test",
      AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    },
    fetchImpl: async () => {
      throw new Error("cache should prevent another MiniMax request");
    },
  });
  assert.equal(cached.candidates[0].revenueEstimate, 93_630_000_000);

  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const invalidSourceDir = await mkdtemp(join(tmpdir(), "signal-hub-minimax-invalid-"));
  try {
    const invalid = await fetchMiniMaxEarningsCandidates({
      stock,
      comparisons,
      now: new Date("2026-08-20T00:00:00.000Z"),
      cacheDir: invalidSourceDir,
      env: {
        MINIMAX_API_KEY: "sk-cp-test",
        AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      },
      fetchImpl: async (url) =>
        String(url).endsWith("/v1/coding_plan/search")
          ? Response.json(searchPayload)
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      periods: [
                        {
                          fiscalYear: 2027,
                          quarter: "Q2",
                          currency: "USD",
                          revenueEstimate: {
                            value: 99_000_000_000,
                            sourceValue: "$99 billion",
                            sourceUrl: "https://invented.example.com/value",
                          },
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
    });
    assert.deepEqual(invalid.candidates, []);
    assert.equal(
      invalid.errors.some((error) => error.includes("usable sourced values")),
      true,
    );
  } finally {
    await rm(invalidSourceDir, { recursive: true, force: true });
  }

  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const boundedInputDir = await mkdtemp(
    join(tmpdir(), "signal-hub-minimax-bounded-input-"),
  );
  try {
    let extractionHits = [];
    await fetchMiniMaxEarningsCandidates({
      stock,
      comparisons,
      now: new Date("2026-08-20T00:00:00.000Z"),
      cacheDir: boundedInputDir,
      env: {
        MINIMAX_API_KEY: "sk-cp-test",
        AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      },
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/v1/coding_plan/search")) {
          const query = JSON.parse(String(init?.body)).q;
          const quarter = query.includes("Q2") ? "Q2" : "Q1";
          return Response.json({
            organic: Array.from({ length: 7 }, (_, index) => ({
              title:
                index === 6
                  ? `NVIDIA fiscal 2027 ${quarter} revenue and net income estimates`
                  : `NVIDIA general article ${quarter} ${index}`,
              link: `https://finance.example.com/${quarter.toLowerCase()}-${index}`,
              snippet:
                index === 6
                  ? `${quarter} fiscal 2027 revenue consensus is $93.63 billion and net income consensus is $51.20 billion.`
                  : `${quarter} background ${index} ${"x".repeat(3_000)}`,
              date: "2026-08-20",
            })),
            base_resp: { status_code: 0, status_msg: "success" },
          });
        }
        const body = JSON.parse(String(init?.body));
        const marker = "\nSEARCH_RESULTS=";
        const prompt = body.messages[1].content;
        extractionHits = JSON.parse(
          prompt.slice(prompt.lastIndexOf(marker) + marker.length),
        );
        return Response.json({
          choices: [{ message: { content: '{"periods":[]}' } }],
        });
      },
    });
    assert.equal(extractionHits.length <= 6, true);
    assert.equal(extractionHits.every((hit) => hit.snippet.length <= 1_800), true);
    assert.equal(
      extractionHits.some((hit) => hit.link.endsWith("/q2-6")),
      true,
    );
    assert.equal(
      extractionHits.some((hit) => hit.link.endsWith("/q1-6")),
      true,
    );
  } finally {
    await rm(boundedInputDir, { recursive: true, force: true });
  }

  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const reasoningDir = await mkdtemp(
    join(tmpdir(), "signal-hub-minimax-reasoning-"),
  );
  try {
    const reasoning = await fetchMiniMaxEarningsCandidates({
      stock,
      comparisons,
      now: new Date("2026-08-20T00:00:00.000Z"),
      cacheDir: reasoningDir,
      env: {
        MINIMAX_API_KEY: "sk-cp-test",
        AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
      },
      fetchImpl: async (url) =>
        String(url).endsWith("/v1/coding_plan/search")
          ? Response.json(searchPayload)
          : Response.json({
              choices: [
                {
                  message: {
                    content: `<think>Check every cited field.</think>\n\`\`\`json\n${extractionPayload.choices[0].message.content}\n\`\`\``,
                  },
                },
              ],
            }),
    });
    assert.equal(reasoning.candidates.length, 1);
    assert.equal(reasoning.candidates[0].revenueEstimate, 93_630_000_000);
  } finally {
    await rm(reasoningDir, { recursive: true, force: true });
  }

  clearMiniMaxEarningsSearchMemoryCacheForTests();
  const disabled = await fetchMiniMaxEarningsCandidates({
    stock,
    comparisons,
    now: new Date("2026-08-20T00:00:00.000Z"),
    cacheDir,
    env: {},
    fetchImpl: async () => {
      throw new Error("disabled search should not make requests");
    },
  });
  assert.deepEqual(disabled.candidates, []);
  assert.deepEqual(disabled.errors, []);
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log("ok - MiniMax earnings web fallback");
