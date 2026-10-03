import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { requestAiSummary } from "./alpha-summary.ts";
import { resetAiProviderCircuitBreakers } from "./ai-provider-fallback.ts";

const primaryEnv = {
  AI_SUMMARY_API_KEY: "test-only-key",
  AI_SUMMARY_BASE_URL: "https://summary.test/v1",
  AI_SUMMARY_MODEL: "summary-test-model",
};
const fallbackEnv = {
  ...primaryEnv,
  AI_SUMMARY_FALLBACK_API_KEY: "test-only-fallback-key",
  AI_SUMMARY_FALLBACK_BASE_URL: "https://api.deepseek.com",
  AI_SUMMARY_FALLBACK_MODEL: "deepseek-test-fallback",
};
const summaryContent = JSON.stringify({
  headline: "Validated summary",
  stocks: [{ target: "NVDA", opinions: [{ author: "Alice", view: "Demand is growing" }] }],
  crypto: [],
});

beforeEach(() => resetAiProviderCircuitBreakers());

function completion(content = summaryContent) {
  return Response.json({
    id: "test-completion",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "test-response-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

// Node's native AbortSignal.timeout uses an internal clock. Connect only that
// clock boundary to setTimeout so network delays and deadlines advance together.
function useVirtualClock(t) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_700_000_000_000 });
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new DOMException("The operation timed out", "TimeoutError"));
    }, milliseconds);
    return controller.signal;
  });
}

async function advance(t, milliseconds) {
  t.mock.timers.tick(milliseconds);
  // Let fetch, response.json, parsing, validation and provider fallback finish
  // their promise continuations before advancing the next portion of the clock.
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function delayedResponse(signal, milliseconds, response) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(response);
    }, milliseconds);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function observe(promise) {
  return promise.then(
    (value) => ({ value, error: null, completedAt: Date.now() }),
    (error) => ({ value: null, error, completedAt: Date.now() }),
  );
}

function assertSummary(result) {
  assert.equal(result.summary.headline, "Validated summary");
  assert.deepEqual(result.summary.stocks, [
    { target: "NVDA", opinions: [{ author: "Alice", view: "Demand is growing" }] },
  ]);
}

function assertTimeout(error, model, milliseconds) {
  assert.ok(error instanceof Error, "a deadline must reject instead of returning a summary");
  assert.match(error.message, /超时/, "timeout errors need a clear Chinese explanation");
  assert.ok(error.message.includes(model), `timeout errors must identify model ${model}`);
  const seconds = String(milliseconds / 1000).replace(".", "\\.");
  assert.match(
    error.message,
    new RegExp(`(?:${milliseconds}\\s*(?:ms|毫秒)|${seconds}\\s*(?:s|秒))`, "i"),
    "timeout errors must state the configured waiting limit",
  );
}

test("default summary budget allows a valid response after 90 seconds", async (t) => {
  useVirtualClock(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => {
    requests += 1;
    return delayedResponse(init.signal, 90_000, completion());
  });
  const pending = observe(requestAiSummary({ prompt: "Summarize supplied messages", env: primaryEnv }));
  await advance(t, 60_000);
  await advance(t, 30_000);
  const outcome = await pending;
  assert.equal(outcome.error, null, "the previous 60-second limit must not abort a 90-second response");
  assertSummary(outcome.value);
  assert.equal(requests, 1);
});

test("default summary deadline ends at 240 seconds with an explicit model error", async (t) => {
  useVirtualClock(t);
  const startedAt = Date.now();
  let requests = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => {
    requests += 1;
    return delayedResponse(init.signal, 250_000, completion());
  });
  const pending = observe(requestAiSummary({ prompt: "test", env: primaryEnv }));
  await advance(t, 60_000);
  await advance(t, 180_000);
  const outcome = await pending;
  assertTimeout(outcome.error, "summary-test-model", 240_000);
  assert.equal(outcome.completedAt - startedAt, 240_000);
  assert.equal(requests, 1, "a deadline must not trigger a JSON repair or provider retry");
});

test("malformed JSON repair gets only the time left in the generation budget", async (t) => {
  useVirtualClock(t);
  const startedAt = Date.now();
  const requests = [];
  t.mock.method(globalThis, "fetch", (_url, init) => {
    requests.push(JSON.parse(init.body));
    return delayedResponse(
      init.signal,
      requests.length === 1 ? 70 : 50,
      completion(requests.length === 1 ? '{"headline": broken' : summaryContent),
    );
  });
  const pending = observe(requestAiSummary({
    prompt: "test", env: { ...primaryEnv, AI_SUMMARY_TIMEOUT_MS: "100" },
  }));
  await advance(t, 70);
  assert.equal(requests.length, 2, "malformed output still gets one real JSON repair attempt");
  assert.match(requests[1].messages.at(-1).content, /JSON/);
  await advance(t, 30);
  await advance(t, 20);
  const outcome = await pending;
  assertTimeout(outcome.error, "summary-test-model", 100);
  assert.equal(outcome.completedAt - startedAt, 100, "the second request cannot restart the 100ms budget");
  assert.equal(requests.length, 2);
});

test("source validation repair shares the same generation deadline", async (t) => {
  useVirtualClock(t);
  const startedAt = Date.now();
  let requests = 0;
  let validations = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => {
    requests += 1;
    return delayedResponse(
      init.signal,
      requests === 1 ? 70 : 50,
      completion(requests === 1 ? summaryContent.replace("Validated summary", "Unvalidated summary") : summaryContent),
    );
  });
  const pending = observe(requestAiSummary({
    prompt: "test", env: { ...primaryEnv, AI_SUMMARY_TIMEOUT_MS: "100" },
    validateSummary(summary) {
      validations += 1;
      if (summary.headline !== "Validated summary") throw new Error("Missing expected supplied source");
      return summary;
    },
  }));
  await advance(t, 70);
  assert.equal(validations, 1, "the real parser must reach source validation before repair");
  assert.equal(requests, 2);
  await advance(t, 30);
  await advance(t, 20);
  const outcome = await pending;
  assertTimeout(outcome.error, "summary-test-model", 100);
  assert.equal(outcome.completedAt - startedAt, 100);
  assert.equal(requests, 2);
  assert.equal(validations, 1, "an expired repair response must not reach validation");
});

test("quota fallback gets the remaining time instead of a new budget", async (t) => {
  useVirtualClock(t);
  const startedAt = Date.now();
  const urls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    urls.push(url);
    return delayedResponse(
      init.signal,
      urls.length === 1 ? 70 : 50,
      urls.length === 1
        ? Response.json({ error: { message: "quota exceeded" } }, { status: 429 })
        : completion(),
    );
  });
  const pending = observe(requestAiSummary({
    prompt: "test", env: { ...fallbackEnv, AI_SUMMARY_TIMEOUT_MS: "100" },
  }));
  await advance(t, 70);
  assert.deepEqual(urls, ["https://summary.test/v1/chat/completions", "https://api.deepseek.com/chat/completions"]);
  await advance(t, 30);
  await advance(t, 20);
  const outcome = await pending;
  assertTimeout(outcome.error, "deepseek-test-fallback", 100);
  assert.equal(outcome.completedAt - startedAt, 100);
  assert.equal(urls.length, 2);
});

test("a native 5ms deadline keeps its timeout classification and does not retry", async (t) => {
  let requests = 0;
  // AbortSignal.timeout is unref'ed; keep the event loop alive while testing the
  // actual native deadline, without replacing its clock or waiting for minutes.
  const keepAlive = setTimeout(() => {}, 1_000);
  t.after(() => clearTimeout(keepAlive));
  t.mock.method(globalThis, "fetch", (_url, init) => {
    requests += 1;
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  });
  const outcome = await observe(requestAiSummary({
    prompt: "test", env: { ...fallbackEnv, AI_SUMMARY_TIMEOUT_MS: "5" },
  }));
  assert.equal(requests, 1, "deadline failures must not invoke repair or quota fallback");
  assertTimeout(outcome.error, "summary-test-model", 5);
});

test("response body TimeoutError is preserved and never treated as malformed JSON", async (t) => {
  let requests = 0;
  const response = completion();
  t.mock.method(response, "json", async () => {
    throw new DOMException("The operation timed out while reading the body", "TimeoutError");
  });
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return response;
  });
  const outcome = await observe(requestAiSummary({
    prompt: "test", env: { ...fallbackEnv, AI_SUMMARY_TIMEOUT_MS: "100" },
  }));
  assert.equal(requests, 1, "body read timeouts must not be swallowed into a JSON repair");
  assertTimeout(outcome.error, "summary-test-model", 100);
});

test("official DeepSeek summary requests disable thinking and allow 16384 output tokens", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, payload: JSON.parse(init.body) });
    return completion();
  });
  const result = await requestAiSummary({
    prompt: "test",
    env: { DEEPSEEK_API_KEY: "test-only-key", DEEPSEEK_MODEL: "deepseek-v4-flash" },
  });
  assertSummary(result);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(requests[0].payload.model, "deepseek-v4-flash");
  assert.deepEqual(requests[0].payload.thinking, { type: "disabled" });
  assert.equal(requests[0].payload.max_tokens, 16_384);
  assert.deepEqual(requests[0].payload.response_format, { type: "json_object" });
});

test("other compatible providers do not receive the DeepSeek thinking option", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return completion();
  });
  const result = await requestAiSummary({
    prompt: "test", env: { ...primaryEnv, AI_SUMMARY_MODEL: "deepseek-compatible-model" },
  });
  assertSummary(result);
  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], "thinking"), false);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
});

test("MiniMax keeps its existing payload without thinking or response_format", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return completion();
  });
  const result = await requestAiSummary({ prompt: "test", env: { MINIMAX_API_KEY: "test-only-key" } });
  assertSummary(result);
  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], "thinking"), false);
  assert.equal(Object.hasOwn(requests[0], "response_format"), false);
});

test("existing quota fallback still succeeds within the shared budget", async (t) => {
  useVirtualClock(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    requests.push({ url, payload: JSON.parse(init.body) });
    return delayedResponse(
      init.signal,
      requests.length === 1 ? 30 : 20,
      requests.length === 1
        ? Response.json({ error: { message: "usage limit exceeded" } }, { status: 429 })
        : completion(),
    );
  });
  const pending = observe(requestAiSummary({
    prompt: "test", env: { ...fallbackEnv, AI_SUMMARY_TIMEOUT_MS: "100" },
  }));
  await advance(t, 30);
  await advance(t, 20);
  const outcome = await pending;
  assert.equal(outcome.error, null);
  assertSummary(outcome.value);
  assert.equal(outcome.value.provider.model, "deepseek-test-fallback");
  assert.equal(requests.length, 2, "quota exhaustion still switches to the configured provider");
  assert.deepEqual(requests[1].payload.thinking, { type: "disabled" });
  assert.equal(requests[1].payload.max_tokens, 16_384);
});

test("HTTP 503 does not add a JSON retry or provider fallback", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json({ error: { message: "AI summary HTTP 503" } }, { status: 503 });
  });
  await assert.rejects(requestAiSummary({ prompt: "test", env: fallbackEnv }), /HTTP 503/);
  assert.equal(requests, 1);
});
