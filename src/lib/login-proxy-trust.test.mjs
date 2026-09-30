import assert from "node:assert/strict";
import test from "node:test";
import { getLoginClientKey, recordLoginFailure, checkLoginRateLimit, resetLoginRateLimitsForTests } from "./login-rate-limit.ts";

const request = (forwarded, realIp = "203.0.113.10") => new Request("https://hub.example/api/login", {
  headers: { "x-forwarded-for": forwarded, "x-real-ip": realIp },
});
test("changing untrusted IP headers does not reset a login lockout", () => {
  resetLoginRateLimitsForTests();
  const now = Date.parse("2026-09-30T02:00:00Z");
  for (let i = 0; i < 5; i++) recordLoginFailure(getLoginClientKey(request("198.51.100.1"), {}), now);
  assert.equal(checkLoginRateLimit(getLoginClientKey(request("198.51.100.2", "203.0.113.11"), {}), now).allowed, false);
});
test("an explicitly trusted proxy uses its single real IP header instead of caller-supplied XFF", () => {
  const env = { ADMIN_LOGIN_TRUST_PROXY: "true" };
  assert.equal(getLoginClientKey(request("198.51.100.1, 203.0.113.10"), env), "ip:203.0.113.10");
  assert.equal(getLoginClientKey(request("198.51.100.2, 203.0.113.10"), env), "ip:203.0.113.10");
});
test("invalid proxy addresses use the shared fallback rather than attacker-controlled buckets", () => {
  const env = { ADMIN_LOGIN_TRUST_PROXY: "true" };
  for (const realIp of ["spoofed", "203.0.113.1, 203.0.113.2", "unknown"]) {
    assert.equal(getLoginClientKey(request("198.51.100.1", realIp), env), "ip:unknown");
  }
  assert.equal(getLoginClientKey(request("anything", "2001:db8::1"), env), "ip:2001:db8::1");
});
