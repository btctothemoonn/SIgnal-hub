import assert from "node:assert/strict";

const { explainMarketOpportunities } = await import("./market-opportunity-ai.ts");

function decision(symbol, direction = "LONG") {
  return {
    symbol,
    model: direction === "LONG" ? "capital_long" : "distribution_short",
    direction,
    stage: direction === "LONG" ? "拉盘做多确认" : "做空结构确认",
    decision: direction === "LONG" ? "关注做多" : "关注做空",
    score: 86,
    confidence: 84,
    evidence: ["价格、成交和 OI 同向"],
    confirmations: ["等待回踩不破"],
    invalidations: ["跌破启动结构"],
    risks: ["短线波动较大"],
    mandatoryComplete: true,
    hardInvalidated: false,
    dataCoverage: 96,
    metrics: {
      symbol,
      observedAt: "2026-09-04T05:00:00.000Z",
      stale: false,
      pct1m: 1.2,
      pct5m: 3.2,
      pct15m: 6.4,
      pct1h: 11.5,
      pct24h: 18,
      volumeRatio1m: 2.2,
      volumeRatio5m: 2.8,
      oiGrowth15m: 8.2,
      oiNotional: 8_000_000,
      funding: 0.0001,
      basis: -0.0002,
      globalLongShortRatio: 1.02,
      topTraderLongShortRatio: 1.04,
      takerBuySellRatio: 1.34,
      spotAvailable: true,
      spotChange15m: 5.8,
      spotVolumeRatio5m: 2.1,
      perpSpotDivergencePct: 0.6,
      distanceFromHighPct: -1.2,
      distanceFromLowPct: 16,
      priorRunUpPct: 24,
      supportBreak: false,
      lowerStructure: false,
      breakout20: true,
      quoteVolume: 80_000_000,
      marketCapUsd: 120_000_000,
      fdvUsd: 140_000_000,
      alertCounts: { pump: 3, crash: 0, squeeze: 0, total: 3 },
    },
    observedAt: "2026-09-04T05:00:00.000Z",
    expiresAt: "2026-09-04T17:00:00.000Z",
  };
}

const topFive = [decision("AAAUSDT"), decision("BBBUSDT", "SHORT")];
const providers = [
  { id: "minimax", baseUrl: "https://api.minimaxi.com/v1", apiKey: "mini-key", model: "MiniMax-M2.7" },
  { id: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "deep-key", model: "deepseek-v4-flash" },
];

function validItems() {
  return topFive.map((item) => ({
    symbol: item.symbol,
    summary: item.direction === "LONG" ? "等待回踩确认后关注做多。" : "等待弱反弹确认后关注做空。",
    rationale: "价格、成交与持仓结构支持规则分类。",
    confirmation: "启动结构保持有效。",
    invalidation: "反向突破启动区间。",
    risk: "短线波动和流动性风险。",
    validFor: "2 小时内复核。",
  }));
}

let calls = 0;
let receivedPrompt = "";
const fallbackResult = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "fallback-fingerprint",
  policy: { allowed: true, reason: "allowed", retryAt: null },
  providers,
  fetchImpl: async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    receivedPrompt = body.messages.at(-1).content;
    if (calls === 1) {
      return Response.json(
        { error: { message: "weekly usage limit reached" } },
        { status: 429 },
      );
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ items: validItems() }) } }],
    });
  },
});
assert.equal(fallbackResult.status, "generated");
assert.equal(fallbackResult.provider, "deepseek");
assert.equal(fallbackResult.items?.length, 2);
assert.equal(calls, 2);
assert.match(receivedPrompt, /AAAUSDT/);
assert.match(receivedPrompt, /BBBUSDT/);

const thinkingWrapped = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "thinking-wrapped-fingerprint",
  policy: { allowed: true, reason: "allowed", retryAt: null },
  providers: [{ ...providers[0], model: "MiniMax-M2.7-thinking" }],
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: [
      "<think>先核对规则，不改变原始方向。</think>",
      "```json",
      JSON.stringify({ items: validItems() }),
      "```",
      "以上为结构化解释。",
    ].join("\n") } }],
  }),
});
assert.equal(thinkingWrapped.status, "generated");
assert.equal(thinkingWrapped.items?.length, 2);

let skippedCalls = 0;
const skipped = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "blocked-fingerprint",
  policy: { allowed: false, reason: "cooldown", retryAt: "2026-09-04T05:10:00.000Z" },
  providers,
  fetchImpl: async () => {
    skippedCalls += 1;
    return Response.json({});
  },
});
assert.equal(skipped.status, "skipped");
assert.equal(skipped.reason, "cooldown");
assert.equal(skippedCalls, 0);

const malformed = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "malformed-fingerprint",
  policy: { allowed: true, reason: "allowed", retryAt: null },
  providers: [{ ...providers[0], model: "MiniMax-M2.7-malformed" }],
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: "not-json" } }],
  }),
});
assert.equal(malformed.status, "failed");
assert.match(malformed.error ?? "", /JSON|invalid/i);

const prohibited = await explainMarketOpportunities({
  decisions: topFive,
  fingerprint: "prohibited-fingerprint",
  policy: { allowed: true, reason: "allowed", retryAt: null },
  providers: [{ ...providers[0], model: "MiniMax-M2.7-prohibited" }],
  fetchImpl: async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      items: validItems().map((item, index) => index === 0
        ? { ...item, summary: "使用 20x 杠杆立即开仓。" }
        : item),
    }) } }],
  }),
});
assert.equal(prohibited.status, "failed");
assert.match(prohibited.error ?? "", /prohibited/i);

let releaseRequest;
let singleFlightCalls = 0;
const gate = new Promise((resolve) => { releaseRequest = resolve; });
const singleFlightInput = {
  decisions: topFive,
  fingerprint: "single-flight-fingerprint",
  policy: { allowed: true, reason: "allowed", retryAt: null },
  providers: [{ ...providers[0], model: "MiniMax-M2.7-single-flight" }],
  fetchImpl: async () => {
    singleFlightCalls += 1;
    await gate;
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ items: validItems() }) } }],
    });
  },
};
const first = explainMarketOpportunities(singleFlightInput);
const second = explainMarketOpportunities(singleFlightInput);
await Promise.resolve();
releaseRequest();
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(singleFlightCalls, 1);
assert.deepEqual(firstResult, secondResult);

console.log("ok - market opportunity AI is batched, guarded, and falls back");
