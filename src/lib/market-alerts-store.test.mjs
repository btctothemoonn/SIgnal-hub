import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openMarketAlertsStore } = await import("./market-alerts-store.ts");

const dir = mkdtempSync(join(tmpdir(), "market-alerts-store-"));
const dbPath = join(dir, "alerts.sqlite");
let a;
let b;

try {
  a = openMarketAlertsStore(dbPath);
  b = openMarketAlertsStore(dbPath);

  const first = a.reserveVolatilityAlert({
    key: "LONG:BTCUSDT",
    strength: 6.2,
    nowMs: 1000,
    owner: "ws",
  });
  assert.equal(first.send, true);
  assert.equal(
    b.reserveVolatilityAlert({
      key: "LONG:BTCUSDT",
      strength: 6.2,
      nowMs: 1001,
      owner: "rest",
    }).send,
    false,
  );
  assert.equal(a.commitVolatilityAlert("LONG:BTCUSDT", "ws", first.next), true);

  const upgrade = b.reserveVolatilityAlert({
    key: "LONG:BTCUSDT",
    strength: 12.1,
    nowMs: 2000,
    owner: "rest",
  });
  assert.equal(upgrade.send, true);
  assert.equal(b.commitVolatilityAlert("LONG:BTCUSDT", "rest", upgrade.next), true);

  assert.equal(a.recoverVolatilityAlert("LONG:BTCUSDT", 3000), false);
  assert.equal(a.recoverVolatilityAlert("LONG:BTCUSDT", 902999), false);
  assert.equal(
    a.reserveVolatilityAlert({
      key: "LONG:BTCUSDT",
      strength: 13,
      nowMs: 904000,
      owner: "ws2",
    }).send,
    false,
  );
  assert.equal(
    a.getMarketAlertsSnapshot({ limit: 1 }).activeSignals.find(
      (signal) => signal.key === "LONG:BTCUSDT",
    )?.updatedAt,
    new Date(904000).toISOString(),
  );
  assert.equal(a.recoverVolatilityAlert("LONG:BTCUSDT", 904000), false);
  assert.equal(a.recoverVolatilityAlert("LONG:BTCUSDT", 1_804_000), true);
  assert.equal(
    b.reserveVolatilityAlert({
      key: "LONG:BTCUSDT",
      strength: 6.2,
      nowMs: 1_805_000,
      owner: "rest2",
    }).send,
    true,
  );

  const shortState = a.reserveVolatilityAlert({
    key: "SHORT:ETHUSDT",
    strength: 7,
    nowMs: 2_000_000,
    owner: "rest-short",
  });
  assert.equal(
    a.commitVolatilityAlert("SHORT:ETHUSDT", "rest-short", shortState.next),
    true,
  );
  assert.equal(a.recoverVolatilityAlert("SHORT:ETHUSDT", 2_100_000), false);
  assert.equal(a.resetVolatilityRecovery("SHORT:ETHUSDT", 2_200_000), true);
  assert.equal(a.recoverVolatilityAlert("SHORT:ETHUSDT", 3_000_000), false);
  assert.equal(a.recoverVolatilityAlert("SHORT:ETHUSDT", 3_900_000), true);

  const squeezeStart = a.beginSqueezeDelivery("SOLUSDT", 1, 1000);
  assert.equal(squeezeStart, true);
  assert.equal(b.beginSqueezeDelivery("SOLUSDT", 1, 1001), false);
  a.markSqueezeDeliveryUncertain("SOLUSDT", 1, "timeout");
  assert.equal(b.beginSqueezeDelivery("SOLUSDT", 2, 1002), false);
  assert.deepEqual(a.getTrackedSqueezeSignals(), [
    {
      symbol: "SOLUSDT",
      level: 0,
      recoveryCount: 0,
      lastAlertAt: 1000,
      lastScore: 0,
    },
  ]);
  assert.equal(a.updateSqueezeRecovery("SOLUSDT", true), false);
  assert.equal(a.updateSqueezeRecovery("SOLUSDT", true), false);
  assert.equal(a.updateSqueezeRecovery("SOLUSDT", true), true);
  assert.equal(b.beginSqueezeDelivery("SOLUSDT", 1, 1003), true);
  b.commitSqueezeDeliverySuccess("SOLUSDT", 1, 5, 1004);
  assert.equal(b.updateSqueezeRecovery("SOLUSDT", true), false);
  assert.equal(b.updateSqueezeRecovery("SOLUSDT", true), false);
  assert.equal(b.updateSqueezeRecovery("SOLUSDT", true), true);

  assert.equal(a.beginSqueezeDelivery("ETHUSDT", 1, 2000), true);
  assert.equal(a.releaseSqueezeDelivery("ETHUSDT", 1), true);
  assert.equal(b.beginSqueezeDelivery("ETHUSDT", 1, 2001), true);
  b.clearSqueezeState("ETHUSDT");

  assert.equal(a.beginSqueezeDelivery("STALEUSDT", 1, 10_000), true);
  assert.equal(a.beginSqueezeDelivery("STALEUSDT", 1, 309_999), false);
  assert.equal(a.beginSqueezeDelivery("STALEUSDT", 1, 310_001), true);
  a.clearSqueezeState("STALEUSDT");

  const uncertainVolatility = a.reserveVolatilityAlert({
    key: "LONG:UNCERTAINUSDT",
    strength: 7,
    nowMs: 20_000,
    owner: "ws-uncertain",
  });
  a.insertMarketAlertEvent({
    id: "volatility:LONG:UNCERTAINUSDT:fixture",
    type: "volatility",
    symbol: "UNCERTAINUSDT",
    side: "LONG",
    level: 1,
    stage: "暴涨预警",
    trigger: "fixture",
    source: "ws",
    price: 1,
    changePct: 7,
    volumeRatio: 2,
    score: null,
    metrics: {},
    reasons: [],
    occurredAt: "2026-08-29T00:00:00.000Z",
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(
    a.commitVolatilityAlertUncertain(
      "LONG:UNCERTAINUSDT",
      "ws-uncertain",
      uncertainVolatility.next,
      "volatility:LONG:UNCERTAINUSDT:fixture",
    ),
    true,
  );
  assert.equal(
    b.reserveVolatilityAlert({
      key: "LONG:UNCERTAINUSDT",
      strength: 7,
      nowMs: 20_001,
      owner: "rest-after-uncertain",
    }).send,
    false,
  );

  assert.equal(a.beginSqueezeDelivery("UNCERTAINUSDT", 1, 21_000), true);
  a.insertMarketAlertEvent({
    id: "short_squeeze:LONG:UNCERTAINUSDT:fixture",
    type: "short_squeeze",
    symbol: "UNCERTAINUSDT",
    side: "LONG",
    level: 1,
    stage: "轧空预警",
    trigger: "fixture",
    source: "squeeze",
    price: 1,
    changePct: 3,
    volumeRatio: 2,
    score: 5,
    metrics: {},
    reasons: [],
    occurredAt: "2026-08-29T00:01:00.000Z",
    createdAt: "2026-08-29T00:01:00.000Z",
  });
  assert.equal(
    a.commitSqueezeDeliveryUncertain(
      "UNCERTAINUSDT",
      1,
      "short_squeeze:LONG:UNCERTAINUSDT:fixture",
      "timeout",
    ),
    true,
  );
  assert.equal(b.beginSqueezeDelivery("UNCERTAINUSDT", 2, 21_001), false);
  const uncertainEvents = a.getMarketAlertsSnapshot({ limit: 10 }).events;
  assert.equal(
    uncertainEvents.find((item) => item.id === "volatility:LONG:UNCERTAINUSDT:fixture")
      ?.deliveryStatus,
    "uncertain",
  );
  assert.equal(
    uncertainEvents.find((item) => item.id === "short_squeeze:LONG:UNCERTAINUSDT:fixture")
      ?.deliveryStatus,
    "uncertain",
  );

  const event = a.insertMarketAlertEvent({
    id: "volatility:LONG:BTCUSDT:fixture",
    type: "volatility",
    symbol: "BTCUSDT",
    side: "LONG",
    level: 2,
    stage: "暴涨升级",
    trigger: "A趋势·确认",
    source: "rest",
    price: 100,
    changePct: 12.1,
    volumeRatio: 2.4,
    score: null,
    metrics: { pct5m: 12.1 },
    reasons: ["近25m上涨12.1%"],
    occurredAt: "2026-08-31T00:00:00.000Z",
    createdAt: "2026-08-31T00:00:00.000Z",
  });
  assert.match(event.id, /^volatility:LONG:BTCUSDT:/);
  assert.equal(
    a.insertMarketAlertEvent({
      id: "volatility:LONG:BTCUSDT:fixture",
      type: "volatility",
      symbol: "BTCUSDT",
      side: "LONG",
      level: 2,
      stage: "暴涨升级",
      trigger: "A趋势·确认",
      source: "rest",
      price: 100,
      changePct: 12.1,
      volumeRatio: 2.4,
      score: null,
      metrics: { pct5m: 12.1 },
      reasons: ["近25m上涨12.1%"],
      occurredAt: "2026-08-31T00:00:00.000Z",
      createdAt: "2026-08-31T00:00:00.000Z",
    }).id,
    event.id,
  );
  a.setMarketAlertsHeartbeat({
    worker: "volatility-rest",
    status: "live",
    detail: "scan=10 alerts=1",
    meta: { scanned: 10 },
    lastError: "Telegram delivery failed",
    now: "2026-08-31T00:00:01.000Z",
  });
  a.setMarketAlertsHeartbeat({
    worker: "squeeze",
    status: "error",
    detail: "temporary upstream error",
    now: "2026-08-31T00:00:01.000Z",
  });
  a.setMarketAlertsHeartbeat({
    worker: "squeeze",
    status: "live",
    detail: "recovered",
    now: "2026-08-31T00:00:02.000Z",
  });
  a.upsertMarketTickers([
    {
      symbol: "BTCUSDT",
      price: 100,
      pct24h: 12.1,
      quoteVolume: 2_000_000_000,
      updatedAt: "2026-08-31T00:00:02.000Z",
    },
    {
      symbol: "SOLUSDT",
      price: 200,
      pct24h: 99,
      quoteVolume: 1_000_000_000,
      updatedAt: "2026-08-31T00:00:02.000Z",
    },
  ]);
  const revisionBeforeChart = b.getMarketAlertsRevision();
  assert.equal(a.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: event.id,
    interval: "5m",
    updatedAt: "2026-08-31T00:00:03.000Z",
    sourceKey: "1788134400000_1788134400000_aaaaaaaaaaaa",
  }).accepted, true);
  assert.ok(b.getMarketAlertsRevision() > revisionBeforeChart);
  assert.deepEqual(b.getMarketAlertChart("btcusdt"), {
    symbol: "BTCUSDT",
    eventId: event.id,
    interval: "5m",
    updatedAt: "2026-08-31T00:00:03.000Z",
    sourceKey: "1788134400000_1788134400000_aaaaaaaaaaaa",
  });

  const newerEvent = a.insertMarketAlertEvent({
    id: "volatility:LONG:BTCUSDT:newer",
    type: "volatility",
    symbol: "BTCUSDT",
    side: "LONG",
    level: 3,
    stage: "暴涨升级",
    trigger: "A趋势·确认",
    source: "ws",
    price: 105,
    changePct: 20,
    volumeRatio: 3,
    score: null,
    metrics: { pct5m: 20 },
    reasons: ["近25m上涨20%"],
    occurredAt: "2026-08-31T00:01:00.000Z",
    createdAt: "2026-08-31T00:01:00.000Z",
  });
  a.setMarketAlertsHeartbeat({
    worker: "volatility-ws",
    status: "live",
    detail: "newer heartbeat masks chart timestamp",
    now: "2026-08-31T00:05:00.000Z",
  });
  const revisionBeforeMaskedChart = b.getMarketAlertsRevision();
  const newerRegistration = a.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: newerEvent.id,
    interval: "5m",
    updatedAt: "2026-08-31T00:01:01.000Z",
    sourceKey: "1788134460000_1788134460000_bbbbbbbbbbbb",
  });
  assert.equal(newerRegistration.accepted, true);
  assert.equal(
    newerRegistration.replacedSourceKey,
    "1788134400000_1788134400000_aaaaaaaaaaaa",
  );
  assert.ok(b.getMarketAlertsRevision() > revisionBeforeMaskedChart);
  assert.equal(a.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: event.id,
    interval: "5m",
    updatedAt: "2026-08-31T00:02:00.000Z",
    sourceKey: "1788134400000_1788134400000_aaaaaaaaaaaa",
  }).accepted, false);
  const snapshot = b.getMarketAlertsSnapshot({
    limit: 10,
    now: "2026-08-31T00:05:00.000Z",
  });
  assert.equal(snapshot.events[0].id, newerEvent.id);
  assert.equal(
    snapshot.events[0].chartUrl,
    "/api/market-alerts/charts/BTCUSDT?v=1788134460000_1788134460000_bbbbbbbbbbbb",
  );
  assert.equal(snapshot.events[0].chartUpdatedAt, "2026-08-31T00:01:01.000Z");
  assert.equal(snapshot.events[1].id, event.id);
  assert.equal(snapshot.events[1].chartUrl, null);
  assert.equal(snapshot.health.volatilityRest?.status, "live");
  assert.equal(snapshot.health.volatilityRest?.lastError, "Telegram delivery failed");
  assert.equal(snapshot.health.squeeze?.status, "live");
  assert.equal(snapshot.health.squeeze?.lastError, "temporary upstream error");
  assert.equal(snapshot.health.squeeze?.lastErrorAt, "2026-08-31T00:00:01.000Z");
  assert.deepEqual(snapshot.marketRanking.map((item) => item.symbol), ["BTCUSDT"]);
  assert.equal(snapshot.marketRanking[0].counts.pump, 2);
  assert.equal(snapshot.latestUpdatedAt, "2026-08-31T00:05:00.000Z");
  assert.deepEqual(
    b.getRecentlyTriggeredSymbols("2026-08-30T00:00:00.000Z"),
    ["BTCUSDT"],
  );
} finally {
  a?.close();
  b?.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - market alerts store and delivery guards");
