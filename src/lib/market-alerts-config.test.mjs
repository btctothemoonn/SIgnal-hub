import assert from "node:assert/strict";

const { getMarketAlertsConfig } = await import("./market-alerts-config.ts");

const defaults = getMarketAlertsConfig({});
assert.equal(defaults.enabled, true);
assert.equal(defaults.restTopN, 200);
assert.equal(defaults.restCoreN, 50);
assert.equal(defaults.squeezeTopN, 120);
assert.equal(defaults.minFdvUsd, 10_000_000);
assert.equal(defaults.wsFirstMessageTimeoutMs, 20_000);
assert.equal(defaults.wsBaseUrl, "wss://fstream.binance.com/market");
assert.equal(defaults.requestSpacingMs, 100);
assert.equal(defaults.requestRetryBaseMs, 1_000);
assert.equal(defaults.chartBackfillPerScan, 4);
assert.equal(defaults.chartBackfillHours, 168);

const configured = getMarketAlertsConfig({
  MARKET_ALERTS_ENABLED: "false",
  MARKET_ALERTS_REST_TOP_N: "80",
  MARKET_ALERTS_REST_CORE_N: "90",
  MARKET_ALERTS_SQUEEZE_TOP_N: "60",
  MARKET_ALERTS_TELEGRAM_ENABLED: "true",
  MARKET_ALERTS_WS_FIRST_MESSAGE_TIMEOUT_MS: "9000",
  MARKET_ALERTS_BINANCE_REQUEST_SPACING_MS: "125",
  MARKET_ALERTS_BINANCE_RETRY_BASE_MS: "1500",
  MARKET_ALERTS_CHART_BACKFILL_PER_SCAN: "6",
  MARKET_ALERTS_CHART_BACKFILL_HOURS: "72",
});
assert.equal(configured.enabled, false);
assert.equal(configured.restTopN, 80);
assert.equal(configured.restCoreN, 80);
assert.equal(configured.squeezeTopN, 60);
assert.equal(configured.telegramEnabled, true);
assert.equal(configured.wsFirstMessageTimeoutMs, 9000);
assert.equal(configured.requestSpacingMs, 125);
assert.equal(configured.requestRetryBaseMs, 1500);
assert.equal(configured.chartBackfillPerScan, 6);
assert.equal(configured.chartBackfillHours, 72);

assert.equal(
  getMarketAlertsConfig({
    MARKET_ALERTS_BINANCE_WS_BASE_URL: "wss://fstream.binance.com/",
  }).wsBaseUrl,
  "wss://fstream.binance.com/market",
);

console.log("ok - market alerts config");
