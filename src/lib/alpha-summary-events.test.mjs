import assert from "node:assert/strict";
import { buildAlphaSummaryPrompt, getAlphaSummaryPeriod, parseAlphaSummaryContent, shouldReuseCachedAlphaSummary, requestAiSummary } from "./alpha-summary.ts";

const items = [
  { id: "x:1", source: "X", author: "@one", createdAt: "2026-09-17T01:00:00Z", text: "ALPHA launch date is disputed", translation: null, link: "https://x.com/one/status/1" },
  { id: "tg:2", source: "Telegram", author: "Channel", createdAt: "2026-09-17T02:00:00Z", text: "Reposted launch discussion", translation: null, link: "https://t.me/channel/2" },
];
const event = { topic: "ALPHA", title: "Launch discussion", change: "New launch discussion", impact: "Potential interest, not confirmed", watch: ["Official date"], evidence: "unverified", sourceIds: ["x:1"] };
const raw = { headline: "No confirmed date", authors: [], consensus: [], risks: [], watchlist: [], eventBrief: { version: 2, overview: ["New launch discussion"], events: [event, { ...event, sourceIds: ["tg:2"] }], disagreements: ["Date remains disputed"], followUps: [{ subject: "ALPHA", trigger: "Official date", time: "", risk: "No announcement", sourceIds: ["tg:2"] }] } };
const parse = (value = raw) => parseAlphaSummaryContent(JSON.stringify(value), { sourceItems: items, requireEvents: true });
const parsed = parse();
assert.equal(parsed.eventBrief?.version, 2, "new event schema must survive parsing");
assert.equal(parsed.eventBrief.events.length, 1, "duplicate event titles merge across authors");
assert.deepEqual(parsed.eventBrief.events[0].sources.map(s => s.id), ["x:1", "tg:2"]);
assert.equal(parsed.eventBrief.events[0].sources[0].link, items[0].link);
assert.equal(parsed.eventBrief.followUps[0].time, "", "never invent a date");
assert.deepEqual(parseAlphaSummaryContent(JSON.stringify(parsed)), parsed, "cached event summaries round trip");
const forged = structuredClone(raw);
forged.eventBrief.events = [{ ...event, evidence: "official", sources: [{ id: "x:1", link: "https://fake.test", author: "Official" }] }];
const grounded = parse(forged).eventBrief.events[0];
assert.equal(grounded.sources[0].author, "@one");
assert.equal(grounded.sources[0].link, items[0].link, "model-supplied links cannot override original messages");
assert.equal(grounded.evidence, "unverified", "a model cannot mark a KOL message as verified official news");
forged.eventBrief.events[0].sourceIds = ["invented"];
assert.throws(() => parse(forged), /source/i, "events without real references must be regenerated");
forged.eventBrief.events[0].sourceIds = ["x:1", "invented"];
assert.throws(() => parse(forged), /source/i, "a valid reference cannot hide an invented reference");
const conflicting = structuredClone(raw);
conflicting.eventBrief.events[1].change = "Launch cancelled";
assert.throws(() => parse(conflicting), /conflict/i, "contradictory facts must not inherit merged citations");
assert.throws(() => parse({ ...raw, eventBrief: undefined }), /event/i);
assert.equal(parseAlphaSummaryContent(JSON.stringify({ ...raw, eventBrief: undefined })).headline, raw.headline, "legacy caches remain readable");
const empty = structuredClone(raw);
empty.eventBrief.events = [];
empty.eventBrief.followUps = [];
empty.eventBrief.overview = ["No important changes"];
assert.equal(parse(empty).eventBrief.events.length, 0, "no forced opportunities");
const unsafeItems = [{ ...items[0], link: "javascript:alert(1)" }, items[1]];
assert.equal(parseAlphaSummaryContent(JSON.stringify(raw), { sourceItems: unsafeItems, requireEvents: true }).eventBrief.events[0].sources[0].link, "");
const now = new Date("2026-09-17T03:00:00Z");
const period = getAlphaSummaryPeriod({ now });
const snapshot = { success: true, status: "cached", period, generatedAt: now.toISOString(), summary: { ...raw, eventBrief: undefined } };
assert.equal(shouldReuseCachedAlphaSummary({ snapshot, now, env: {}, scope: "12h" }), false, "old signal format refreshes without deleting cached content");
assert.equal(shouldReuseCachedAlphaSummary({ snapshot: { ...snapshot, status: "error", success: false }, now, env: {}, scope: "12h" }), true, "failed upgrade retains bounded retry cadence");
assert.equal(shouldReuseCachedAlphaSummary({ snapshot: { ...snapshot, summary: parsed }, now, env: {}, scope: "12h" }), true);
assert.equal(shouldReuseCachedAlphaSummary({ snapshot: { ...snapshot, period: { ...period, audience: "stocks" } }, now, env: {}, scope: "12h" }), true, "STOCKS format is unchanged");
for (const scope of ["12h", "today", "3d", "7d"]) {
  const prompt = buildAlphaSummaryPrompt({ period: getAlphaSummaryPeriod({ now, scope }), items, previousSummary: parsed });
  assert.match(prompt, /eventBrief/);
  assert.match(prompt, /x:1/);
  assert.match(prompt, /转发.*独立/);
  assert.match(prompt, /不.*指令/);
  assert.match(prompt, /上次总结/);
  assert.match(prompt, scope === "12h" || scope === "today" ? /新增变化/ : /观点变化/);
}
const stocksPrompt = buildAlphaSummaryPrompt({ period: getAlphaSummaryPeriod({ now, audience: "stocks" }), items });
assert.doesNotMatch(stocksPrompt, /eventBrief/);
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? forged : raw) } }] });
};
try {
  const generated = await requestAiSummary({ prompt: "test", env: { AI_SUMMARY_API_KEY: "test", AI_SUMMARY_BASE_URL: "https://summary.test/v1", AI_SUMMARY_MODEL: "test" }, sourceItems: items, requireEvents: true });
  assert.equal(calls, 2, "invalid source references trigger the bounded correction retry");
  assert.equal(generated.summary.eventBrief.events[0].sources[0].link, items[0].link);
} finally { globalThis.fetch = originalFetch; }
console.log("ok - event summary source grounding, deduplication, legacy cache upgrade and scoped prompt");
