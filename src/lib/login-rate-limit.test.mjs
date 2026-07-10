import assert from "node:assert/strict";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  getLoginClientKey,
  LOGIN_FAILURE_WINDOW_MS,
  recordLoginFailure,
  resetLoginRateLimitsForTests,
} from "./login-rate-limit.ts";

const now = Date.UTC(2026, 6, 10, 8, 0, 0);

resetLoginRateLimitsForTests();
for (let index = 0; index < 5; index += 1) {
  assert.equal(checkLoginRateLimit("ip:203.0.113.7", now + index).allowed, true);
  recordLoginFailure("ip:203.0.113.7", now + index);
}

const blocked = checkLoginRateLimit("ip:203.0.113.7", now + 5);
assert.equal(blocked.allowed, false);
assert.ok(blocked.retryAfterSeconds > 0);
assert.equal(checkLoginRateLimit("ip:198.51.100.2", now + 5).allowed, true);

assert.equal(
  checkLoginRateLimit(
    "ip:203.0.113.7",
    now + LOGIN_FAILURE_WINDOW_MS + 5,
  ).allowed,
  true,
);

recordLoginFailure("ip:203.0.113.7", now + LOGIN_FAILURE_WINDOW_MS + 6);
clearLoginFailures("ip:203.0.113.7");
assert.equal(
  checkLoginRateLimit(
    "ip:203.0.113.7",
    now + LOGIN_FAILURE_WINDOW_MS + 7,
  ).allowed,
  true,
);

assert.equal(
  getLoginClientKey(
    new Request("https://holdrich.online/api/login", {
      headers: { "x-forwarded-for": "203.0.113.9, 127.0.0.1" },
    }),
  ),
  "ip:203.0.113.9",
);
assert.equal(
  getLoginClientKey(
    new Request("https://holdrich.online/api/login", {
      headers: { "x-real-ip": "198.51.100.8" },
    }),
  ),
  "ip:198.51.100.8",
);
assert.equal(
  getLoginClientKey(new Request("https://holdrich.online/api/login")),
  "ip:unknown",
);

console.log("ok - admin login failures are bounded per client");
