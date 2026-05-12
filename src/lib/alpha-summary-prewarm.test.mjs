import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const prewarmModuleUrl = new URL("./alpha-summary-prewarm.ts", import.meta.url);
const workerUrl = new URL("../../scripts/alpha-summary-worker.mjs", import.meta.url);
const startScriptUrl = new URL("../../scripts/start-signal-hub.ps1", import.meta.url);

assert.equal(
  existsSync(prewarmModuleUrl),
  true,
  "alpha summary prewarm module should exist",
);
assert.equal(
  existsSync(workerUrl),
  true,
  "alpha summary worker script should exist",
);

const {
  getAlphaSummaryPrewarmAudiences,
  getAlphaSummaryPrewarmIntervalMs,
  getAlphaSummaryPrewarmScopes,
  isAlphaSummaryPrewarmEnabled,
  prewarmAlphaSummaryCaches,
} = await import("./alpha-summary-prewarm.ts");

assert.deepEqual(getAlphaSummaryPrewarmScopes({}), [
  "12h",
  "today",
  "3d",
  "7d",
]);
assert.deepEqual(getAlphaSummaryPrewarmAudiences({}), ["signals"]);
assert.equal(getAlphaSummaryPrewarmIntervalMs({}), 30 * 60 * 1000);
assert.equal(
  isAlphaSummaryPrewarmEnabled({ AI_SUMMARY_PREWARM_ENABLED: "false" }),
  false,
);
assert.deepEqual(
  getAlphaSummaryPrewarmScopes({ AI_SUMMARY_PREWARM_SCOPES: "today,3d" }),
  ["today", "3d"],
);
assert.deepEqual(
  getAlphaSummaryPrewarmAudiences({
    AI_SUMMARY_PREWARM_AUDIENCES: "signals,stocks",
  }),
  ["signals", "stocks"],
);

const calls = [];
const results = await prewarmAlphaSummaryCaches({
  env: {},
  now: new Date("2026-05-12T04:00:00.000Z"),
  generateSummary: async (request) => {
    calls.push(request);
    return {
      success: true,
      status: "cached",
      configured: true,
      period: {
        key: `${request.audience}:${request.scope}`,
        scope: request.scope,
        audience: request.audience,
        inputBudgetVersion: 1,
        label: request.scope,
        startAt: "2026-05-12T00:00:00.000Z",
        endAt: "2026-05-12T04:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      generatedAt: "2026-05-12T04:00:00.000Z",
      model: "test",
      itemCount: 1,
      sourceCounts: { telegram: 1, x: 0 },
      summary: null,
      error: null,
    };
  },
});

assert.deepEqual(
  calls.map((call) => `${call.audience}:${call.scope}`),
  ["signals:12h", "signals:today", "signals:3d", "signals:7d"],
);
assert.equal(calls.every((call) => call.force === false), true);
assert.equal(results.length, 4);
assert.equal(results.every((result) => result.success), true);

const startScript = readFileSync(startScriptUrl, "utf8");
assert.match(startScript, /signal-hub-alpha-summary/);
assert.match(startScript, /scripts\\alpha-summary-worker\.mjs/);

const worker = readFileSync(workerUrl, "utf8");
assert.match(worker, /prewarmAlphaSummaryCaches/);
assert.match(worker, /--once/);

console.log("ok - alpha summary background prewarm contract");
