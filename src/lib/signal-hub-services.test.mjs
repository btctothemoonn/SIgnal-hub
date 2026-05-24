import assert from "node:assert/strict";

const {
  SIGNAL_HUB_SYSTEMD_SERVICES,
  getSignalHubSystemdServiceNames,
  getSignalHubSystemdServiceLabel,
} = await import("./signal-hub-services.ts");

const names = getSignalHubSystemdServiceNames();

assert.equal(names.length, SIGNAL_HUB_SYSTEMD_SERVICES.length);
assert.equal(new Set(names).size, names.length);
assert.ok(names.includes("signal-hub-web"));
assert.ok(names.includes("signal-hub-telegram"));
assert.ok(names.includes("signal-hub-x-hybrid"));
assert.ok(names.includes("signal-hub-tiger-holdings"));
assert.ok(names.includes("signal-hub-douyin"));
assert.equal(getSignalHubSystemdServiceLabel("signal-hub-web"), "Web 应用");
assert.equal(
  getSignalHubSystemdServiceLabel("signal-hub-unknown"),
  "signal-hub-unknown",
);

console.log("ok - signal hub service registry");
