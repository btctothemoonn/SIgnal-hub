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
assert.equal(stale.lastErrorRecovered, true);

const recovered = getMarketAlertWorkerView(
  {
    worker: "squeeze",
    status: "live",
    detail: "scan complete",
    meta: {},
    updatedAt: "2026-08-31T03:59:00.000Z",
    lastError: "HTTP 429 Too Many Requests",
    lastErrorAt: "2026-08-31T03:55:00.000Z",
  },
  now,
);
assert.equal(recovered.lastError, "HTTP 429 Too Many Requests");
assert.equal(recovered.lastErrorAt, "2026-08-31T03:55:00.000Z");
assert.equal(recovered.lastErrorRecovered, true);

const restarting = getMarketAlertWorkerView(
  {
    worker: "squeeze",
    status: "starting",
    detail: "loading markets",
    meta: {},
    updatedAt: "2026-08-31T03:59:30.000Z",
    lastError: "HTTP 429 Too Many Requests",
    lastErrorAt: "2026-08-31T03:55:00.000Z",
  },
  now,
);
assert.equal(restarting.lastErrorRecovered, false);
assert.equal(restarting.online, false);
assert.equal(restarting.tone, "warning");

const scanning = getMarketAlertWorkerView(
  {
    worker: "volatility-rest",
    status: "starting",
    detail: "正在读取 Binance 合约行情",
    meta: {},
    updatedAt: "2026-08-31T03:59:40.000Z",
    lastError: "HTTP 429 Too Many Requests",
    lastErrorAt: "2026-08-31T03:50:00.000Z",
    lastSuccessAt: "2026-08-31T03:59:10.000Z",
  },
  now,
);
assert.equal(scanning.online, true);
assert.equal(scanning.tone, "success");
assert.equal(scanning.label, "在线");
assert.equal(scanning.lastErrorRecovered, true);

const stalledStart = getMarketAlertWorkerView(
  {
    worker: "squeeze",
    status: "starting",
    detail: "正在扫描轧空条件",
    meta: {},
    updatedAt: "2026-08-31T03:59:50.000Z",
    lastError: null,
    lastErrorAt: null,
    lastSuccessAt: "2026-08-31T03:50:00.000Z",
  },
  now,
);
assert.equal(stalledStart.online, false);
assert.equal(stalledStart.label, "启动中");
assert.equal(stalledStart.tone, "warning");

const oldRecovered = getMarketAlertWorkerView(
  {
    worker: "volatility-ws",
    status: "live",
    detail: "receiving",
    meta: {},
    updatedAt: "2026-08-31T03:59:30.000Z",
    lastError: "old websocket error",
    lastErrorAt: "2026-08-29T03:00:00.000Z",
  },
  now,
);
assert.equal(oldRecovered.lastError, null);
assert.equal(oldRecovered.lastErrorAt, null);
assert.equal(oldRecovered.lastErrorRecovered, false);

console.log("ok - market worker health rejects stale live heartbeats");
