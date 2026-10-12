import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const originalCwd = process.cwd();
const fixtureDir = await mkdtemp(join(tmpdir(), "signal-douyin-deepseek-"));
process.chdir(fixtureDir);
const { refreshDouyinMonitor } = await import("./douyin-monitor.ts");
const { resetAiProviderCircuitBreakers } = await import("./ai-provider-fallback.ts");
process.chdir(originalCwd);
let fixture = 0;

async function runFixture(t, aiEnv, responseStatus = 200) {
  const originalFetch = globalThis.fetch;
  const aiCalls = [];
  const env = {
    DOUYIN_PROVIDER: "tikhub",
    DOUYIN_TIKHUB_API_KEY: "test-tikhub-key",
    DOUYIN_MONITOR_DB: join(fixtureDir, `${++fixture}.sqlite`),
    ...aiEnv,
  };
  resetAiProviderCircuitBreakers();
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname === "api.tikhub.io") {
      return Response.json({ code: 200, data: { aweme_list: [{
        aweme_id: "745600003", desc: "HBM 涨价和 MU 财报观察", create_time: 1770100000,
        share_url: "https://www.douyin.com/video/745600003", author: { nickname: "样本作者" },
      }] } });
    }
    aiCalls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return Response.json(responseStatus === 200 ? {
      choices: [{ message: { content: JSON.stringify({
        coreView: "内容有限：关注 HBM 与 MU 财报线索", assets: ["MU"],
        recommendationReasons: [], catalysts: [], risks: ["内容有限"], followUps: ["核实财报"],
      }) } }],
    } : { error: { message: "quota exceeded" } }, { status: responseStatus });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetAiProviderCircuitBreakers();
  });
  const refresh = () => refreshDouyinMonitor({ env, creators: [{ ref: "test-creator", tags: [] }] });
  return { snapshot: await refresh(), refresh, aiCalls };
}

test("Douyin uses bounded DeepSeek JSON generation and preserves source/cache", async (t) => {
  const { snapshot, refresh, aiCalls } = await runFixture(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key", MINIMAX_API_KEY: "test-minimax-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1", AI_SUMMARY_MODEL: "MiniMax-M2.7",
  });
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(aiCalls[0].init.headers.Authorization, "Bearer test-deepseek-key");
  assert.equal(aiCalls[0].body.model, "deepseek-flash");
  assert.deepEqual(aiCalls[0].body.response_format, { type: "json_object" });
  assert.deepEqual(aiCalls[0].body.thinking, { type: "disabled" });
  assert.equal(aiCalls[0].body.max_tokens, 16384);
  assert.equal(snapshot.videos[0].summary.status, "generated");
  assert.equal(snapshot.videos[0].source, "tikhub");
  const cached = await refresh();
  assert.equal(aiCalls.length, 1, "unchanged videos keep their existing summary");
  assert.deepEqual(cached.videos[0].summary, snapshot.videos[0].summary);
});

test("Douyin-specific DeepSeek model overrides the shared model", async (t) => {
  const { aiCalls } = await runFixture(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key", DEEPSEEK_MODEL: "deepseek-flash", DOUYIN_AI_MODEL: "deepseek-pro",
  });
  assert.equal(aiCalls[0].body.model, "deepseek-pro");
});

test("Douyin without DeepSeek credentials uses its deterministic limited summary", async (t) => {
  const { snapshot, aiCalls } = await runFixture(t, {
    MINIMAX_API_KEY: "test-minimax-key", AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
  });
  assert.equal(aiCalls.length, 0);
  assert.equal(snapshot.videos[0].summary.status, "limited");
  assert.equal(snapshot.videos[0].source, "tikhub");
});

test("Douyin never falls back to a configured non-DeepSeek provider", async (t) => {
  const { snapshot, aiCalls } = await runFixture(t, {
    DEEPSEEK_API_KEY: "test-deepseek-key",
    AI_SUMMARY_FALLBACK_API_KEY: "test-minimax-fallback-key",
    AI_SUMMARY_FALLBACK_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_FALLBACK_MODEL: "MiniMax-M2.7",
  }, 429);
  assert.equal(aiCalls.length, 1);
  assert.equal(new URL(aiCalls[0].url).hostname, "api.deepseek.com");
  assert.equal(snapshot.videos[0].summaryStatus, "error");
  assert.match(snapshot.videos[0].error, /quota exceeded/);
});

test.after(async () => { await rm(fixtureDir, { recursive: true, force: true }); });
