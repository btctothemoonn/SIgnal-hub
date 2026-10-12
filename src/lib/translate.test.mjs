import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTranslationText, getTranslationProviderNames, translateText } from "./translate.ts";

const envNames = [
  "AI_TRANSLATION_ALLOW_SUMMARY_KEY", "AI_TRANSLATION_API_KEY", "AI_TRANSLATION_BASE_URL",
  "AI_TRANSLATION_MODEL", "TRANSLATION_PROVIDERS", "MINIMAX_API_KEY", "MINIMAX_BASE_URL",
  "AI_SUMMARY_API_KEY", "AI_SUMMARY_BASE_URL", "AI_SUMMARY_MODEL",
  "AI_SUMMARY_FALLBACK_API_KEY", "AI_SUMMARY_FALLBACK_BASE_URL", "AI_SUMMARY_FALLBACK_MODEL",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
  "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
];
const source = "NVDA supplier checks raised. Cloud capex remains strong.";
const translatedText = "NVDA 供应商检查上修，云资本开支仍然强劲。";
let namespace = 0;

function setup(t, env = {}, response = () => Response.json({
  choices: [{ message: { content: `<think>private reasoning</think>\nTranslation: ${translatedText}` } }],
})) {
  const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, { TRANSLATION_PROVIDERS: "minimax", ...env });
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return response();
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return { requests, options: { cacheNamespace: `deepseek-translation-${++namespace}` } };
}

test("DeepSeek is the sole runtime translator despite legacy provider settings", async (t) => {
  const { requests, options } = setup(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key",
    MINIMAX_API_KEY: "test-minimax-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  });
  assert.deepEqual(getTranslationProviderNames(), ["deepseek"]);
  const translation = await translateText(source, options);
  assert.deepEqual(translation, {
    provider: "deepseek", sourceLanguage: "auto", targetLanguage: "zh-CN", text: translatedText,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-deepseek-key");
  assert.equal(requests[0].body.model, "deepseek-flash");
  assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
  assert.equal(requests[0].body.max_tokens, 16384);
  assert.equal(requests[0].body.response_format, undefined, "translations are plain text, not JSON");
  assert.match(requests[0].body.messages[1].content, /NVDA supplier checks raised/);
  assert.equal(await translateText(source, options), translation, "successful translations remain cached");
  assert.equal(requests.length, 1);
});

test("legacy Google and MyMemory configuration cannot select another provider", (t) => {
  setup(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key",
    TRANSLATION_PROVIDERS: "google,minimax,mymemory",
  });
  assert.deepEqual(getTranslationProviderNames(), ["deepseek"]);
});

test("translation-specific DeepSeek models override the shared model", async (t) => {
  const { requests, options } = setup(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key",
    DEEPSEEK_MODEL: "deepseek-flash",
    AI_TRANSLATION_MODEL: "deepseek-pro",
  });
  assert.ok(await translateText(source, options));
  assert.equal(requests[0].body.model, "deepseek-pro");
});

test("a translation key is reusable only with its official DeepSeek endpoint", async (t) => {
  const { requests, options } = setup(t, {
    AI_TRANSLATION_API_KEY: "test-translation-key",
    AI_TRANSLATION_BASE_URL: "https://api.deepseek.com/v1",
    AI_TRANSLATION_MODEL: "deepseek-flash",
  });
  assert.equal((await translateText(source, options))?.provider, "deepseek");
  assert.equal(new URL(requests[0].url).hostname, "api.deepseek.com");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-translation-key");
});

test("other providers' credentials do not enable or receive translation requests", async (t) => {
  const { requests, options } = setup(t, {
    MINIMAX_API_KEY: "test-minimax-key",
    AI_TRANSLATION_API_KEY: "test-other-translation-key",
    AI_TRANSLATION_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_API_KEY: "test-summary-key",
    AI_SUMMARY_BASE_URL: "https://api.openai.com/v1",
    AI_TRANSLATION_ALLOW_SUMMARY_KEY: "true",
  });
  assert.deepEqual(getTranslationProviderNames(), []);
  assert.equal(await translateText(source, options), null);
  assert.equal(requests.length, 0);
});

test("a paired DeepSeek summary key supports translation without legacy opt-in", async (t) => {
  const { requests, options } = setup(t, {
    AI_SUMMARY_API_KEY: "test-summary-key",
    AI_SUMMARY_BASE_URL: "https://api.deepseek.com",
    AI_SUMMARY_MODEL: "deepseek-flash",
  });
  assert.equal((await translateText(source, options))?.provider, "deepseek");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-summary-key");
});

test("translation failures return null and never fall back to MiniMax", async (t) => {
  const { requests, options } = setup(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key", MINIMAX_API_KEY: "test-minimax-key",
  }, () => Response.json({ error: { message: "unavailable" } }, { status: 503 }));
  assert.equal(await translateText(source, options), null);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).hostname, "api.deepseek.com");
});

test("concurrent translations share one request and preserve cleaning", async (t) => {
  const { requests, options } = setup(t, { DEEPSEEK_API_KEY: "test-deepseek-key" });
  const translations = await Promise.all([translateText(source, options), translateText(source, options)]);
  assert.equal(requests.length, 1);
  assert.equal(translations[0]?.text, translatedText);
  assert.equal(translations[0], translations[1]);
  assert.equal(cleanTranslationText("最终译文：“NVDA 供应链需求仍强劲。”"), "NVDA 供应链需求仍强劲。");
});
