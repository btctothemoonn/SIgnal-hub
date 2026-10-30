import assert from "node:assert/strict";
import { X_OWNED_READER_DEFAULT_USERNAMES } from "../src/lib/x-owned-reader-config.ts";
import { evaluateOwnedReaderReadiness } from "./owned-reader-readiness.mjs";

const startedAt = "2026-10-04T02:00:00Z";
const fresh = { lastAttemptAt: "2026-10-04T02:00:10Z", lastSuccessfulCheckAt: "2026-10-04T02:00:40Z" };
const entry = overrides => ({ username: "a", route: "owned-reader", status: "complete", ...fresh, ...overrides });
const snapshot = accounts => ({ enabled: true, trial: true, accounts });
const result = accounts => evaluateOwnedReaderReadiness(snapshot(accounts), startedAt);

assert.deepEqual(evaluateOwnedReaderReadiness({ enabled: false, accounts: [] }, startedAt), { ready: true, fatal: false, reason: "disabled", warnings: [] });
assert.equal(evaluateOwnedReaderReadiness({ enabled: true }, startedAt).reason, "invalid_coverage");
assert.equal(evaluateOwnedReaderReadiness(snapshot([]), startedAt).fatal, true);
assert.equal(evaluateOwnedReaderReadiness(snapshot([]), startedAt).reason, "no_assigned_authors");
assert.equal(result([entry({})]).ready, true);
assert.equal(result([entry({ lastSuccessfulCheckAt: "2026-10-03T20:00:00Z", lastAttemptAt: "2026-10-03T20:00:00Z" })]).ready, false);
assert.equal(result([entry({}), entry({ username: "b", lastSuccessfulCheckAt: null, status: "reading" })]).ready, false);
assert.equal(result([entry({ status: "paused", reason: "authentication_required" })]).fatal, true);
assert.equal(result([entry({ status: "paused", reason: "authentication_required" })]).reason, "session_unavailable");
assert.equal(result([entry({ status: "incomplete", lastSuccessfulCheckAt: null })]).ready, false);
assert.equal(result([entry({}), { username: "other", route: "monitor985", status: "paused", reason: "authentication_required" }]).ready, true);

for (const reason of ["rate_limited", "session_cooldown", "rate_budget_soft_cooldown", "request_budget_reached"]) {
  const cooling = result([
    entry({ username: "PhotonCap", status: "paused", reason, lastSuccessfulCheckAt: "2026-10-03T20:00:00Z", cooling: true }),
    entry({ username: "semianalysis_", status: "paused", reason, structuralIsolated: true, structuralIncomplete: true, lastSuccessfulCheckAt: null }),
  ]);
  assert.equal(cooling.ready, true, reason);
  assert.equal(cooling.fatal, false, reason);
  assert.equal(cooling.reason, "rate_limited_cooldown", reason);
  assert.ok(cooling.warnings.some(warning => warning.startsWith("structural:semianalysis_")), reason);
  assert.ok(cooling.warnings.includes(`cooldown:${reason}`), reason);
}

const structural = result([
  entry({ username: "PhotonCap" }),
  entry({ username: "semianalysis_", status: "incomplete", reason: "structural_isolated", structuralIsolated: true, structuralIncomplete: true, lastSuccessfulCheckAt: null, lastAttemptAt: null }),
  entry({ username: "ai_9684xtpa", status: "incomplete", reason: "unknown_conversation_module", lastSuccessfulCheckAt: null, lastAttemptAt: null }),
]);
assert.equal(structural.ready, true);
assert.equal(structural.fatal, false);
assert.equal(structural.reason, "authors_checked");
assert.deepEqual(structural.warnings, ["structural:semianalysis_:structural_isolated", "structural:ai_9684xtpa:unknown_conversation_module"]);

const onlyStructural = result([
  entry({ username: "semianalysis_", status: "incomplete", reason: "timeline_structure_unrecognized", lastSuccessfulCheckAt: null, lastAttemptAt: null }),
]);
assert.equal(onlyStructural.ready, true);
assert.equal(onlyStructural.fatal, false);
assert.equal(onlyStructural.reason, "structural_isolated");

assert.equal(result([entry({ status: "error", reason: "configuration_missing" })]).reason, "configuration_missing");
assert.equal(result([entry({ status: "paused", reason: "session_unavailable" })]).reason, "session_unavailable");
assert.equal(result([entry({ status: "paused", reason: "login_or_access_challenge" })]).reason, "session_unavailable");
assert.equal(result([
  entry({ username: "one", status: "error", reason: "bridge_failed", lastSuccessfulCheckAt: null }),
  entry({ username: "two", status: "failed", reason: "sdk_unavailable", lastSuccessfulCheckAt: null }),
]).reason, "process_down");
assert.equal(result([
  entry({ username: "one", status: "paused", reason: "bridge_failed" }),
  entry({ username: "two", status: "paused", reason: "protocol_invalid" }),
]).reason, "process_down");

const oneBridgeError = result([
  entry({ username: "one" }),
  entry({ username: "two" }),
  entry({ username: "three" }),
  entry({ username: "four" }),
  entry({ username: "five", status: "error", reason: "bridge_failed", lastSuccessfulCheckAt: null }),
]);
assert.equal(oneBridgeError.ready, true, "one bridge error does not fail an 80% sample");
assert.equal(oneBridgeError.fatal, false);

const seeds = X_OWNED_READER_DEFAULT_USERNAMES.map(username => entry({ username }));
const extras = ["extra1", "extra2", "extra3"].map(username => entry({ username, status: "reading", lastSuccessfulCheckAt: null, lastAttemptAt: null }));
const seedSample = result([...seeds, ...extras]);
assert.equal(seedSample.ready, true, "the seed authors alone satisfy first-check readiness");
assert.equal(seedSample.reason, "authors_checked");

const mostlyChecked = result([
  entry({ username: "one" }),
  entry({ username: "two" }),
  entry({ username: "three" }),
  entry({ username: "four" }),
  entry({ username: "five", status: "reading", lastSuccessfulCheckAt: null }),
]);
assert.equal(mostlyChecked.ready, true, "80% of eligible authors satisfy first-check readiness");

const belowSample = result([
  ...X_OWNED_READER_DEFAULT_USERNAMES.slice(0, 6).map(username => entry({ username })),
  entry({ username: X_OWNED_READER_DEFAULT_USERNAMES[6], status: "reading", lastSuccessfulCheckAt: null }),
  entry({ username: "extra1", status: "reading", lastSuccessfulCheckAt: null }),
  entry({ username: "extra2", status: "reading", lastSuccessfulCheckAt: null }),
  entry({ username: "extra3", status: "reading", lastSuccessfulCheckAt: null }),
]);
assert.equal(belowSample.ready, false);
assert.equal(belowSample.fatal, false);
assert.equal(belowSample.reason, "waiting_for_first_checks");
assert.ok(belowSample.warnings.includes("sample:6/10"));

console.log("ok - release readiness fails closed only for process, session, config, or a missed author sample");
