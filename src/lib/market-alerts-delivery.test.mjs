import assert from "node:assert/strict";

const {
  MarketAlertDeliveryError,
  createMarketAlertDeliverer,
  formatMarketAlertTelegram,
} = await import("./market-alerts-delivery.ts");

const event = {
  id: "volatility:LONG:BTCUSDT:1:2",
  type: "volatility",
  symbol: "BTCUSDT",
  side: "LONG",
  level: 2,
  stage: "暴涨升级",
  trigger: "A趋势·确认",
  source: "rest",
  price: 68000,
  changePct: 12.1,
  volumeRatio: 2.4,
  score: null,
  metrics: { pct24h: 18.5 },
  reasons: ["近25m上涨12.10%", "成交量比2.40x"],
  deliveryStatus: "site",
  telegramMessageId: null,
  occurredAt: "2026-08-31T00:00:00.000Z",
  createdAt: "2026-08-31T00:00:00.000Z",
};

assert.match(formatMarketAlertTelegram(event), /BTCUSDT 暴涨升级/);
assert.match(formatMarketAlertTelegram(event), /24h \+18\.50%/);

let requests = 0;
const disabled = createMarketAlertDeliverer({ env: {}, fetchImpl: async () => {
  requests += 1;
  throw new Error("must not run");
} });
await disabled(event);
assert.equal(requests, 0);

const delivered = createMarketAlertDeliverer({
  env: {
    MARKET_ALERTS_TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "123",
  },
  fetchImpl: async (url, options) => {
    requests += 1;
    assert.match(String(url), /sendMessage$/);
    assert.match(String(options.body), /chat_id=123/);
    return { ok: true, json: async () => ({ ok: true }) };
  },
});
await delivered(event);
assert.equal(requests, 1);

const explicitlyFailed = createMarketAlertDeliverer({
  env: {
    MARKET_ALERTS_TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "123",
  },
  fetchImpl: async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, description: "bad request" }),
  }),
});
await assert.rejects(explicitlyFailed(event), (error) => {
  assert.equal(error instanceof MarketAlertDeliveryError, true);
  assert.equal(error.uncertain, false);
  return true;
});

const uncertainFailure = createMarketAlertDeliverer({
  env: {
    MARKET_ALERTS_TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "123",
  },
  fetchImpl: async () => {
    throw new Error("socket timeout");
  },
});
await assert.rejects(uncertainFailure(event), (error) => {
  assert.equal(error instanceof MarketAlertDeliveryError, true);
  assert.equal(error.uncertain, true);
  assert.doesNotMatch(error.message, /test-token/);
  return true;
});

console.log("ok - optional market alert Telegram delivery");
