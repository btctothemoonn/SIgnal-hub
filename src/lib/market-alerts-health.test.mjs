import assert from "node:assert/strict";

const { getMarketAlertWorkerView } = await import("./market-alerts-health.ts");

const now = Date.parse("2026-08-31T04:00:00.000Z");
assert.equal(
  getMarketAlertWorkerView(
    {
      worker: "volatility-ws",
      status: "live",
      detail: "receiving",
      meta: {},
      updatedAt: "2026-08-31T03:59:30.000Z",
      lastError: null,
      lastErrorAt: null,
    },
    now,
  ).online,
  true,
);
const stale = getMarketAlertWorkerView(
  {
    worker: "volatility-rest",
    status: "live",
    detail: "scan complete",
    meta: {},
    updatedAt: "2026-08-31T03:50:00.000Z",
    lastError: "old error",
    lastErrorAt: "2026-08-31T03:40:00.000Z",
  },
  now,
);
assert.equal(stale.online, false);
assert.equal(stale.label, "心跳过期");
assert.equal(stale.lastError, "old error");

console.log("ok - market worker health rejects stale live heartbeats");
