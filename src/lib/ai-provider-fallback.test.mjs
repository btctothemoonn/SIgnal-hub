import assert from "node:assert/strict";
import {
  isAiProviderBlocked,
  isQuotaExhaustedError,
  resetAiProviderCircuitBreakers,
  runWithAiProviderFallback,
} from "./ai-provider-fallback.ts";

const quotaError =
  "usage limit exceeded, weekly usage limit reached for Token Plan Starter (6000/6000 used), resets at 2026-06-01T00:00:00+08:00 (2056)";
const now = new Date("2026-05-30T16:00:00.000Z");
const providers = [
  {
    id: "minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "minimax-key",
    model: "MiniMax-M2.7",
  },
  {
    id: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "deepseek-key",
    model: "deepseek-v4-flash",
  },
];

assert.equal(isQuotaExhaustedError(quotaError), true);
resetAiProviderCircuitBreakers();

const firstCalls = [];
const first = await runWithAiProviderFallback({
  providers,
  now,
  request: async (provider) => {
    firstCalls.push(provider.id);
    if (provider.id === "minimax") throw new Error(quotaError);
    return "deepseek-ok";
  },
});

assert.equal(first.value, "deepseek-ok");
assert.equal(first.provider.id, "deepseek");
assert.deepEqual(firstCalls, ["minimax", "deepseek"]);
assert.equal(isAiProviderBlocked(providers[0], now), true);

const secondCalls = [];
const second = await runWithAiProviderFallback({
  providers,
  now: new Date("2026-05-30T16:05:00.000Z"),
  request: async (provider) => {
    secondCalls.push(provider.id);
    return `${provider.id}-ok`;
  },
});

assert.equal(second.value, "deepseek-ok");
assert.deepEqual(secondCalls, ["deepseek"]);

resetAiProviderCircuitBreakers();
await assert.rejects(
  () =>
    runWithAiProviderFallback({
      providers: [providers[0]],
      now,
      request: async () => {
        throw new Error(quotaError);
      },
    }),
  /usage limit exceeded/,
);
assert.equal(isAiProviderBlocked(providers[0], now), true);

resetAiProviderCircuitBreakers();
await assert.rejects(
  () =>
    runWithAiProviderFallback({
      providers,
      now,
      request: async (provider) => {
        if (provider.id === "minimax") throw new Error("invalid JSON response");
        return "should-not-run";
      },
    }),
  /invalid JSON response/,
);

console.log("ok - AI provider fallback circuit breaker");
