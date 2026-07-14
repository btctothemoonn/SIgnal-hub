import assert from "node:assert/strict";
import { resetAiProviderCircuitBreakers } from "./ai-provider-fallback.ts";
import {
  OPPORTUNITY_DISPLAY_THRESHOLD,
  OPPORTUNITY_PROMPT_VERSION,
  buildOpportunityInputHash,
  buildOpportunityPrompt,
  evaluateOpportunityBatch,
  getOpportunityProviderCandidates,
  parseOpportunityAiBatch,
  validateOpportunityAiBatch,
} from "./opportunity-ai.ts";

const evidence = (overrides = {}) => ({
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
  ...overrides,
});

const candidate = {
  canonicalKey: "us:order:NVDA:1",
  market: "us",
  assetKeys: ["NVDA"],
  eventType: "order",
  firstSeenAt: "2026-07-12T01:00:00.000Z",
  lastSeenAt: "2026-07-12T01:00:00.000Z",
  evidence: [evidence(), evidence({ id: "x:2", publishedAt: "2026-07-12T01:05:00.000Z" })],
};
const input = { candidate, ruleScore: 70 };
const inputs = [input];
const claim = (text, evidenceIds) => ({ text, evidenceIds });
const validOpportunity = {
  canonicalKey: candidate.canonicalKey,
  aiAdjustment: 4,
  thesis: claim("Q3 order", ["x:1"]),
  reasons: [claim("confirmed order", ["x:2"])],
  risks: [claim("delivery", ["x:1"])],
  invalidation: [claim("order cancelled", ["x:2"])],
  validUntil: "2026-08-01T00:00:00.000Z",
  confidence: "high",
};
const validBatch = { opportunities: [validOpportunity] };
const normalizedOpportunity = {
  canonicalKey: candidate.canonicalKey,
  aiAdjustment: 4,
  thesis: "Q3 order",
  reasons: ["confirmed order"],
  risks: ["delivery"],
  invalidation: ["order cancelled"],
  validUntil: "2026-08-01T00:00:00.000Z",
  confidence: "high",
  evidenceIds: ["x:1", "x:2"],
  claimEvidence: {
    thesis: ["x:1"],
    reasons: [["x:2"]],
    risks: [["x:1"]],
    invalidation: [["x:2"]],
  },
};

const emptyProviderTelemetry = {
  minimax: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
  deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
};

const promptText = buildOpportunityPrompt(inputs);
const prompt = JSON.parse(promptText);
assert.equal(prompt.promptVersion, OPPORTUNITY_PROMPT_VERSION);
assert.equal(prompt.displayThreshold, OPPORTUNITY_DISPLAY_THRESHOLD);
assert.equal(prompt.candidates[0].ruleScore, 70);
assert.equal(prompt.candidates[0].independentSourceCount, 1);
assert.equal(prompt.candidates[0].displayThreshold, 75);
assert.equal(prompt.candidates[0].evidence[0].text, "Q3 order confirmed");
assert.equal("originalUrl" in prompt.candidates[0].evidence[0], false);
assert.deepEqual(prompt.responseShape.opportunities[0].thesis, {
  text: "string",
  evidenceIds: ["source:id"],
});
assert.throws(
  () => buildOpportunityPrompt([{ ...input, ruleScore: Number.NaN }]),
  /ruleScore/i,
);

const longInput = {
  candidate: {
    ...candidate,
    evidence: [evidence({ translation: null })],
  },
  ruleScore: 70,
};
assert.equal(
  JSON.parse(buildOpportunityPrompt([longInput])).candidates[0].evidence[0].text.length,
  2_000,
);

const hash = buildOpportunityInputHash(inputs);
assert.match(hash, /^[a-f0-9]{64}$/);
assert.equal(hash, buildOpportunityInputHash(inputs));
assert.notEqual(
  hash,
  buildOpportunityInputHash(inputs, OPPORTUNITY_PROMPT_VERSION + 1),
);
const unsentFieldsChanged = [{
  candidate: {
    ...candidate,
    firstSeenAt: "2030-01-01T00:00:00.000Z",
    lastSeenAt: "2030-01-02T00:00:00.000Z",
    evidence: candidate.evidence.map((item) => ({
      ...item,
      text: "not sent because translation is present",
    })),
  },
  ruleScore: 70,
}];
assert.equal(hash, buildOpportunityInputHash(unsentFieldsChanged));
const evidenceWithoutLink = [{
  candidate: {
    ...candidate,
    evidence: candidate.evidence.map((item) =>
      item.id === "x:1" ? { ...item, originalUrl: "javascript:alert(1)" } : item,
    ),
  },
  ruleScore: 70,
}];
assert.notEqual(
  hash,
  buildOpportunityInputHash(evidenceWithoutLink),
  "removing a usable evidence URL invalidates cached AI claims",
);
assert.notEqual(
  hash,
  buildOpportunityInputHash([{ ...input, ruleScore: 71 }]),
);

const parsed = parseOpportunityAiBatch(JSON.stringify(validBatch));
assert.deepEqual(parsed, validBatch);
assert.deepEqual(
  parseOpportunityAiBatch(`\n\`\`\`json\n${JSON.stringify(validBatch)}\n\`\`\`\n`),
  validBatch,
);
assert.deepEqual(
  parseOpportunityAiBatch(`<think>checking supplied evidence</think>\n${JSON.stringify(validBatch)}`),
  validBatch,
);
assert.deepEqual(
  parseOpportunityAiBatch(`Here is the JSON only:\n${JSON.stringify(validBatch)}\nDone.`),
  validBatch,
);
assert.deepEqual(
  parseOpportunityAiBatch(`${JSON.stringify(validBatch)}\nextra diagnostic {"ignored":true}`),
  validBatch,
);
assert.deepEqual(validateOpportunityAiBatch(parsed, inputs), [normalizedOpportunity]);

assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({ ...validBatch, extra: true })),
  /unexpected|schema/i,
);
assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({
    opportunities: [{ ...validOpportunity, aiAdjustment: "4" }],
  })),
  /adjustment|schema/i,
);
assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({
    opportunities: [{ ...validOpportunity, confidence: "certain" }],
  })),
  /confidence|schema/i,
);
assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({
    opportunities: [{ ...validOpportunity, validUntil: "later" }],
  })),
  /validUntil|date|schema/i,
);
assert.throws(
  () => parseOpportunityAiBatch(JSON.stringify({
    opportunities: [{
      ...validOpportunity,
      reasons: [
        claim("one", ["x:1"]),
        claim("two", ["x:1"]),
        claim("three", ["x:1"]),
        claim("four", ["x:1"]),
      ],
    }],
  })),
  /reasons|3/i,
);

assert.throws(
  () => validateOpportunityAiBatch({ opportunities: [] }, inputs),
  /complete|empty|batch/i,
);
assert.throws(
  () => validateOpportunityAiBatch({ opportunities: [validOpportunity, validOpportunity] }, inputs),
  /duplicate/i,
);

const secondCandidate = {
  ...candidate,
  canonicalKey: "us:policy:AMD:2",
  assetKeys: ["AMD"],
  eventType: "policy",
  evidence: [evidence({ id: "news:2", sourceType: "news", sourceName: "wire" })],
};
const secondInput = { candidate: secondCandidate, ruleScore: 80 };
const secondOpportunity = {
  ...validOpportunity,
  canonicalKey: secondCandidate.canonicalKey,
  aiAdjustment: 1,
  thesis: claim("policy support", ["news:2"]),
  reasons: [],
  risks: [],
  invalidation: [],
};
assert.throws(
  () => validateOpportunityAiBatch(validBatch, [input, secondInput]),
  /complete|missing/i,
);
assert.throws(
  () => validateOpportunityAiBatch(
    { opportunities: [validOpportunity, secondOpportunity] },
    inputs,
  ),
  /complete|unexpected|canonical/i,
);

assert.throws(
  () => validateOpportunityAiBatch({
    opportunities: [{ ...validOpportunity, aiAdjustment: 16 }],
  }, inputs),
  /adjustment/i,
);
assert.throws(
  () => validateOpportunityAiBatch({
    opportunities: [{ ...validOpportunity, aiAdjustment: 5 }],
  }, inputs),
  /threshold|single.source|unverified/i,
);
assert.equal(
  validateOpportunityAiBatch({
    opportunities: [{ ...validOpportunity, aiAdjustment: 15 }],
  }, [{ ...input, ruleScore: 75 }])[0].aiAdjustment,
  15,
);

for (const field of ["thesis", "reasons", "risks", "invalidation"]) {
  const invalidClaim = claim("unsupported", ["invented:1"]);
  const opportunity = {
    ...validOpportunity,
    [field]: field === "thesis" ? invalidClaim : [invalidClaim],
  };
  assert.throws(
    () => validateOpportunityAiBatch({ opportunities: [opportunity] }, inputs),
    /evidence/i,
  );
}
for (const field of ["thesis", "reasons", "risks", "invalidation"]) {
  const uncitedClaim = claim("uncited", []);
  const opportunity = {
    ...validOpportunity,
    [field]: field === "thesis" ? uncitedClaim : [uncitedClaim],
  };
  assert.throws(
    () => validateOpportunityAiBatch({ opportunities: [opportunity] }, inputs),
    /evidence/i,
  );
}

const unlinkedEvidenceCandidate = {
  ...candidate,
  evidence: [
    evidence({ id: "x:no-link", originalUrl: "javascript:alert(1)" }),
    evidence({ id: "x:linked", originalUrl: "https://example.com/public" }),
  ],
};
const claimsCitingUnlinkedEvidence = {
  ...validOpportunity,
  thesis: claim("Q3 order", ["x:no-link"]),
  reasons: [claim("confirmed order", ["x:linked"])],
  risks: [claim("delivery", ["x:linked"])],
  invalidation: [claim("order cancelled", ["x:linked"])],
};
assert.throws(
  () => validateOpportunityAiBatch(
    { opportunities: [claimsCitingUnlinkedEvidence] },
    [{ candidate: unlinkedEvidenceCandidate, ruleScore: 70 }],
  ),
  /linkable|url|evidence/i,
);

const directProviders = getOpportunityProviderCandidates({
  MINIMAX_API_KEY: " minimax-test ",
  MINIMAX_BASE_URL: "https://minimax.example/v1/",
  DEEPSEEK_API_KEY: " deepseek-test ",
  DEEPSEEK_BASE_URL: "https://deepseek.example/",
});
assert.deepEqual(
  directProviders.map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
  [
    { id: "minimax", baseUrl: "https://minimax.example/v1", model: "MiniMax-M2.7" },
    { id: "deepseek", baseUrl: "https://deepseek.example", model: "deepseek-chat" },
  ],
);

const documentedInternationalMinimax = getOpportunityProviderCandidates({
  MINIMAX_API_KEY: "documented-minimax-key",
  AI_SUMMARY_BASE_URL: "https://api.minimax.io/v1/",
  AI_SUMMARY_MODEL: "MiniMax-M2.7-international",
});
assert.deepEqual(
  documentedInternationalMinimax.map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
  [{
    id: "minimax",
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M2.7-international",
  }],
);
assert.deepEqual(
  getOpportunityProviderCandidates({
    MINIMAX_API_KEY: "direct-minimax-key",
    AI_SUMMARY_BASE_URL: "https://api.openai.com/v1",
    AI_SUMMARY_MODEL: "gpt-4o-mini",
  }).map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
  [{
    id: "minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7",
  }],
);

const reusedProviders = getOpportunityProviderCandidates({
  AI_SUMMARY_API_KEY: "summary-minimax-key",
  AI_SUMMARY_BASE_URL: "https://summary.minimax.example/v1/",
  AI_SUMMARY_MODEL: "summary-minimax-model",
  AI_SUMMARY_FALLBACK_API_KEY: "summary-deepseek-key",
  AI_SUMMARY_FALLBACK_BASE_URL: "https://fallback.deepseek.example/v1/",
  AI_SUMMARY_FALLBACK_MODEL: "summary-deepseek-model",
});
assert.deepEqual(
  reusedProviders.map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
  [
    {
      id: "minimax",
      baseUrl: "https://summary.minimax.example/v1",
      model: "summary-minimax-model",
    },
    {
      id: "deepseek",
      baseUrl: "https://fallback.deepseek.example/v1",
      model: "summary-deepseek-model",
    },
  ],
);
assert.deepEqual(getOpportunityProviderCandidates({
  AI_SUMMARY_API_KEY: "wrong-primary-key",
  AI_SUMMARY_BASE_URL: "https://api.deepseek.com/v1",
  AI_SUMMARY_FALLBACK_API_KEY: "wrong-fallback-key",
  AI_SUMMARY_FALLBACK_BASE_URL: "https://api.minimaxi.com/v1",
}), []);
assert.deepEqual(getOpportunityProviderCandidates({
  AI_SUMMARY_API_KEY: "path-spoofed-primary-key",
  AI_SUMMARY_BASE_URL: "https://proxy.example/v1/minimax",
  AI_SUMMARY_FALLBACK_API_KEY: "path-spoofed-fallback-key",
  AI_SUMMARY_FALLBACK_BASE_URL: "https://proxy.example/v1/deepseek",
}), []);

const providerEnv = {
  MINIMAX_API_KEY: "minimax-test",
  DEEPSEEK_API_KEY: "deepseek-test",
};
const successResponse = () => Response.json({
  choices: [{ message: { content: JSON.stringify(validBatch) } }],
});

for (const status of [408, 429, 500, 503]) {
  resetAiProviderCircuitBreakers();
  const urls = [];
  const result = await evaluateOpportunityBatch({
    inputs,
    env: providerEnv,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return urls.length === 1
        ? new Response("private provider response", { status })
        : successResponse();
    },
  });
  assert.equal(result.provider?.id, "deepseek");
  assert.deepEqual(result.providerTelemetry, {
    minimax: { attempts: 1, successes: 0, failures: 1, fallbacks: 0 },
    deepseek: { attempts: 1, successes: 1, failures: 0, fallbacks: 1 },
  });
  assert.deepEqual(
    urls.map((url) => new URL(url).hostname),
    ["api.minimaxi.com", "api.deepseek.com"],
  );
}

resetAiProviderCircuitBreakers();
const quotaSecret = "PRIVATE_QUOTA_BODY_MARKER";
let quotaAttempts = 0;
let quotaBodyCancelled = false;
const capturedConsole = [];
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};
console.log = (...args) => capturedConsole.push(args);
console.warn = (...args) => capturedConsole.push(args);
console.error = (...args) => capturedConsole.push(args);
let quotaFallbackResult;
try {
  quotaFallbackResult = await evaluateOpportunityBatch({
    inputs,
    env: providerEnv,
    fetchImpl: async (url) => {
      quotaAttempts += 1;
      if (!String(url).includes("minimaxi")) return successResponse();
      const firstChunk = new TextEncoder().encode(
        `quota exceeded (2062) ${quotaSecret} ${"x".repeat(2_048)}`,
      );
      return new Response(new ReadableStream({
        pull(controller) {
          controller.enqueue(firstChunk);
        },
        cancel() {
          quotaBodyCancelled = true;
        },
      }), { status: 400 });
    },
  });
} finally {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
assert.equal(quotaAttempts, 2);
assert.equal(quotaFallbackResult.provider?.id, "deepseek");
assert.equal(quotaBodyCancelled, true);
assert.equal(JSON.stringify(quotaFallbackResult).includes(quotaSecret), false);
assert.equal(JSON.stringify(capturedConsole).includes(quotaSecret), false);

resetAiProviderCircuitBreakers();
let badRequestAttempts = 0;
const badRequestResult = await evaluateOpportunityBatch({
  inputs,
  env: providerEnv,
  fetchImpl: async () => {
    badRequestAttempts += 1;
    return new Response("private bad request", { status: 400 });
  },
});
assert.equal(badRequestAttempts, 1);
assert.equal(badRequestResult.ruleOnly, true);
assert.deepEqual(badRequestResult.providerTelemetry, {
  minimax: { attempts: 1, successes: 0, failures: 1, fallbacks: 0 },
  deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
});

const captureConfiguredTimeout = async (env, timeoutMs) => {
  let capturedDelay = null;
  const result = await evaluateOpportunityBatch({
    inputs,
    env: { MINIMAX_API_KEY: "minimax-test", ...env },
    timeoutMs,
    timer: {
      setTimeout(_callback, delay) {
        capturedDelay = delay;
        return 1;
      },
      clearTimeout() {},
    },
    fetchImpl: async () => successResponse(),
  });
  assert.equal(result.ruleOnly, false);
  return capturedDelay;
};
assert.equal(await captureConfiguredTimeout({
  OPPORTUNITY_AI_TIMEOUT_MS: "7000",
  AI_SUMMARY_TIMEOUT_MS: "9000",
}), 7_000);
assert.equal(await captureConfiguredTimeout({
  AI_SUMMARY_TIMEOUT_MS: "240000",
}), 240_000);
assert.equal(await captureConfiguredTimeout({}), 60_000);
assert.equal(await captureConfiguredTimeout({
  OPPORTUNITY_AI_TIMEOUT_MS: "1",
}), 1_000);
assert.equal(await captureConfiguredTimeout({
  OPPORTUNITY_AI_TIMEOUT_MS: "999999",
}), 300_000);
assert.equal(await captureConfiguredTimeout({
  OPPORTUNITY_AI_TIMEOUT_MS: "7000",
}, 25), 1_000);

resetAiProviderCircuitBreakers();
let timeoutAttempts = 0;
const timeoutDelays = [];
const clearedTimers = [];
const timeoutResult = await evaluateOpportunityBatch({
  inputs,
  env: providerEnv,
  timeoutMs: 25,
  timer: {
    setTimeout(callback, delay) {
      timeoutDelays.push(delay);
      const handle = timeoutDelays.length;
      if (handle === 1) callback();
      return handle;
    },
    clearTimeout(handle) {
      clearedTimers.push(handle);
    },
  },
  fetchImpl: async (url, init) => {
    timeoutAttempts += 1;
    if (String(url).includes("minimaxi")) {
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    }
    return successResponse();
  },
});
assert.equal(timeoutResult.provider?.id, "deepseek");
assert.equal(timeoutAttempts, 2);
assert.deepEqual(timeoutDelays, [1_000, 1_000]);
assert.deepEqual(clearedTimers, [1, 2]);

resetAiProviderCircuitBreakers();
let bodyTimeoutAttempts = 0;
let bodyTimeoutCallback = null;
let bodyTimerActive = false;
const bodyTimeoutResult = await evaluateOpportunityBatch({
  inputs,
  env: providerEnv,
  timeoutMs: 25,
  timer: {
    setTimeout(callback) {
      bodyTimeoutCallback = callback;
      bodyTimerActive = true;
      return bodyTimeoutAttempts + 1;
    },
    clearTimeout() {
      bodyTimerActive = false;
    },
  },
  fetchImpl: async (url) => {
    bodyTimeoutAttempts += 1;
    if (String(url).includes("minimaxi")) {
      return {
        ok: true,
        status: 200,
        async json() {
          if (bodyTimerActive) bodyTimeoutCallback?.();
          throw new DOMException("aborted while reading body", "AbortError");
        },
      };
    }
    return successResponse();
  },
});
assert.equal(bodyTimeoutAttempts, 2);
assert.equal(bodyTimeoutResult.provider?.id, "deepseek");

resetAiProviderCircuitBreakers();
let malformedResponseAttempts = 0;
const malformedResponse = await evaluateOpportunityBatch({
  inputs,
  env: providerEnv,
  fetchImpl: async () => {
    malformedResponseAttempts += 1;
    return Response.json({
      choices: [{
        message: {
          content: malformedResponseAttempts === 1
            ? "HTTP 500 is not a valid structured response"
            : JSON.stringify(validBatch),
        },
      }],
    });
  },
});
assert.equal(malformedResponseAttempts, 1);
assert.equal(malformedResponse.ruleOnly, true);

resetAiProviderCircuitBreakers();
let validationAttempts = 0;
const validationFailure = await evaluateOpportunityBatch({
  inputs,
  env: providerEnv,
  fetchImpl: async () => {
    validationAttempts += 1;
    return Response.json({
      choices: [{ message: { content: JSON.stringify({
        opportunities: [{
          ...validOpportunity,
          thesis: claim("invented", ["invented:1"]),
        }],
      }) } }],
    });
  },
});
assert.equal(validationAttempts, 1);
assert.deepEqual(validationFailure, {
  evaluations: [],
  provider: null,
  inputHash: null,
  ruleOnly: true,
  providerTelemetry: {
    minimax: { attempts: 1, successes: 0, failures: 1, fallbacks: 0 },
    deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
  },
});

const retriedSuccess = await evaluateOpportunityBatch({
  inputs,
  env: { MINIMAX_API_KEY: "minimax-test" },
  fetchImpl: async () => successResponse(),
});
assert.equal(retriedSuccess.ruleOnly, false);
assert.equal(retriedSuccess.inputHash, hash);
assert.deepEqual(retriedSuccess.evaluations, [normalizedOpportunity]);

const noProviderResult = await evaluateOpportunityBatch({
  inputs,
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
  providerTelemetry: emptyProviderTelemetry,
});

console.log("ok - opportunity AI batch evaluation");
