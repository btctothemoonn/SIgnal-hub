import assert from "node:assert/strict";
import { resetAiProviderCircuitBreakers } from "./ai-provider-fallback.ts";
import {
  OPPORTUNITY_PROMPT_VERSION,
  buildOpportunityInputHash,
  buildOpportunityPrompt,
  evaluateOpportunityBatch,
  getOpportunityProviderCandidates,
  parseOpportunityAiBatch,
  validateOpportunityAiBatch,
} from "./opportunity-ai.ts";

const candidate = {
  canonicalKey: "us:order:NVDA:1",
  market: "us",
  assetKeys: ["NVDA"],
  eventType: "order",
  firstSeenAt: "2026-07-12T01:00:00.000Z",
  lastSeenAt: "2026-07-12T01:00:00.000Z",
  evidence: [
    {
      id: "x:1",
      sourceType: "x",
      sourceName: "analyst-a",
      market: "us",
      assetKeys: ["NVDA"],
      eventType: "order",
      publishedAt: "2026-07-12T01:00:00.000Z",
      text: "x".repeat(2_500),
      translation: "Q3 order confirmed",
      originalUrl: "https://example.com/private?token=secret",
    },
  ],
};
const candidates = [candidate];
const validBatch = {
  opportunities: [
    {
      canonicalKey: candidate.canonicalKey,
      aiAdjustment: 5,
      thesis: "Q3 order",
      reasons: ["confirmed order"],
      risks: ["delivery"],
      invalidation: ["order cancelled"],
      validUntil: "2026-08-01T00:00:00.000Z",
      confidence: "high",
      evidenceIds: ["x:1"],
    },
  ],
};
const evidenceByCluster = new Map([
  [candidate.canonicalKey, new Set(["x:1"])],
]);

const hash = buildOpportunityInputHash(candidates, OPPORTUNITY_PROMPT_VERSION);
assert.match(hash, /^[a-f0-9]{64}$/);
assert.equal(
  hash,
  buildOpportunityInputHash(candidates, OPPORTUNITY_PROMPT_VERSION),
);
assert.notEqual(
  hash,
  buildOpportunityInputHash(candidates, OPPORTUNITY_PROMPT_VERSION + 1),
);

const prompt = JSON.parse(buildOpportunityPrompt(candidates));
assert.equal(prompt.promptVersion, OPPORTUNITY_PROMPT_VERSION);
assert.equal(prompt.candidates[0].evidence[0].text, "Q3 order confirmed");
assert.equal("originalUrl" in prompt.candidates[0].evidence[0], false);

const longCandidate = {
  ...candidate,
  evidence: [{ ...candidate.evidence[0], translation: null }],
};
const longPrompt = JSON.parse(buildOpportunityPrompt([longCandidate]));
assert.equal(longPrompt.candidates[0].evidence[0].text.length, 2_000);

const parsed = parseOpportunityAiBatch(JSON.stringify(validBatch));
assert.deepEqual(parsed, validBatch);
assert.deepEqual(
  parseOpportunityAiBatch(`\n\`\`\`json\n${JSON.stringify(validBatch)}\n\`\`\`\n`),
  validBatch,
);
assert.equal(
  validateOpportunityAiBatch(parsed, evidenceByCluster)[0].aiAdjustment,
  5,
);

assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({ ...validBatch, extra: true })),
  /unexpected|schema/i,
);
assert.throws(
  () =>
    parseOpportunityAiBatch(
      JSON.stringify({
        opportunities: [{ ...validBatch.opportunities[0], aiAdjustment: "5" }],
      }),
    ),
  /adjustment|schema/i,
);
assert.throws(
  () =>
    parseOpportunityAiBatch(
      JSON.stringify({
        opportunities: [{ ...validBatch.opportunities[0], risks: ["delivery", 7] }],
      }),
    ),
  /risks|schema/i,
);
assert.throws(
  () =>
    parseOpportunityAiBatch(
      JSON.stringify({
        opportunities: [{ ...validBatch.opportunities[0], confidence: "certain" }],
      }),
    ),
  /confidence|schema/i,
);
assert.throws(
  () =>
    parseOpportunityAiBatch(
      JSON.stringify({
        opportunities: [{ ...validBatch.opportunities[0], validUntil: "later" }],
      }),
    ),
  /validUntil|date|schema/i,
);

assert.throws(
  () =>
    validateOpportunityAiBatch(
      { opportunities: [{ ...validBatch.opportunities[0], aiAdjustment: 16 }] },
      evidenceByCluster,
    ),
  /adjustment/i,
);
assert.throws(
  () =>
    validateOpportunityAiBatch(
      { opportunities: [{ ...validBatch.opportunities[0], evidenceIds: ["missing"] }] },
      evidenceByCluster,
    ),
  /evidence/i,
);
assert.throws(
  () =>
    validateOpportunityAiBatch(
      { opportunities: [{ ...validBatch.opportunities[0], evidenceIds: [] }] },
      evidenceByCluster,
    ),
  /evidence/i,
);
assert.throws(
  () =>
    validateOpportunityAiBatch(
      {
        opportunities: [
          { ...validBatch.opportunities[0], canonicalKey: "us:order:UNKNOWN:1" },
        ],
      },
      evidenceByCluster,
    ),
  /canonical|evidence/i,
);
assert.throws(
  () =>
    validateOpportunityAiBatch(
      { opportunities: [validBatch.opportunities[0], validBatch.opportunities[0]] },
      evidenceByCluster,
    ),
  /duplicate/i,
);

const providers = getOpportunityProviderCandidates({
  MINIMAX_API_KEY: " minimax-test ",
  MINIMAX_BASE_URL: "https://minimax.example/v1/",
  DEEPSEEK_API_KEY: " deepseek-test ",
  DEEPSEEK_BASE_URL: "https://deepseek.example/",
});
assert.deepEqual(
  providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
  [
    {
      id: "minimax",
      baseUrl: "https://minimax.example/v1",
      model: "MiniMax-M2.7",
    },
    {
      id: "deepseek",
      baseUrl: "https://deepseek.example",
      model: "deepseek-chat",
    },
  ],
);

resetAiProviderCircuitBreakers();
const urls = [];
const requestBodies = [];
const fallbackResult = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl: async (url, init) => {
    urls.push(String(url));
    requestBodies.push(JSON.parse(String(init?.body)));
    if (String(url).includes("minimaxi")) {
      return new Response("private provider response", { status: 429 });
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(validBatch) } }],
    });
  },
});
assert.equal(fallbackResult.ruleOnly, false);
assert.equal(fallbackResult.provider?.id, "deepseek");
assert.equal(fallbackResult.inputHash, hash);
assert.deepEqual(fallbackResult.evaluations, validBatch.opportunities);
assert.deepEqual(
  urls.map((url) => new URL(url).hostname),
  ["api.minimaxi.com", "api.deepseek.com"],
);
assert.deepEqual(
  requestBodies.map((body) => body.model),
  ["MiniMax-M2.7", "deepseek-chat"],
);

resetAiProviderCircuitBreakers();
let thrownHttpAttempts = 0;
const thrownHttpFallback = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl: async (url) => {
    thrownHttpAttempts += 1;
    if (String(url).includes("minimaxi")) throw new Error("HTTP 500");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(validBatch) } }],
    });
  },
});
assert.equal(thrownHttpAttempts, 2);
assert.equal(thrownHttpFallback.provider?.id, "deepseek");

resetAiProviderCircuitBreakers();
let malformedResponseAttempts = 0;
const malformedResponse = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl: async () => {
    malformedResponseAttempts += 1;
    return Response.json({
      choices: [
        {
          message: {
            content:
              malformedResponseAttempts === 1
                ? "HTTP 500 is not a valid structured response"
                : JSON.stringify(validBatch),
          },
        },
      ],
    });
  },
});
assert.equal(malformedResponseAttempts, 1);
assert.equal(malformedResponse.ruleOnly, true);

resetAiProviderCircuitBreakers();
let validationAttempts = 0;
const validationFailure = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl: async () => {
    validationAttempts += 1;
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              opportunities: [
                { ...validBatch.opportunities[0], evidenceIds: ["invented:1"] },
              ],
            }),
          },
        },
      ],
    });
  },
});
assert.equal(validationAttempts, 1);
assert.deepEqual(validationFailure, {
  evaluations: [],
  provider: null,
  inputHash: null,
  ruleOnly: true,
});

const retriedSuccess = await evaluateOpportunityBatch({
  candidates,
  env: { MINIMAX_API_KEY: "minimax-test" },
  fetchImpl: async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(validBatch) } }],
    }),
});
assert.equal(retriedSuccess.ruleOnly, false);
assert.equal(retriedSuccess.inputHash, hash);

const noProviderResult = await evaluateOpportunityBatch({
  candidates,
  env: {},
  fetchImpl: async () => {
    throw new Error("fetch should not run");
  },
});
assert.deepEqual(noProviderResult, {
  evaluations: [],
  provider: null,
  inputHash: null,
  ruleOnly: true,
});

resetAiProviderCircuitBreakers();
let failedRequests = 0;
const allProvidersFailed = await evaluateOpportunityBatch({
  candidates,
  env: {
    MINIMAX_API_KEY: "minimax-test",
    DEEPSEEK_API_KEY: "deepseek-test",
  },
  fetchImpl: async () => {
    failedRequests += 1;
    return new Response("private response body must not escape", { status: 500 });
  },
});
assert.equal(failedRequests, 2);
assert.deepEqual(allProvidersFailed, {
  evaluations: [],
  provider: null,
  inputHash: null,
  ruleOnly: true,
});

console.log("ok - opportunity AI batch evaluation");
