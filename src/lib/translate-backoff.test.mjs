import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = mkdtempSync(join(tmpdir(), "translate-backoff-"));
process.env.SIGNAL_HUB_RUNTIME_DIR = runtimeDir;
process.env.AI_TRANSLATION_API_KEY = "backoff-test-key";
delete process.env.AI_TRANSLATION_BASE_URL;
delete process.env.AI_TRANSLATION_MODEL;
delete process.env.AI_TRANSLATION_THINKING;

const { translateText, getTranslationRetryAt, isTranslationDeferred } = await import("./translate.ts");
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const requests = [];
let reply;
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init.body)));
  return Response.json(reply());
};
const ns = () => `backoff-${requests.length}-${Math.random()}`;

try {
  // Model spends the token budget (finish_reason "length"): a text failure with backoff.
  const longText = "A long research letter that the model could not finish translating within its token budget today.";
  reply = () => ({ choices: [{ finish_reason: "length", message: { content: "<think>still thinking" } }] });
  assert.equal(await translateText(longText, { cacheNamespace: ns() }), null);
  assert.equal(requests.length, 1);
  assert.ok(isTranslationDeferred(longText), "truncated output starts per-text backoff");
  assert.equal(await translateText(longText, { cacheNamespace: ns() }), null);
  assert.equal(requests.length, 1, "no provider request while the text is in backoff");

  // Unusable output (identical to the source) backs off with growing delays.
  const echoText = "The model keeps echoing this English sentence back without translating it.";
  reply = () => ({ choices: [{ finish_reason: "stop", message: { content: echoText } }] });
  const start = originalNow();
  let now = start;
  Date.now = () => now;
  const delays = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal(await translateText(echoText, { cacheNamespace: ns() }), null);
    delays.push(getTranslationRetryAt(echoText) - now);
    now = getTranslationRetryAt(echoText) + 1;
  }
  assert.deepEqual(delays, [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000, 24 * 3_600_000],
    "backoff grows and is capped at one day");

  // A later success clears the backoff for that text.
  reply = () => ({ choices: [{ finish_reason: "stop", message: { content: "模型终于把这句英文句子完整地翻译成了中文，没有再原样返回。" } }] });
  const note = await translateText(echoText, { cacheNamespace: ns() });
  assert.equal(note?.provider, "minimax");
  assert.equal(getTranslationRetryAt(echoText), 0);
  Date.now = originalNow;

  // Provider-wide failures (quota) are not blamed on the text.
  const quotaText = "Copper futures slipped ahead of the market open on weaker demand.";
  process.env.AI_TRANSLATION_API_KEY = "backoff-quota-key";
  globalThis.fetch = async () => Response.json({ error: { code: "insufficient_quota" } }, { status: 429 });
  assert.equal(await translateText(quotaText, { cacheNamespace: ns() }), null);
  assert.equal(getTranslationRetryAt(quotaText), 0, "quota errors use the provider cooldown, not per-text backoff");

  assert.ok(requests.every((body) => body.thinking?.type === "disabled"));
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log("ok - translate per-text failure backoff and truncated output");
