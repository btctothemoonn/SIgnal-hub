import assert from "node:assert/strict";

const {
  SIGNAL_HUB_SYSTEMD_SERVICES,
  getSignalHubSystemdServiceNames,
  getSignalHubSystemdServiceLabel,
  getEnabledSignalHubSystemdServices,
} = await import("./signal-hub-services.ts");

const names = getSignalHubSystemdServiceNames();

assert.equal(names.length, SIGNAL_HUB_SYSTEMD_SERVICES.length);
assert.equal(new Set(names).size, names.length);
assert.ok(names.includes("signal-hub-web"));
assert.ok(names.includes("signal-hub-telegram"));
assert.ok(names.includes("signal-hub-x-hybrid"));
assert.ok(names.includes("signal-hub-tiger-holdings"));
assert.ok(names.includes("signal-hub-douyin"));
assert.ok(names.includes("signal-hub-market-volatility-rest"));
assert.ok(names.includes("signal-hub-market-volatility-ws"));
assert.ok(names.includes("signal-hub-market-squeeze"));
assert.ok(names.includes("signal-hub-market-opportunity"));
assert.equal(getSignalHubSystemdServiceLabel("signal-hub-web"), "Web 应用");
assert.equal(
  getSignalHubSystemdServiceLabel("signal-hub-market-squeeze"),
  "轧空监控",
);
assert.equal(
  getSignalHubSystemdServiceLabel("signal-hub-market-opportunity"),
  "做单决策",
);
assert.equal(
  getSignalHubSystemdServiceLabel("signal-hub-unknown"),
  "signal-hub-unknown",
);

console.log("ok - signal hub service registry");

assert.ok(!getEnabledSignalHubSystemdServices({}).some(service => service.name === "signal-hub-x-owned-reader"));
assert.ok(getEnabledSignalHubSystemdServices({ X_OWNED_READER_ENABLED: "true" }).some(service => service.name === "signal-hub-x-owned-reader"));
assert.ok(!getEnabledSignalHubSystemdServices({}).some(service => service.name === "signal-hub-x-hybrid"));
assert.ok(!getEnabledSignalHubSystemdServices({ X_HYBRID_ENABLED: "true", TWITTER_CONNECTOR_ENABLED: "false" }).some(service => service.name === "signal-hub-x-hybrid"));
