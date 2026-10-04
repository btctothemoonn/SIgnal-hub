import assert from "node:assert/strict";
import { getXOwnedReaderConfig, selectXOwnedReaderAccounts } from "./x-owned-reader-config.ts";

const disabled = getXOwnedReaderConfig({});
assert.equal(disabled.enabled, false);
assert.deepEqual(selectXOwnedReaderAccounts(["Hzzzz666", "PHOTONCAP", "Established985", "newAuthor"], disabled), ["Hzzzz666", "PHOTONCAP"]);
const enabled = getXOwnedReaderConfig({ X_OWNED_READER_ENABLED: "true", X_OWNED_READER_USERNAMES: "@PhotonCap,newAuthor", X_OWNED_READER_MAX_REQUESTS: "900", X_OWNED_READER_DEADLINE_MS: "999999", X_OWNED_READER_MIN_INTERVAL_MS: "1", X_OWNED_READER_MAX_PAGES: "90", X_OWNED_READER_INTERVAL_MS: "1" });
assert.equal(enabled.enabled, true);
assert.deepEqual(selectXOwnedReaderAccounts(["PHOTONCAP", "newAuthor", "Hzzzz666", "Other"], enabled), ["PHOTONCAP", "newAuthor"]);
assert.equal(enabled.maxRequests, 80);
assert.equal(enabled.deadlineMs, 180000);
assert.equal(enabled.minIntervalMs, 2000);
assert.equal(enabled.maxPages, 5);
assert.equal(enabled.intervalMs, 300000);
assert.deepEqual(selectXOwnedReaderAccounts(["hzzzz666", "Hzzzz666", "bad-name", "truth:Someone"], disabled), ["hzzzz666"]);
console.log("Owned config: disabled default, explicit allowlist, configured intersection and hard budget bounds passed.");
