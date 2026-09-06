import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateWecomPacket, parseWecomPacket } from "./wecom-contract.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`../../docs/integrations/wecom-summary/${name}.example.json`, import.meta.url), "utf8"));
const packet = fixture("report");
for (const name of ["report", "report-business", "ca-alert", "ca-alert-expired", "ca-alert-catchup", "heartbeat"]) {
  const value = fixture(name);
  assert.deepEqual(validateWecomPacket(value), value);
  assert.deepEqual(parseWecomPacket(Buffer.from(JSON.stringify(value))), value);
}
function reject(mutate, code = "payload_invalid") {
  const bad = structuredClone(packet); mutate(bad);
  assert.throws(() => validateWecomPacket(bad), e => e.message === code);
}
reject(p => p.schemaVersion = 1, "unsupported_schema");
reject(p => p.report.sources.push({content:"synthetic raw"}));
reject(p => p.report.sourceReferences[0].content = "synthetic raw");
reject(p => p.report.sourceReferences[2].sender = "invented");
reject(p => p.report.briefing.quick_read.focus.source_message_ids = ["M9999"]);
reject(p => p.report.sourceCount = true);
reject(p => p.report.scope.missingCount = 0);
reject(p => p.report.sourceReferences[0].sender = "x".repeat(201));
reject(p => p.report.briefing.quick_read.focus.text = "\ud800");
reject(p => p.report.briefing.quick_read.focus.text = "\u0085");
reject(p => p.report.summary = "password=synthetic-secret-value", "payload_sensitive");
assert.throws(() => parseWecomPacket(Buffer.from('{"schemaVersion":2,"schemaVersion":2}')), e => e.message === "duplicate_json_key");
assert.throws(() => parseWecomPacket(Buffer.from([0xff])), e => e.message === "payload_invalid");
assert.throws(() => parseWecomPacket(Buffer.alloc(262145)), e => e.message === "payload_too_large");
const micro=fixture("ca-alert");
micro.alert.evaluatedAt="2026-09-06T00:30:00.000001Z";
micro.alert.triggeredAt="2026-09-06T00:30:00.000000Z";
micro.alert.lastSeenAt="2026-09-06T00:30:00.000002Z";
assert.throws(()=>validateWecomPacket(micro),e=>e.message==="payload_invalid","microsecond ordering must not disappear");
const narrow=fixture("report");
narrow.report.windowStart="2026-09-06T00:00:00.000001Z";
narrow.report.windowEnd="2026-09-06T00:00:00.000002+00:00";
assert.doesNotThrow(()=>validateWecomPacket(narrow),"positive microsecond windows are valid");
for(const numeric of ["2.0000000000000001","2e0"]){
 const raw=JSON.stringify(fixture("heartbeat")).replace('"schemaVersion":2',`"schemaVersion":${numeric}`);
 assert.throws(()=>parseWecomPacket(Buffer.from(raw)),e=>e.message==="payload_invalid","JSON numeric rounding must not hide noninteger wire values");
}
console.log("ok - strict WeCom v2 contract fixtures and rejection boundaries");
