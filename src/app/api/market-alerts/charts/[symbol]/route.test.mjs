import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "market-alert-chart-route-"));
const previousRuntimeRoot = process.env.SIGNAL_HUB_RUNTIME_DIR;
const previousDb = process.env.MARKET_ALERTS_DB;
process.env.SIGNAL_HUB_RUNTIME_DIR = directory;
process.env.MARKET_ALERTS_DB = join(directory, "alerts.sqlite");

function kline(index, open, close) {
  const openTime = Date.parse("2026-08-31T00:00:00.000Z") + index * 300_000;
  return [
    openTime,
    String(open),
    String(Math.max(open, close) + 1),
    String(Math.min(open, close) - 1),
    String(close),
    "10",
    openTime + 299_999,
    "1000",
  ];
}

let store;
try {
  const { writeMarketAlertKlineChart } = await import(
    "../../../../../lib/market-alerts-chart.ts"
  );
  const { openMarketAlertsStore } = await import(
    "../../../../../lib/market-alerts-store.ts"
  );
  const { GET } = await import(`./route.ts?run=${Date.now()}`);

  const written = await writeMarketAlertKlineChart({
    symbol: "BTCUSDT",
    interval: "5m",
    klines: [kline(0, 100, 102), kline(1, 102, 101)],
    generatedAt: "2026-08-31T00:10:00.000Z",
    sourceKey: "1788135000000_1788135000000_aaaaaaaaaaaa",
    runtimeRoot: directory,
  });
  store = openMarketAlertsStore();
  store.insertMarketAlertEvent({
    id: "volatility:LONG:BTCUSDT:fixture",
    type: "volatility",
    symbol: "BTCUSDT",
    side: "LONG",
    level: 2,
    stage: "暴涨预警",
    trigger: "route integration fixture",
    source: "rest",
    price: 102,
    changePct: 5.2,
    volumeRatio: 2.1,
    score: null,
    metrics: {},
    reasons: ["fixture"],
    occurredAt: "2026-08-31T00:10:00.000Z",
    createdAt: "2026-08-31T00:10:00.000Z",
  });
  store.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: "volatility:LONG:BTCUSDT:fixture",
    interval: "5m",
    updatedAt: "2026-08-31T00:10:00.000Z",
    sourceKey: written.sourceKey,
  });

  const initialSnapshot = store.getMarketAlertsSnapshot({
    limit: 10,
    now: "2026-08-31T00:12:00.000Z",
  });
  const initialChartUrl = initialSnapshot.events[0]?.chartUrl;
  assert.ok(initialChartUrl);
  const snapshotResponse = await GET(
    new Request(new URL(initialChartUrl, "http://localhost")),
    { params: Promise.resolve({ symbol: "BTCUSDT" }) },
  );
  assert.equal(snapshotResponse.status, 200);
  assert.match(await snapshotResponse.text(), /BTCUSDT · 5m/);

  await writeMarketAlertKlineChart({
    symbol: "BTCUSDT",
    interval: "15m",
    klines: [kline(0, 100, 103), kline(1, 103, 104)],
    generatedAt: "2026-08-31T00:11:00.000Z",
    sourceKey: written.sourceKey,
    runtimeRoot: directory,
  });
  store.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: "volatility:LONG:BTCUSDT:fixture",
    interval: "15m",
    updatedAt: "2026-08-31T00:11:00.000Z",
    sourceKey: written.sourceKey,
  });
  const upgradedSnapshot = store.getMarketAlertsSnapshot({
    limit: 10,
    now: "2026-08-31T00:12:00.000Z",
  });
  const upgradedChartUrl = upgradedSnapshot.events[0]?.chartUrl;
  assert.ok(upgradedChartUrl);
  assert.notEqual(upgradedChartUrl, initialChartUrl);
  const upgradedResponse = await GET(
    new Request(new URL(upgradedChartUrl, "http://localhost")),
    { params: Promise.resolve({ symbol: "BTCUSDT" }) },
  );
  assert.equal(upgradedResponse.status, 200);
  assert.match(await upgradedResponse.text(), /BTCUSDT · 15m/);

  const response = await GET(
    new Request("http://localhost/api/market-alerts/charts/BTCUSDT"),
    { params: Promise.resolve({ symbol: "BTCUSDT" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(await response.text(), /BTCUSDT · 15m/);

  const stale = await GET(
    new Request("http://localhost/api/market-alerts/charts/BTCUSDT?v=stale-version"),
    { params: Promise.resolve({ symbol: "BTCUSDT" }) },
  );
  assert.equal(stale.status, 404);

  const missing = await GET(
    new Request("http://localhost/api/market-alerts/charts/ETHUSDT"),
    { params: Promise.resolve({ symbol: "ETHUSDT" }) },
  );
  assert.equal(missing.status, 404);

  const invalid = await GET(
    new Request("http://localhost/api/market-alerts/charts/x"),
    { params: Promise.resolve({ symbol: "../BTCUSDT" }) },
  );
  assert.equal(invalid.status, 404);

  store.upsertMarketAlertChart({
    symbol: "ETHUSDT",
    eventId: "volatility:LONG:ETHUSDT:missing-file",
    interval: "5m",
    updatedAt: "2026-08-31T00:11:00.000Z",
    sourceKey: "1788135060000_1788135060000_bbbbbbbbbbbb",
  });
  const orphaned = await GET(
    new Request("http://localhost/api/market-alerts/charts/ETHUSDT"),
    { params: Promise.resolve({ symbol: "ETHUSDT" }) },
  );
  assert.equal(orphaned.status, 404);
  assert.equal(store.getMarketAlertChart("ETHUSDT"), null);
} finally {
  store?.close();
  if (previousRuntimeRoot === undefined) delete process.env.SIGNAL_HUB_RUNTIME_DIR;
  else process.env.SIGNAL_HUB_RUNTIME_DIR = previousRuntimeRoot;
  if (previousDb === undefined) delete process.env.MARKET_ALERTS_DB;
  else process.env.MARKET_ALERTS_DB = previousDb;
  rmSync(directory, { recursive: true, force: true });
}

console.log("ok - market alert chart route serves only registered charts");
