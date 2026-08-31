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

const configured = getMarketAlertsConfig({
  MARKET_ALERTS_ENABLED: "false",
  MARKET_ALERTS_REST_TOP_N: "80",
  MARKET_ALERTS_REST_CORE_N: "90",
  MARKET_ALERTS_SQUEEZE_TOP_N: "60",
  MARKET_ALERTS_TELEGRAM_ENABLED: "true",
  MARKET_ALERTS_WS_FIRST_MESSAGE_TIMEOUT_MS: "9000",
});
assert.equal(configured.enabled, false);
assert.equal(configured.restTopN, 80);
assert.equal(configured.restCoreN, 80);
assert.equal(configured.squeezeTopN, 60);
assert.equal(configured.telegramEnabled, true);
assert.equal(configured.wsFirstMessageTimeoutMs, 9000);

assert.equal(
  getMarketAlertsConfig({
    MARKET_ALERTS_BINANCE_WS_BASE_URL: "wss://fstream.binance.com/",
  }).wsBaseUrl,
  "wss://fstream.binance.com/market",
);

console.log("ok - market alerts config");
