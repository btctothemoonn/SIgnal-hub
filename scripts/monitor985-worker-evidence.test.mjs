import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { normalizeMonitor985Event } from "../src/lib/monitor985.ts";

// Exercise the real worker functions with only the network/storage boundaries
// replaced. The event parser and native streaming Response remain real.
const source = readFileSync(new URL("./monitor985-worker.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("worker.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["ingestRawEvent", "parseSseBlock", "readSseStream", "connectSse"];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
function worker({ chunks = [], accepted = true, fetchFails = false } = {}) {
  const observations = [], states = [], health = [], phases = [];
  const create = new Function("fetch", "record985RawPayload", "record985StreamState", "normalizeMonitor985Event", "shouldAcceptUpdate", "translateMonitor985Update", "refreshMonitor985Update", "upsertXPipelineRealtimeUpdate", "markHealth", "requestUrl", "requestHeaders", "SSE_EVENT_TYPES", "log", `${functions}\nreturn { ingestRawEvent, connectSse };`);
  const api = create(
    async () => { if (fetchFails) throw new Error("upstream failed"); return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } })); },
    payload => { observations.push(payload.content.id); phases.push("raw"); },
    state => states.push(state), normalizeMonitor985Event,
    () => { phases.push("filter"); return accepted; },
    async update => { phases.push("translate"); return update; },
    async update => update,
    () => phases.push("write"),
    state => health.push(state), path => `https://985.example${path}`, () => ({}), new Set(["twitter", "truth"]), () => {},
  );
  return { ...api, observations, states, health, phases };
}
const event = { eventType: "NEW_TWEET", twAccount: "research", createdAt: "2026-10-04T03:00:00Z", content: { id: "2106520000000000001", userScreenName: "research", text: "Public research", createdAt: "2026-10-04T03:00:00Z" } };
const mediaOnly = worker();
assert.equal((await mediaOnly.ingestRawEvent({ ...event, content: { ...event.content, text: "" } }, new Set())).accepted, false);
assert.deepEqual(mediaOnly.observations, ["2106520000000000001"], "raw media-only posts retain receipt evidence even when normalization declines them");
assert.deepEqual(mediaOnly.phases, ["raw"]);
const filtered = worker({ accepted: false });
assert.equal((await filtered.ingestRawEvent(event, new Set())).accepted, false);
assert.deepEqual(filtered.observations, ["2106520000000000001"], "985 receipt evidence survives local filtering");
assert.deepEqual(filtered.phases, ["raw", "filter"]);
const accepted = worker();
assert.equal((await accepted.ingestRawEvent(event, new Set())).accepted, true);
assert.deepEqual(accepted.phases, ["raw", "filter", "translate", "write"], "raw arrival must be recorded before translation can stall");
const noReady = worker({ chunks: [": heartbeat\n\n"] });
await noReady.connectSse(new Set());
assert.deepEqual(noReady.states, ["disconnected", "heartbeat", "disconnected"]);
assert.ok(!noReady.health.includes("connected"), "HTTP 200 without SSE ready is insufficient connection evidence");
const ready = worker({ chunks: ["event: ready\ndata: {}\n\n", ": heartbeat\n\n"] });
await ready.connectSse(new Set());
assert.deepEqual(ready.states, ["disconnected", "heartbeat", "connected", "heartbeat", "disconnected"]);
const failed = worker({ fetchFails: true });
await assert.rejects(failed.connectSse(new Set()), /upstream failed/);
assert.deepEqual(failed.states, ["disconnected", "disconnected"]);
console.log("ok -985worker records arrival before processing and only trusts a live ready SSE stream");
