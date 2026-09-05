import assert from "node:assert/strict";
import * as summaries from "./alpha-summary.ts";

assert.equal(typeof summaries.requestAiSummary, "function", "summary requests need a bounded malformed-output retry");
const originalFetch = globalThis.fetch;
const env = { AI_SUMMARY_API_KEY: "test", AI_SUMMARY_BASE_URL: "https://summary.test/v1", AI_SUMMARY_MODEL: "test" };
const valid = JSON.stringify({ headline: "result", authors: [{ name: "author", sourceCount: 1, coreView: "view", alpha: [], watch: [] }], consensus: [], risks: [], watchlist: [] });
let calls = [];
let mode = "recover";
globalThis.fetch = async (_url, init) => {
  calls.push(JSON.parse(init.body));
  if (mode === "http") return Response.json({ error: { message: "HTTP 503" } }, { status: 503 });
  return Response.json({ choices: [{ message: { content: mode === "recover" && calls.length === 2 ? valid : '{"headline": broken' } }] });
};
try {
  const result = await summaries.requestAiSummary({ prompt: "Summarize supplied messages", env });
  assert.equal(result.summary.headline, "result");
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /JSON/);
  mode = "broken";
  calls = [];
  await assert.rejects(summaries.requestAiSummary({ prompt: "test", env }));
  assert.equal(calls.length, 2, "bad output must not loop indefinitely");
  mode = "http";
  calls = [];
  await assert.rejects(summaries.requestAiSummary({ prompt: "test", env }));
  assert.equal(calls.length, 1, "HTTP errors must use provider fallback, not JSON retry");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("ok - bounded summary JSON retry");
