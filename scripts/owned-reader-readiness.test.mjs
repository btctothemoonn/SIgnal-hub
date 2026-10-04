import assert from "node:assert/strict";
import { evaluateOwnedReaderReadiness } from "./owned-reader-readiness.mjs";

const startedAt = "2026-10-04T02:00:00Z";
const entry = overrides => ({ username: "a", route: "owned-reader", status: "complete", lastAttemptAt: "2026-10-04T02:00:10Z", lastSuccessfulCheckAt: "2026-10-04T02:00:40Z", ...overrides });
const snapshot = accounts => ({ enabled: true, trial: true, accounts });
assert.deepEqual(evaluateOwnedReaderReadiness({ enabled: false, accounts: [] }, startedAt), { ready: true, fatal: false, reason: "disabled" });
assert.equal(evaluateOwnedReaderReadiness(snapshot([]), startedAt).ready, false);
assert.equal(evaluateOwnedReaderReadiness(snapshot([entry({})]), startedAt).ready, true);
assert.equal(evaluateOwnedReaderReadiness(snapshot([entry({ lastSuccessfulCheckAt: "2026-10-03T20:00:00Z", lastAttemptAt: "2026-10-03T20:00:00Z" })]), startedAt).ready, false);
assert.equal(evaluateOwnedReaderReadiness(snapshot([entry({}), entry({ username: "b", lastSuccessfulCheckAt: null, status: "reading" })]), startedAt).ready, false);
assert.equal(evaluateOwnedReaderReadiness(snapshot([entry({ status: "paused", reason: "authentication_required" })]), startedAt).fatal, true);
assert.equal(evaluateOwnedReaderReadiness(snapshot([entry({ status: "incomplete", lastSuccessfulCheckAt: null })]), startedAt).ready, false);
console.log("ok - release readiness requires every assigned author to finish after activation");
