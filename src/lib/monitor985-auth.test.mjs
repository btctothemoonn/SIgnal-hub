import assert from "node:assert/strict";

const {
  buildMonitor985RequestHeaders,
  buildMonitor985RequestUrl,
  describeMonitor985AuthMode,
} = await import("./monitor985-auth.ts");

const userEnv = {
  MONITOR985_USER_ID: "wallet-abc",
  MONITOR985_USER_TOKEN: "token-xyz",
  MONITOR985_WALLET_ADDRESS: "wallet-abc",
};

assert.equal(
  buildMonitor985RequestUrl("/api/twitter-live-events?limit=30", "https://985monitor.xyz", userEnv),
  "https://985monitor.xyz/api/twitter-live-events?limit=30&userId=wallet-abc&userToken=token-xyz",
);
assert.deepEqual(buildMonitor985RequestHeaders(userEnv), {
  Accept: "application/json, text/event-stream",
  "Cache-Control": "no-cache",
  "User-Agent": "SignalHub-985monitor-worker/1.0",
  "X-User-Id": "wallet-abc",
  "X-User-Token": "token-xyz",
  "X-Wallet-Address": "wallet-abc",
});
assert.equal(describeMonitor985AuthMode(userEnv), "user-token");

const cookieEnv = {
  MONITOR985_AUTH_COOKIE: "session=abc; theme=dark",
};
assert.deepEqual(buildMonitor985RequestHeaders(cookieEnv), {
  Accept: "application/json, text/event-stream",
  "Cache-Control": "no-cache",
  "User-Agent": "SignalHub-985monitor-worker/1.0",
  Cookie: "session=abc; theme=dark",
});
assert.equal(describeMonitor985AuthMode(cookieEnv), "cookie");

assert.equal(describeMonitor985AuthMode({}), "public");

console.log("ok - monitor985 auth request helpers add user credentials safely");
