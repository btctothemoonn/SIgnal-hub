import assert from "node:assert/strict";

const {
  evaluateRestVolatilitySignal,
  evaluateWsVolatilitySignal,
  fastMoveDirectionOk,
  isStableOrFiatBase,
  isTradFiContract,
  isVolatilityRecoveryCalm,
  nextSqueezeRecoveryCount,
  rankTriggeredMarkets,
  scoreShortSqueeze,
  signalLevel,
  squeezeRecoveryDecision,
  shouldSendSqueezeAlert,
  transitionVolatilityState,
} = await import("./market-alerts-core.ts");

assert.equal(
  isTradFiContract({
    contractType: "TRADIFI_PERPETUAL",
    underlyingType: "EQUITY",
    underlyingSubType: ["TradFi"],
  }),
  true,
);
assert.equal(
  isTradFiContract({
    contractType: "PERPETUAL",
    underlyingType: "COIN",
    underlyingSubType: ["Alpha"],
  }),
  false,
);
assert.equal(isStableOrFiatBase("USDC"), true);
assert.equal(isStableOrFiatBase("BTC"), false);

assert.equal(signalLevel(6), 1);
assert.equal(signalLevel(12), 2);
assert.equal(signalLevel(20), 3);
assert.equal(fastMoveDirectionOk("LONG", 6, -1), false);
assert.equal(fastMoveDirectionOk("SHORT", -6, -1), true);
assert.equal(isVolatilityRecoveryCalm({ pct1m: 1.8, pct25m: -1.9 }), true);
assert.equal(isVolatilityRecoveryCalm({ pct1m: -8, pct25m: -9 }), false);
assert.equal(isVolatilityRecoveryCalm({ pct1m: 8, pct25m: 9 }), false);

const wsPump = evaluateWsVolatilitySignal({
  symbol: "BTCUSDT",
  price: 100,
  pct1m: 5.4,
  pct5m: 6.4,
  pct24h: 7,
  streakGreen: 3,
  streakRed: 0,
  volRatio1m: 2.3,
  volRatio5m: 2.1,
  k1Closed: false,
  k5Closed: true,
});
assert.equal(wsPump?.side, "LONG");
assert.match(wsPump?.trigger ?? "", /A趋势/);
assert.match(wsPump?.trigger ?? "", /B加速/);
assert.equal(wsPump?.level, 1);

const wsCounterTrendCrash = evaluateWsVolatilitySignal({
  symbol: "ETHUSDT",
  price: 100,
  pct1m: -5.5,
  pct5m: 3.1,
  pct24h: 2,
  streakGreen: 0,
  streakRed: 1,
  volRatio1m: 4,
  volRatio5m: 4,
  k1Closed: false,
  k5Closed: false,
});
assert.equal(wsCounterTrendCrash, null);

const restEarlyPump = evaluateRestVolatilitySignal({
  symbol: "SOLUSDT",
  price: 100,
  pct1m: 3.6,
  pct5m: 2.2,
  pct24h: 1,
  candle5mPct: 1.5,
  streakGreen: 2,
  streakRed: 0,
  volRatio1m: 2.2,
  volRatio5m: 1.2,
  k1Closed: false,
  k5Closed: false,
  kTime: 123,
});
assert.equal(restEarlyPump?.side, "LONG");
assert.match(restEarlyPump?.trigger ?? "", /D先行/);

const restFiveMinutePump = evaluateRestVolatilitySignal({
  symbol: "AVAXUSDT",
  price: 100,
  pct1m: 0.4,
  pct5m: 6.2,
  pct25m: 6.4,
  pct24h: 9,
  candle5mPct: 5.4,
  streakGreen: 1,
  streakRed: 0,
  volRatio1m: 1.1,
  volRatio5m: 3.2,
  k1Closed: false,
  k5Closed: true,
});
assert.equal(restFiveMinutePump?.volumeRatio, 3.2);
assert.match(restFiveMinutePump?.statusText ?? "", /5m已收盘/);

const firstVolatility = transitionVolatilityState(null, {
  triggered: true,
  strength: 6.2,
  recovered: false,
  now: 1000,
});
assert.equal(firstVolatility.send, true);
assert.equal(firstVolatility.next?.level, 1);
const repeatedVolatility = transitionVolatilityState(firstVolatility.next, {
  triggered: true,
  strength: 8,
  recovered: false,
  now: 2000,
});
assert.equal(repeatedVolatility.send, false);
const upgradedVolatility = transitionVolatilityState(repeatedVolatility.next, {
  triggered: true,
  strength: 12,
  recovered: false,
  now: 3000,
});
assert.equal(upgradedVolatility.send, true);
assert.equal(upgradedVolatility.next?.level, 2);
const recoveredVolatility = transitionVolatilityState(upgradedVolatility.next, {
  triggered: false,
  strength: 1.5,
  recovered: true,
  now: 4000,
});
assert.equal(recoveredVolatility.next, null);

function squeezeBase() {
  return {
    funding: -0.0012,
    basis: -0.002,
    oiGrowth15m: 16,
    oiNotional: 8_000_000,
    priceChange15m: 2.4,
    volRatio: 2.8,
    breakout20: true,
    globalLongShortRatio: 0.72,
    topTraderLongShortRatio: 0.81,
    takerBuySellRatio: 1.35,
  };
}

const squeeze = scoreShortSqueeze(squeezeBase(), { minOiNotional: 2_000_000 });
assert.equal(squeeze.eligible, true);
assert.equal(squeeze.level, 3);
assert.equal(squeeze.stage, "轧空加速");

const earlySqueeze = scoreShortSqueeze(
  {
    ...squeezeBase(),
    oiGrowth15m: 4.5,
    priceChange15m: 0.4,
    volRatio: 1,
    breakout20: false,
    takerBuySellRatio: 1,
  },
  { minOiNotional: 2_000_000 },
);
assert.equal(earlySqueeze.eligible, true);
assert.equal(earlySqueeze.level, 1);
assert.equal(earlySqueeze.stage, "轧空蓄势");

assert.equal(
  scoreShortSqueeze(
    { ...squeezeBase(), globalLongShortRatio: null, topTraderLongShortRatio: null },
    { minOiNotional: 2_000_000 },
  ).eligible,
  false,
);

assert.equal(shouldSendSqueezeAlert(0, 1), true);
assert.equal(shouldSendSqueezeAlert(1, 1), false);
assert.equal(shouldSendSqueezeAlert(1, 3), true);
assert.equal(nextSqueezeRecoveryCount(2, true), 3);
assert.equal(nextSqueezeRecoveryCount(2, false), 0);
assert.equal(squeezeRecoveryDecision(null), null);
assert.equal(
  squeezeRecoveryDecision({ funding: -0.001, oiGrowth15m: null }),
  null,
);
assert.equal(
  squeezeRecoveryDecision({ funding: 0, oiGrowth15m: 0 }),
  true,
);

const triggeredRanking = rankTriggeredMarkets({
  events: [
    {
      type: "volatility",
      symbol: "ZORAUSDT",
      side: "LONG",
      occurredAt: "2026-08-31T01:00:00.000Z",
    },
    {
      type: "volatility",
      symbol: "ZORAUSDT",
      side: "SHORT",
      occurredAt: "2026-08-31T02:00:00.000Z",
    },
    {
      type: "short_squeeze",
      symbol: "SKRUSDT",
      side: "LONG",
      occurredAt: "2026-08-31T03:00:00.000Z",
    },
    {
      type: "volatility",
      symbol: "OLDUSDT",
      side: "LONG",
      occurredAt: "2026-08-29T03:00:00.000Z",
    },
  ],
  tickers: [
    {
      symbol: "ZORAUSDT",
      price: 0.2,
      pct24h: 56.55,
      quoteVolume: 215_000_000,
      marketCapUsd: 90_000_000,
      fdvUsd: 140_000_000,
    },
    {
      symbol: "SKRUSDT",
      price: 1.5,
      pct24h: -73.11,
      quoteVolume: 858_000_000,
      marketCapUsd: null,
      fdvUsd: 220_000_000,
    },
    { symbol: "SOLUSDT", price: 200, pct24h: 99, quoteVolume: 1_000_000_000 },
    { symbol: "OLDUSDT", price: 1, pct24h: 100, quoteVolume: 1_000_000 },
  ],
  since: "2026-08-30T04:00:00.000Z",
});
assert.deepEqual(
  triggeredRanking.map((item) => item.symbol),
  ["SKRUSDT", "ZORAUSDT"],
);
assert.deepEqual(triggeredRanking[0].counts, {
  pump: 0,
  crash: 0,
  squeeze: 1,
  total: 1,
});
assert.deepEqual(triggeredRanking[1].counts, {
  pump: 1,
  crash: 1,
  squeeze: 0,
  total: 2,
});
assert.equal(triggeredRanking[0].marketCapUsd, null);
assert.equal(triggeredRanking[0].fdvUsd, 220_000_000);
assert.equal(triggeredRanking[1].marketCapUsd, 90_000_000);
assert.equal(triggeredRanking[1].fdvUsd, 140_000_000);

assert.deepEqual(
  rankTriggeredMarkets({
    events: [{
      type: "volatility",
      symbol: "STALEUSDT",
      side: "LONG",
      occurredAt: "2026-08-31T03:00:00.000Z",
    }],
    tickers: [{
      symbol: "STALEUSDT",
      price: 1,
      pct24h: 90,
      quoteVolume: 1_000_000,
      updatedAt: "2026-08-31T01:00:00.000Z",
    }],
    since: "2026-08-30T04:00:00.000Z",
    now: "2026-08-31T04:00:00.000Z",
    maxTickerAgeMs: 10 * 60 * 1000,
  }),
  [],
);

console.log("ok - market alerts core rules");
