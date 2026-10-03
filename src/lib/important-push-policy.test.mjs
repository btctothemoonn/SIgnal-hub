import assert from "node:assert/strict";
import { opportunityDecision, squeezeMetrics, pushNow, pushNowMs, pushCandleWindow } from "./important-push-test-fixtures.mjs";
const { qualifyOpportunity, qualifySqueeze, qualifySqueezeRecovery, transitionPushEpisode } = await import("./important-push-policy.ts");
const enrichment = { fetchedAt: pushNow, stale: false, error: null };
const qualify = (decision = opportunityDecision(), extra = {}) => qualifyOpportunity({ decision, enrichment, scanId: "scan-1", ...extra }, pushNowMs);
const squeeze = (extra = {}) => qualifySqueeze({ symbol: "TESTUSDT", metrics: squeezeMetrics(), minOiNotional: 2_000_000, observedAt: pushNow, fetchedAt: pushNow, scanId: "raw-1", recovered: false, candleWindow: pushCandleWindow, ...extra }, pushNowMs);

assert.equal(qualify().classification, "qualified", "complete confirmed opportunity qualifies");
for (const [field, value] of [["score", 79], ["confidence", 79], ["decision", "等待确认"], ["decision", "禁止追单"]]) {
  assert.equal(qualify(opportunityDecision({}, { [field]: value })).classification, "complete_unqualified", `${field} must gate confirmation`);
}
assert.equal(qualify(opportunityDecision({ oiGrowth15m: null })).classification, "incomplete");
assert.equal(qualify(opportunityDecision({ stale: true })).classification, "incomplete");
assert.equal(qualify(undefined, { enrichment: { ...enrichment, error: "missing" } }).classification, "incomplete");
for (const time of ["invalid", new Date(pushNowMs + 1).toISOString(), new Date(pushNowMs - 120_001).toISOString()]) {
  assert.equal(qualify(opportunityDecision({}, { observedAt: time })).classification, "incomplete");
  assert.equal(qualify(undefined, { enrichment: { ...enrichment, fetchedAt: time } }).classification, "incomplete");
}
assert.equal(qualify(opportunityDecision({}, { expiresAt: pushNow })).classification, "incomplete");
assert.equal(qualify(opportunityDecision({}, { hardInvalidated: true })).classification, "invalidated");
assert.equal(squeeze().stage, "squeeze_acceleration");
assert.equal(squeeze().classification, "qualified");
for (const field of Object.keys(squeezeMetrics()).filter(key => key !== "breakout20")) {
  assert.equal(squeeze({ metrics: squeezeMetrics({ [field]: null }) }).classification, "incomplete", `raw squeeze needs ${field}`);
}
assert.equal(squeeze({ metrics: squeezeMetrics({ oiGrowth15m: 7, volRatio: 1, breakout20: false, priceChange15m: 1.6, funding: -0.0006, basis: 0 }) }).classification, "complete_unqualified");

const first = transitionPushEpisode(null, [qualify()], pushNowMs);
assert.equal(first.event.stage, "confirmed");
assert.equal(first.event.priority, 0);
assert.match(first.event.target, /^\/alerts\?symbol=TESTUSDT#market-push-TESTUSDT$/);
assert.equal(Date.parse(first.event.expiresAt), pushNowMs + 120_000);
assert.equal(transitionPushEpisode(first.state, [qualify()], pushNowMs).event, null, "same scan is idempotent");
const upgraded = transitionPushEpisode(first.state, [squeeze()], pushNowMs);
assert.equal(upgraded.state.episodeId, first.state.episodeId);
assert.equal(upgraded.event.stage, "squeeze_acceleration");
assert.equal(transitionPushEpisode(upgraded.state, [squeeze({ scanId: "raw-2" })], pushNowMs).event, null);
const combined = transitionPushEpisode(null, [qualify(), squeeze()], pushNowMs);
assert.equal(combined.event.stage, "squeeze_acceleration", "same scan batch coalesces stages");

let state = upgraded.state;
const incomplete = { ...qualify(), classification: "incomplete", scanId: "missing" };
for (let i = 0; i < 5; i++) state = transitionPushEpisode(state, [{ ...incomplete, scanId: `missing-${i}` }], pushNowMs).state;
assert.equal(state.participants["opportunity:capital_long"].unqualifiedScans, 0);
for (let i = 0; i < 3; i++) {
  state = transitionPushEpisode(state, [{ ...qualify(), classification: "complete_unqualified", scanId: `exit-${i}` }], pushNowMs).state;
  state = transitionPushEpisode(state, [{ ...squeeze(), classification: "complete_unqualified", scanId: `raw-exit-${i}` }], pushNowMs).state;
}
assert.equal(state.endedAt, null, "raw squeeze waits for explicit recovery");
const recovery = { ...squeeze(), classification: "recovered", scanId: "raw-recovered" };
state = transitionPushEpisode(state, [recovery], pushNowMs).state;
assert.equal(state.endedAt, pushNow);
const restarted = transitionPushEpisode(state, [{ ...qualify(), scanId: "new-confirmation" }], pushNowMs + 1);
assert.notEqual(restarted.state.episodeId, state.episodeId);
assert.equal(restarted.event.stage, "confirmed");
assert.equal(transitionPushEpisode(null, [incomplete], pushNowMs).state, null, "missing input does not create an episode");
const otherDirection = transitionPushEpisode(null, [{ ...qualify(), direction: "SHORT" }], pushNowMs);
assert.notEqual(otherDirection.state.episodeId, first.state.episodeId);
assert.throws(() => transitionPushEpisode(first.state, [{ ...qualify(), symbol: "OTHERUSDT" }], pushNowMs), /identity/);
let recoveryState = transitionPushEpisode(null, [squeeze()], pushNowMs).state;
for (let i = 0; i < 3; i++) {
  const recoveryAt = new Date(pushNowMs + i).toISOString();
  const item = qualifySqueezeRecovery({ symbol: "TESTUSDT", funding: 0, oiGrowth15m: 0, observedAt: recoveryAt, fetchedAt: recoveryAt, sampleId: `oi-${i}`, scanId: `recover-${i}` }, pushNowMs + i);
  recoveryState = transitionPushEpisode(recoveryState, [item], pushNowMs + i).state;
  assert.equal(Boolean(recoveryState.endedAt), i === 2, "raw recovery needs three fresh distinct samples");
  recoveryState = transitionPushEpisode(recoveryState, [{ ...item, scanId: `repeat-${i}` }], pushNowMs + i).state;
}
assert.equal(qualifySqueezeRecovery({ symbol: "TESTUSDT", funding: null, oiGrowth15m: 0, observedAt: pushNow, fetchedAt: pushNow, sampleId: "missing", scanId: "missing-recovery" }, pushNowMs).classification, "incomplete");
console.log("important push policy tests passed");
