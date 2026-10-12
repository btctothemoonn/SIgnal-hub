import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAlphaSummaryProviderCandidates as providers,
  getAlphaSummaryModel as model,
  isDeepSeekBaseUrl,
} from "./alpha-summary.ts";

test("all AI generation defaults to the current DeepSeek model", () => {
  assert.equal(model({}), "deepseek-flash");
  assert.equal(model({ DEEPSEEK_API_KEY: "test-deepseek", AI_SUMMARY_MODEL: "MiniMax-M3" }), "deepseek-flash");
  assert.equal(model({ DEEPSEEK_MODEL: "deepseek-v4-pro" }), "deepseek-v4-pro");
});

test("legacy non-DeepSeek credentials are never reused or called as fallback", () => {
  assert.deepEqual(providers({ MINIMAX_API_KEY: "test-minimax", OPENAI_API_KEY: "test-openai" }), []);
  const result = providers({ DEEPSEEK_API_KEY: "test-deepseek", AI_SUMMARY_FALLBACK_API_KEY: "test-minimax", AI_SUMMARY_FALLBACK_BASE_URL: "https://api.minimaxi.com/v1" });
  assert.deepEqual(result.map(p => p.id), ["deepseek"]);
  assert.equal(result[0].apiKey, "test-deepseek");
});

test("an existing official DeepSeek fallback becomes the active provider", () => {
  const result = providers({ AI_SUMMARY_API_KEY: "test-minimax", AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1", AI_SUMMARY_FALLBACK_API_KEY: "test-deepseek", AI_SUMMARY_FALLBACK_BASE_URL: "https://api.deepseek.com", AI_SUMMARY_FALLBACK_MODEL: "deepseek-v4-pro" });
  assert.deepEqual(result.map(p => [p.id, p.baseUrl, p.apiKey, p.model]), [["deepseek", "https://api.deepseek.com", "test-deepseek", "deepseek-v4-pro"]]);
});

test("official endpoint matching rejects lookalikes and credential-bearing URLs", () => {
  for (const baseUrl of ["https://api.deepseek.com.evil.test", "https://evil.test/deepseek.com", "http://api.deepseek.com", "https://user:secret@api.deepseek.com", "https://api.deepseek.com?token=test", "https://api.deepseek.com/unexpected", "https://api.deepseek.com?", "https://api.deepseek.com/#"]) {
    assert.equal(isDeepSeekBaseUrl(baseUrl), false, baseUrl);
    assert.deepEqual(providers({ AI_SUMMARY_API_KEY: "test-only", AI_SUMMARY_BASE_URL: baseUrl }), [], baseUrl);
  }
  assert.equal(isDeepSeekBaseUrl("https://api.deepseek.com/v1/"), true);
});

test("explicit official legacy credentials are supported without transferring unrelated keys", () => {
  const result = providers({ AI_SUMMARY_API_KEY: "test-existing", AI_SUMMARY_BASE_URL: "https://api.deepseek.com/v1/", AI_SUMMARY_MODEL: "deepseek-v4-pro", MINIMAX_API_KEY: "test-other" });
  assert.equal(result.length, 1);
  assert.equal(result[0].apiKey, "test-existing");
  assert.equal(result[0].model, "deepseek-v4-pro");
});

test("a configured invalid DeepSeek endpoint fails closed", () => {
  assert.deepEqual(providers({ DEEPSEEK_API_KEY: "test-deepseek", DEEPSEEK_BASE_URL: "https://untrusted.test/v1" }), []);
});

test("an unpaired legacy fallback credential is not presumed to belong to DeepSeek", () => {
  assert.deepEqual(providers({AI_SUMMARY_FALLBACK_API_KEY: "test-unidentified"}), []);
});

test("an invalid global model does not mask a valid paired DeepSeek override", () => {
  const result = providers({DEEPSEEK_MODEL: "MiniMax-M3", AI_SUMMARY_FALLBACK_API_KEY: "test-existing", AI_SUMMARY_FALLBACK_BASE_URL: "https://api.deepseek.com", AI_SUMMARY_FALLBACK_MODEL: "deepseek-v4-pro"});
  assert.equal(result[0].model, "deepseek-v4-pro");
});
