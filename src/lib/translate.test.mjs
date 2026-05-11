import assert from "node:assert/strict";
import { translateText } from "./translate.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  TRANSLATION_PROVIDERS: process.env.TRANSLATION_PROVIDERS,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  AI_SUMMARY_BASE_URL: process.env.AI_SUMMARY_BASE_URL,
  AI_SUMMARY_MODEL: process.env.AI_SUMMARY_MODEL,
};

const finalTranslation =
  "NVDA \u4f9b\u5e94\u5546\u68c0\u67e5\u4e0a\u4fee\uff0c\u4e91\u8d44\u672c\u5f00\u652f\u4ecd\u7136\u5f3a\u52b2\u3002";
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init });
  return Response.json({
    choices: [
      {
        message: {
          content: `<think>I should translate this financial update directly.</think>\nTranslation: ${finalTranslation}`,
        },
      },
    ],
  });
};

process.env.TRANSLATION_PROVIDERS = "minimax";
process.env.MINIMAX_API_KEY = "test-key";
process.env.AI_SUMMARY_BASE_URL = "https://api.minimaxi.com/v1";
process.env.AI_SUMMARY_MODEL = "MiniMax-M2.7";

try {
  const translated = await translateText(
    "NVDA supplier checks raised. Cloud capex remains strong.",
    {
      targetLanguage: "zh-CN",
      cacheNamespace: `translate-test-${Date.now()}`,
    },
  );

  assert.equal(translated?.provider, "minimax");
  assert.equal(translated?.sourceLanguage, "auto");
  assert.equal(translated?.targetLanguage, "zh-CN");
  assert.equal(translated?.text, finalTranslation);
  assert.equal(translated?.text.includes("<think>"), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.minimaxi.com/v1/chat/completions");
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.model, "MiniMax-M2.7");
  assert.ok(body.messages[1].content.includes("NVDA supplier checks raised"));
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

console.log("ok - translate minimax provider");
