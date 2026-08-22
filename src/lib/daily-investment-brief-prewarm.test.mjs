import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const prewarmModuleUrl = new URL(
  "./daily-investment-brief-prewarm.ts",
  import.meta.url,
);
const workerUrl = new URL(
  "../../scripts/daily-brief-worker.mjs",
  import.meta.url,
);
const startScriptUrl = new URL(
  "../../scripts/start-signal-hub.ps1",
  import.meta.url,
);
const packageJsonUrl = new URL("../../package.json", import.meta.url);

assert.equal(existsSync(prewarmModuleUrl), true);
assert.equal(existsSync(workerUrl), true);

const {
  getDailyBriefWorkerIntervalMs,
  isDailyBriefPrewarmEnabled,
  prewarmDailyInvestmentBrief,
} = await import("./daily-investment-brief-prewarm.ts");

assert.equal(getDailyBriefWorkerIntervalMs({}), 15 * 60 * 1000);
assert.equal(
  isDailyBriefPrewarmEnabled({ DAILY_BRIEF_ENABLED: "false" }),
  false,
);

const calls = [];
const skipped = await prewarmDailyInvestmentBrief({
  now: new Date("2026-08-22T23:59:00.000Z"),
  env: {},
  generateBrief: async (request) => {
    calls.push(request);
    throw new Error("must not run before target time");
  },
});
assert.equal(skipped.status, "skipped");
assert.equal(calls.length, 0);

const due = await prewarmDailyInvestmentBrief({
  now: new Date("2026-08-23T00:00:00.000Z"),
  env: {},
  generateBrief: async (request) => {
    calls.push(request);
    return {
      success: true,
      status: "cached",
      configured: true,
      period: {
        key: "2026-08-23",
        dateKey: "2026-08-23",
        label: "2026 年 8 月 23 日",
        startAt: "2026-08-21T12:00:00.000Z",
        endAt: "2026-08-23T00:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      generatedAt: "2026-08-23T00:00:00.000Z",
      model: "MiniMax-M2.7",
      candidateCount: 2,
      sourceCounts: { Reuters: 1, "AP News": 1 },
      brief: null,
      error: null,
    };
  },
});
assert.equal(due.status, "cached");
assert.equal(calls[0].force, false);

const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
assert.equal(typeof packageJson.scripts["daily-brief:prewarm"], "string");
assert.equal(typeof packageJson.scripts["daily-brief:prewarm:once"], "string");

const startScript = readFileSync(startScriptUrl, "utf8");
assert.match(startScript, /signal-hub-daily-brief/);
assert.match(startScript, /scripts\\daily-brief-worker\.mjs/);

const worker = readFileSync(workerUrl, "utf8");
assert.match(worker, /prewarmDailyInvestmentBrief/);
assert.match(worker, /--once/);

console.log("ok - daily investment brief background prewarm contract");
