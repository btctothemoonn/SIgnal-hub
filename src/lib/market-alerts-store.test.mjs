import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openMarketAlertsStore } = await import("./market-alerts-store.ts");

const dir = mkdtempSync(join(tmpdir(), "market-alerts-store-"));
const dbPath = join(dir, "alerts.sqlite");
let a;
let b;
let c;

function opportunityMetrics(symbol = "BTCUSDT") {
  return {
    symbol,
    observedAt: "2026-09-04T01:00:00.000Z",
    stale: false,
    pct1m: 1.2,
    pct5m: 3.2,
    pct15m: 6.4,
    pct1h: 11.5,
    pct24h: 18,
    volumeRatio1m: 2.2,
    volumeRatio5m: 2.8,
    oiGrowth15m: 8.2,
    oiNotional: 8_000_000,
    funding: 0.0001,
    basis: -0.0002,
    globalLongShortRatio: 1.02,
    topTraderLongShortRatio: 1.04,
    takerBuySellRatio: 1.34,
    spotAvailable: true,
    spotChange15m: 5.8,
    spotVolumeRatio5m: 2.1,
    perpSpotDivergencePct: 0.6,
    distanceFromHighPct: -1.2,
    distanceFromLowPct: 16,
    priorRunUpPct: 24,
    supportBreak: false,
    lowerStructure: false,
    breakout20: true,
    quoteVolume: 80_000_000,
    marketCapUsd: 120_000_000,
    fdvUsd: 140_000_000,
    alertCounts: { pump: 3, crash: 0, squeeze: 0, total: 3 },
  };
}

function opportunityDecision(symbol = "BTCUSDT") {
  const metrics = opportunityMetrics(symbol);
  return {
    symbol,
    model: "capital_long",
    direction: "LONG",
    stage: "拉盘做多确认",
    decision: "关注做多",
    score: 88,
    confidence: 88,
    evidence: ["OI 随价格扩张"],
    confirmations: ["等待回踩不破"],
    invalidations: ["跌破启动结构"],
    risks: [],
    mandatoryComplete: true,
    hardInvalidated: false,
    dataCoverage: 100,
    metrics,
    observedAt: metrics.observedAt,
    expiresAt: "2026-09-04T13:00:00.000Z",
  };
}

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
  assert.deepEqual(
    a.getMarketValuationRefreshCandidates({
      triggeredSince: "2026-08-30T00:00:00.000Z",
      staleBefore: "2026-08-30T23:00:04.000Z",
      limit: 50,
    }),
    [{ symbol: "BTCUSDT", price: 100 }],
  );
  a.upsertMarketValuations(
    [{
      symbol: "BTCUSDT",
      marketCapUsd: 120_000_000,
      fdvUsd: 140_000_000,
    }],
    "2026-08-31T00:00:04.000Z",
  );
  a.upsertMarketTickers([{
    symbol: "BTCUSDT",
    price: 101,
    pct24h: 12.2,
    quoteVolume: 2_100_000_000,
    updatedAt: "2026-08-31T00:00:05.000Z",
  }]);
  assert.deepEqual(
    a.getMarketValuationRefreshCandidates({
      triggeredSince: "2026-08-30T00:00:00.000Z",
      staleBefore: "2026-08-30T23:00:04.000Z",
      limit: 50,
    }),
    [],
  );
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
    "/api/market-alerts/charts/BTCUSDT?v=1788134460000_1788134460000_bbbbbbbbbbbb&i=5m&u=2026-08-31T00%3A01%3A01.000Z",
  );
  assert.equal(snapshot.events[0].chartUpdatedAt, "2026-08-31T00:01:01.000Z");
  assert.equal(snapshot.events[0].chartInterval, "5m");
  const preUpgradeChartUrl = snapshot.events[0].chartUrl;
  assert.equal(snapshot.events[1].id, event.id);
  assert.equal(
    snapshot.events[1].chartUrl,
    "/api/market-alerts/charts/BTCUSDT?v=1788134460000_1788134460000_bbbbbbbbbbbb&i=5m&u=2026-08-31T00%3A01%3A01.000Z",
  );
  assert.equal(snapshot.health.volatilityRest?.status, "live");
  assert.equal(snapshot.health.volatilityRest?.lastError, "Telegram delivery failed");
  assert.equal(snapshot.health.squeeze?.status, "live");
  assert.equal(snapshot.health.squeeze?.lastError, "temporary upstream error");
  assert.equal(snapshot.health.squeeze?.lastErrorAt, "2026-08-31T00:00:01.000Z");
  assert.deepEqual(snapshot.marketRanking.map((item) => item.symbol), ["BTCUSDT"]);
  assert.equal(snapshot.marketRanking[0].counts.pump, 2);
  assert.equal(snapshot.marketRanking[0].marketCapUsd, 120_000_000);
  assert.equal(snapshot.marketRanking[0].fdvUsd, 140_000_000);
  assert.equal(snapshot.latestUpdatedAt, "2026-08-31T00:05:00.000Z");
  assert.deepEqual(
    b.getRecentlyTriggeredSymbols("2026-08-30T00:00:00.000Z"),
    ["BTCUSDT"],
  );

  const unicodeEvent = a.insertMarketAlertEvent({
    id: "volatility:SHORT:牛来USDT:fixture",
    type: "volatility",
    symbol: "牛来USDT",
    side: "SHORT",
    level: 1,
    stage: "暴跌预警",
    trigger: "B加速·实时",
    source: "rest",
    price: 0.08,
    changePct: -6.39,
    volumeRatio: 4.89,
    score: null,
    metrics: {},
    reasons: ["近25m下跌6.39%"],
    occurredAt: "2026-08-31T00:03:00.000Z",
    createdAt: "2026-08-31T00:03:00.000Z",
  });
  assert.deepEqual(
    a.getMarketAlertChartBackfillEvents({
      since: "2026-08-31T00:00:00.000Z",
      symbols: ["BTCUSDT", "牛来USDT"],
      limit: 4,
    }).map((item) => item.id),
    [unicodeEvent.id, newerEvent.id],
  );
  const upgradedChart = a.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: newerEvent.id,
    interval: "15m",
    updatedAt: "2026-08-31T00:03:00.000Z",
    sourceKey: "1788134460000_1788134460000_bbbbbbbbbbbb",
  });
  assert.equal(upgradedChart.accepted, true);
  assert.equal(a.getMarketAlertChart("BTCUSDT")?.interval, "15m");
  const upgradedSnapshot = b.getMarketAlertsSnapshot({
    limit: 10,
    now: "2026-08-31T00:05:00.000Z",
  });
  const upgradedSnapshotEvent = upgradedSnapshot.events.find(
    (item) => item.id === newerEvent.id,
  );
  assert.equal(upgradedSnapshotEvent?.chartInterval, "15m");
  assert.notEqual(
    upgradedSnapshotEvent?.chartUrl,
    preUpgradeChartUrl,
    "upgrading a chart in place must change its browser cache key",
  );
  assert.deepEqual(
    a.getMarketAlertChartBackfillEvents({
      since: "2026-08-31T00:00:00.000Z",
      symbols: ["BTCUSDT"],
      limit: 4,
    }),
    [],
  );
  assert.equal(a.upsertMarketAlertChart({
    symbol: "牛来USDT",
    eventId: unicodeEvent.id,
    interval: "5m",
    updatedAt: "2026-08-31T00:03:01.000Z",
    sourceKey: "1788134580000_1788134580000_cccccccccccc",
  }).accepted, true);
  assert.equal(a.getMarketAlertChart("牛来USDT")?.eventId, unicodeEvent.id);
  assert.equal(a.deleteMarketAlertChart("牛来USDT", "1788134580000_1788134580000_cccccccccccc"), true);
  assert.equal(a.getMarketAlertChart("牛来USDT"), null);

  const solEvent = a.insertMarketAlertEvent({
    ...unicodeEvent,
    id: "volatility:SHORT:SOLUSDT:chart-backfill",
    symbol: "SOLUSDT",
    occurredAt: "2026-08-31T00:02:30.000Z",
    createdAt: "2026-08-31T00:02:30.000Z",
  });
  a.markMarketAlertChartRetry("牛来USDT", Date.parse("2026-08-31T00:04:00.000Z"));
  assert.deepEqual(
    a.getMarketAlertChartBackfillEvents({
      since: "2026-08-31T00:00:00.000Z",
      symbols: ["SOLUSDT", "牛来USDT"],
      limit: 1,
      nowMs: Date.parse("2026-08-31T00:04:30.000Z"),
    }).map((item) => item.id),
    [solEvent.id],
  );
  assert.deepEqual(
    a.getMarketAlertChartBackfillEvents({
      since: "2026-08-31T00:00:00.000Z",
      symbols: ["SOLUSDT", "牛来USDT"],
      limit: 2,
      nowMs: Date.parse("2026-08-31T00:05:00.000Z"),
    }).map((item) => item.id),
    [solEvent.id, unicodeEvent.id],
  );
  a.clearMarketAlertChartRetry("牛来USDT");

  assert.equal(a.reserveBinanceRequestSlot({ nowMs: 1_000, spacingMs: 100 }), 0);
  assert.equal(b.reserveBinanceRequestSlot({ nowMs: 1_000, spacingMs: 100 }), 100);
  a.deferBinanceRequests(1_500);
  assert.equal(b.getBinanceRequestDelay(1_100), 400);
  assert.equal(b.reserveBinanceRequestSlot({ nowMs: 1_100, spacingMs: 100 }), 400);

  const seeds = a.getOpportunitySeedData({
    since: "2026-08-30T00:00:00.000Z",
    limit: 12,
  });
  const btcSeed = seeds.find((item) => item.symbol === "BTCUSDT");
  assert.ok(btcSeed, "recent alert events must seed opportunity enrichment");
  assert.equal(btcSeed.alertCounts.pump, 2);
  assert.equal(btcSeed.price, 101);
  assert.equal(btcSeed.marketCapUsd, 120_000_000);

  const metrics = opportunityMetrics();
  a.upsertOpportunityEnrichment({
    symbol: "BTCUSDT",
    metrics,
    fetchedAt: "2026-09-04T01:00:00.000Z",
    stale: false,
    error: null,
  });
  assert.deepEqual(b.getOpportunityEnrichment("btcusdt"), {
    symbol: "BTCUSDT",
    metrics,
    fetchedAt: "2026-09-04T01:00:00.000Z",
    stale: false,
    error: null,
    updatedAt: "2026-09-04T01:00:00.000Z",
  });

  const decision = opportunityDecision();
  const candidateState = {
    symbol: "BTCUSDT",
    decision,
    entryStreak: 2,
    exitStreak: 0,
    enteredAt: "2026-09-04T00:59:00.000Z",
    lastQualifiedAt: "2026-09-04T01:01:00.000Z",
    lastConfirmedAt: "2026-09-04T01:01:00.000Z",
    selected: true,
    rank: 1,
    updatedAt: "2026-09-04T01:01:00.000Z",
  };
  a.replaceOpportunityCandidateStates([candidateState]);
  const revisionBeforeSelection = b.getMarketAlertsRevision();
  assert.equal(a.saveOpportunitySelection({
    selected: [decision],
    fingerprint: "fingerprint-one",
    scannedAt: "2026-09-04T01:01:00.000Z",
    successful: true,
  }).changed, true);
  assert.ok(b.getMarketAlertsRevision() > revisionBeforeSelection);
  a.setMarketAlertsHeartbeat({
    worker: "opportunity",
    status: "live",
    detail: "selected=1",
    now: "2026-09-04T01:01:01.000Z",
  });

  const firstOpportunitySnapshot = b.getMarketAlertsSnapshot({
    limit: 5,
    now: "2026-09-04T01:02:00.000Z",
  });
  assert.equal(firstOpportunitySnapshot.opportunities.length, 1);
  assert.equal(firstOpportunitySnapshot.opportunities[0].symbol, "BTCUSDT");
  assert.equal(firstOpportunitySnapshot.opportunities[0].rank, 1);
  assert.equal(firstOpportunitySnapshot.opportunities[0].ai, null);
  assert.equal(firstOpportunitySnapshot.opportunityMeta.fingerprint, "fingerprint-one");
  assert.equal(firstOpportunitySnapshot.health.opportunity?.status, "live");

  const selectedAt = firstOpportunitySnapshot.opportunities[0].selectedAt;
  assert.equal(a.saveOpportunitySelection({
    selected: [{ ...decision, score: 89 }],
    fingerprint: "fingerprint-one",
    scannedAt: "2026-09-04T01:02:00.000Z",
    successful: true,
  }).changed, false);
  assert.equal(
    b.getMarketAlertsSnapshot({ limit: 5 }).opportunities[0].selectedAt,
    selectedAt,
    "an unchanged fingerprint must not reset candidate age",
  );

  assert.equal(
    a.getOpportunityAiPolicy({
      fingerprint: "fingerprint-one",
      nowMs: Date.parse("2026-09-04T01:02:00.000Z"),
    }).reason,
    "allowed",
  );
  a.recordOpportunityAiAttempt({
    fingerprint: "fingerprint-one",
    createdAt: "2026-09-04T01:02:00.000Z",
  });
  a.saveOpportunityAiResult({
    fingerprint: "fingerprint-one",
    items: [{
      symbol: "BTCUSDT",
      summary: "动量与 OI 同步。",
      rationale: "价格、成交和 OI 同向。",
      confirmation: "回踩不破。",
      invalidation: "跌破启动区间。",
      risk: "短线涨幅较大。",
      validFor: "2 小时内。",
    }],
    provider: "minimax",
    generatedAt: "2026-09-04T01:02:01.000Z",
    error: null,
  });
  assert.equal(
    a.getOpportunityAiPolicy({
      fingerprint: "fingerprint-one",
      nowMs: Date.parse("2026-09-04T01:03:00.000Z"),
    }).reason,
    "unchanged",
  );
  assert.equal(
    a.getOpportunityAiPolicy({
      fingerprint: "fingerprint-two",
      nowMs: Date.parse("2026-09-04T01:03:00.000Z"),
    }).reason,
    "cooldown",
  );
  for (let index = 1; index < 6; index += 1) {
    a.recordOpportunityAiAttempt({
      fingerprint: `attempt-${index}`,
      createdAt: new Date(Date.parse("2026-09-04T01:02:00.000Z") + index * 60_000).toISOString(),
    });
  }
  assert.equal(
    a.getOpportunityAiPolicy({
      fingerprint: "fingerprint-three",
      nowMs: Date.parse("2026-09-04T01:20:00.000Z"),
    }).reason,
    "hourly-cap",
  );

  const aiSnapshot = b.getMarketAlertsSnapshot({ limit: 5 });
  assert.equal(aiSnapshot.opportunities[0].ai?.summary, "动量与 OI 同步。");
  assert.equal(aiSnapshot.opportunityMeta.aiProvider, "minimax");
  assert.equal(aiSnapshot.opportunityMeta.aiError, null);

  const eventTotalBeforePrune = aiSnapshot.total;
  a.recordOpportunityDiagnostic({
    symbol: "OLDUSDT",
    detail: { score: 71 },
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  a.recordOpportunityDiagnostic({
    symbol: "NEWUSDT",
    detail: { score: 75 },
    createdAt: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(a.pruneOpportunityDiagnostics("2026-08-28T00:00:00.000Z"), 1);
  assert.equal(b.getMarketAlertsSnapshot({ limit: 5 }).total, eventTotalBeforePrune);

  c = openMarketAlertsStore(dbPath);
  assert.equal(c.getOpportunityCandidateStates()[0].symbol, "BTCUSDT");
  assert.equal(c.getOpportunityEnrichment("BTCUSDT")?.metrics.oiGrowth15m, 8.2);
  assert.equal(c.getMarketAlertsSnapshot({ limit: 5 }).opportunities[0].symbol, "BTCUSDT");
} finally {
  a?.close();
  b?.close();
  c?.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - market alerts store and delivery guards");
