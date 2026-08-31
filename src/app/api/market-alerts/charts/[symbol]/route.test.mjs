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
  store.upsertMarketAlertChart({
    symbol: "BTCUSDT",
    eventId: "volatility:LONG:BTCUSDT:fixture",
    interval: "5m",
    updatedAt: "2026-08-31T00:10:00.000Z",
    sourceKey: written.sourceKey,
  });

  const response = await GET(
    new Request("http://localhost/api/market-alerts/charts/BTCUSDT"),
    { params: Promise.resolve({ symbol: "BTCUSDT" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(await response.text(), /BTCUSDT · 5m/);

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
} finally {
  store?.close();
  if (previousRuntimeRoot === undefined) delete process.env.SIGNAL_HUB_RUNTIME_DIR;
  else process.env.SIGNAL_HUB_RUNTIME_DIR = previousRuntimeRoot;
  if (previousDb === undefined) delete process.env.MARKET_ALERTS_DB;
  else process.env.MARKET_ALERTS_DB = previousDb;
  rmSync(directory, { recursive: true, force: true });
}

console.log("ok - market alert chart route serves only registered charts");
