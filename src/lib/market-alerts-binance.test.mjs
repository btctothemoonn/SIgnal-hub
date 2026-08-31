import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildVolatilityInputFromKlines,
  includeTrackedMarkets,
  runSqueezeScan,
  runVolatilityRestScan,
  selectFuturesUniverse,
  startVolatilityWebSocketWorker,
} = await import("./market-alerts-binance.ts");
const { MarketAlertDeliveryError } = await import("./market-alerts-delivery.ts");
const { openMarketAlertsStore } = await import("./market-alerts-store.ts");

const exchangeInfo = {
  symbols: [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      quoteAsset: "USDT",
      baseAsset: "BTC",
      contractType: "PERPETUAL",
      underlyingType: "COIN",
    },
    {
      symbol: "SOLUSDT",
      status: "TRADING",
      quoteAsset: "USDT",
      baseAsset: "SOL",
      contractType: "PERPETUAL",
      underlyingType: "COIN",
    },
    {
      symbol: "USDCUSDT",
      status: "TRADING",
      quoteAsset: "USDT",
      baseAsset: "USDC",
      contractType: "PERPETUAL",
      underlyingType: "COIN",
    },
    {
      symbol: "AAPLUSDT",
      status: "TRADING",
      quoteAsset: "USDT",
      baseAsset: "AAPL",
      contractType: "TRADIFI_PERPETUAL",
      underlyingType: "EQUITY",
    },
  ],
};

const tickers = [
  { symbol: "USDCUSDT", quoteVolume: "9000", lastPrice: "1", priceChangePercent: "0" },
  { symbol: "AAPLUSDT", quoteVolume: "8000", lastPrice: "200", priceChangePercent: "3" },
  { symbol: "BTCUSDT", quoteVolume: "7000", lastPrice: "107", priceChangePercent: "12" },
  { symbol: "SOLUSDT", quoteVolume: "6000", lastPrice: "150", priceChangePercent: "2" },
];

assert.deepEqual(
  selectFuturesUniverse(exchangeInfo, tickers, { topN: 3, excludeTradFi: false }).map(
    (item) => item.symbol,
  ),
  ["AAPLUSDT", "BTCUSDT", "SOLUSDT"],
);
assert.deepEqual(
  selectFuturesUniverse(exchangeInfo, tickers, { topN: 3, excludeTradFi: true }).map(
    (item) => item.symbol,
  ),
  ["BTCUSDT", "SOLUSDT"],
);
const allMarkets = selectFuturesUniverse(exchangeInfo, tickers, {
  topN: 10,
  excludeTradFi: false,
});
assert.deepEqual(
  includeTrackedMarkets(allMarkets.slice(0, 1), allMarkets, new Set(["SOLUSDT"]))
    .map((item) => item.symbol),
  ["AAPLUSDT", "SOLUSDT"],
);

function kline(index, open, close, volume = 10, intervalMs = 300_000) {
  const openTime = 1_700_000_000_000 + index * intervalMs;
  return [
    openTime,
    String(open),
    String(Math.max(open, close) * 1.002),
    String(Math.min(open, close) * 0.998),
    String(close),
    String(volume),
    openTime + intervalMs - 1,
    String(volume * close),
  ];
}

const TEST_NOW_MS = 1_700_011_000_000;

function pumpKlines5m() {
  const rows = Array.from({ length: 31 }, (_, index) => kline(index, 100, 100, 10));
  rows.push(kline(31, 100, 100.5, 10));
  rows.push(kline(32, 100.5, 101.5, 10));
  rows.push(kline(33, 101.5, 103, 10));
  rows.push(kline(34, 103, 105, 10));
  rows.push(kline(35, 105, 107, 30));
  return rows;
}

function flatKlines(intervalMs, count) {
  return Array.from({ length: count }, (_, index) => kline(index, 100, 100, 10, intervalMs));
}

const pump1m = flatKlines(60_000, 40);
pump1m[pump1m.length - 1] = kline(39, 100, 104, 30, 60_000);
const built = buildVolatilityInputFromKlines({
  symbol: "BTCUSDT",
  fiveMinuteKlines: pumpKlines5m(),
  oneMinuteKlines: pump1m,
  ticker: tickers.find((ticker) => ticker.symbol === "BTCUSDT"),
  nowMs: TEST_NOW_MS,
});
assert.equal(Math.round(built.pct25m), 7);
assert.equal(built.streakGreen, 5);
assert.ok(built.volRatio5m >= 2.9);

const directory = mkdtempSync(join(tmpdir(), "market-alerts-binance-"));
let store;
try {
  store = openMarketAlertsStore(join(directory, "alerts.sqlite"));
  const client = {
    getExchangeInfo: async () => exchangeInfo,
    getTickers24h: async () => tickers.filter((ticker) => ticker.symbol !== "AAPLUSDT"),
    getKlines: async (symbol, interval) => {
      if (symbol === "BTCUSDT") {
        return interval === "5m" ? pumpKlines5m() : pump1m;
      }
      return flatKlines(interval === "5m" ? 300_000 : 60_000, interval === "5m" ? 36 : 40);
    },
    getFullyDilutedValuation: async () => 20_000_000,
  };
  const result = await runVolatilityRestScan({
    client,
    store,
    nowMs: TEST_NOW_MS,
    config: { restTopN: 2, restCoreN: 2, minFdvUsd: 10_000_000 },
  });
  assert.equal(result.scanned, 2);
  assert.equal(result.alerts, 1);
  const snapshot = store.getMarketAlertsSnapshot({
    now: new Date(TEST_NOW_MS).toISOString(),
  });
  assert.equal(snapshot.events[0].symbol, "BTCUSDT");
  assert.deepEqual(snapshot.marketRanking.map((item) => item.symbol), ["BTCUSDT"]);
} finally {
  store?.close();
  rmSync(directory, { recursive: true, force: true });
}

const squeezeDirectory = mkdtempSync(join(tmpdir(), "market-alerts-squeeze-"));
let squeezeStore;
try {
  squeezeStore = openMarketAlertsStore(join(squeezeDirectory, "alerts.sqlite"));
  const squeezeKlines = flatKlines(300_000, 25);
  squeezeKlines[21] = kline(21, 100, 100, 10);
  squeezeKlines[22] = kline(22, 100, 101, 10);
  squeezeKlines[23] = kline(23, 101, 103, 30);
  squeezeKlines[24] = kline(24, 103, 106, 35);
  const client = {
    getExchangeInfo: async () => exchangeInfo,
    getTickers24h: async () => tickers.filter((ticker) => ticker.symbol === "BTCUSDT"),
    getPremiumIndex: async () => [
      { symbol: "BTCUSDT", markPrice: "106", indexPrice: "107", lastFundingRate: "-0.0012" },
    ],
    getOpenInterestHistory: async () => [
      { sumOpenInterestValue: "6000000" },
      { sumOpenInterestValue: "6500000" },
      { sumOpenInterestValue: "7000000" },
      { sumOpenInterestValue: "7500000" },
      { sumOpenInterestValue: "8000000" },
    ],
    getKlines: async () => squeezeKlines,
    getGlobalLongShortRatio: async () => 0.72,
    getTopTraderPositionRatio: async () => 0.81,
    getTakerBuySellRatio: async () => 1.35,
  };
  const result = await runSqueezeScan({
    client,
    store: squeezeStore,
    nowMs: TEST_NOW_MS,
    config: { squeezeTopN: 1, squeezeWorkers: 1, minOiNotional: 2_000_000 },
  });
  assert.equal(result.scanned, 1);
  assert.equal(result.alerts, 1);
  const snapshot = squeezeStore.getMarketAlertsSnapshot({
    now: new Date(TEST_NOW_MS).toISOString(),
  });
  assert.equal(snapshot.events[0].type, "short_squeeze");
  assert.equal(snapshot.events[0].level, 3);
} finally {
  squeezeStore?.close();
  rmSync(squeezeDirectory, { recursive: true, force: true });
}

function qualifyingSqueezeClient() {
  const squeezeKlines = flatKlines(300_000, 25);
  squeezeKlines[21] = kline(21, 100, 100, 10);
  squeezeKlines[22] = kline(22, 100, 101, 10);
  squeezeKlines[23] = kline(23, 101, 103, 30);
  squeezeKlines[24] = kline(24, 103, 106, 35);
  return {
    getExchangeInfo: async () => exchangeInfo,
    getTickers24h: async () => tickers.filter((ticker) => ticker.symbol === "BTCUSDT"),
    getPremiumIndex: async () => [
      { symbol: "BTCUSDT", markPrice: "106", indexPrice: "107", lastFundingRate: "-0.0012" },
    ],
    getOpenInterestHistory: async () => [
      { sumOpenInterestValue: "6000000" },
      { sumOpenInterestValue: "6500000" },
      { sumOpenInterestValue: "7000000" },
      { sumOpenInterestValue: "7500000" },
      { sumOpenInterestValue: "8000000" },
    ],
    getKlines: async () => squeezeKlines,
    getGlobalLongShortRatio: async () => 0.72,
    getTopTraderPositionRatio: async () => 0.81,
    getTakerBuySellRatio: async () => 1.35,
  };
}

for (const uncertain of [false, true]) {
  const deliveryDirectory = mkdtempSync(join(tmpdir(), `market-alerts-delivery-${uncertain}-`));
  let deliveryStore;
  try {
    deliveryStore = openMarketAlertsStore(join(deliveryDirectory, "alerts.sqlite"));
    await assert.rejects(
      runSqueezeScan({
        client: qualifyingSqueezeClient(),
        store: deliveryStore,
        nowMs: TEST_NOW_MS,
        config: { squeezeTopN: 1, squeezeWorkers: 1, minOiNotional: 2_000_000 },
        deliverAlert: async () => {
          throw new MarketAlertDeliveryError("delivery test failure", { uncertain });
        },
      }),
      /delivery test failure/,
    );
    const snapshot = deliveryStore.getMarketAlertsSnapshot({
      now: new Date(TEST_NOW_MS).toISOString(),
    });
    assert.equal(snapshot.events[0].deliveryStatus, uncertain ? "uncertain" : "failed");
    assert.equal(
      deliveryStore.beginSqueezeDelivery("BTCUSDT", 3, TEST_NOW_MS + 1),
      !uncertain,
    );
    if (!uncertain) deliveryStore.releaseSqueezeDelivery("BTCUSDT", 3);
  } finally {
    deliveryStore?.close();
    rmSync(deliveryDirectory, { recursive: true, force: true });
  }
}

const trackedDirectory = mkdtempSync(join(tmpdir(), "market-alerts-tracked-"));
let trackedStore;
try {
  trackedStore = openMarketAlertsStore(join(trackedDirectory, "alerts.sqlite"));
  trackedStore.insertMarketAlertEvent({
    id: "volatility:LONG:SOLUSDT:tracked",
    type: "volatility",
    symbol: "SOLUSDT",
    side: "LONG",
    level: 1,
    stage: "暴涨预警",
    trigger: "fixture",
    source: "rest",
    price: 150,
    changePct: 6,
    volumeRatio: 2,
    score: null,
    metrics: {},
    reasons: [],
    occurredAt: new Date(TEST_NOW_MS - 60_000).toISOString(),
  });
  const result = await runVolatilityRestScan({
    client: {
      getExchangeInfo: async () => exchangeInfo,
      getTickers24h: async () => tickers.filter((ticker) =>
        ticker.symbol === "BTCUSDT" || ticker.symbol === "SOLUSDT"),
      getKlines: async (_symbol, interval) =>
        flatKlines(interval === "5m" ? 300_000 : 60_000, interval === "5m" ? 36 : 40),
    },
    store: trackedStore,
    nowMs: TEST_NOW_MS,
    config: {
      restTopN: 1,
      restCoreN: 1,
      restExtendedIntervalMin: 1,
    },
  });
  assert.equal(result.universe, 2);
  assert.equal(result.scanned, 2);
  assert.deepEqual(
    trackedStore
      .getMarketAlertsSnapshot({ now: new Date(TEST_NOW_MS).toISOString() })
      .marketRanking.map((item) => item.symbol),
    ["SOLUSDT"],
  );

  trackedStore.beginSqueezeDelivery("SOLUSDT", 1, TEST_NOW_MS);
  trackedStore.commitSqueezeDeliverySuccess("SOLUSDT", 1, 60, TEST_NOW_MS);
  const recoveryClient = {
    getExchangeInfo: async () => exchangeInfo,
    getTickers24h: async () => tickers.filter((ticker) =>
      ticker.symbol === "BTCUSDT" || ticker.symbol === "SOLUSDT"),
    getPremiumIndex: async () => [
      { symbol: "BTCUSDT", markPrice: "100", indexPrice: "100", lastFundingRate: "0" },
      { symbol: "SOLUSDT", markPrice: "100", indexPrice: "100", lastFundingRate: "0" },
    ],
    getOpenInterestHistory: async () => Array.from(
      { length: 5 },
      () => ({ sumOpenInterestValue: "5000000" }),
    ),
    getKlines: async () => flatKlines(300_000, 25),
    getGlobalLongShortRatio: async () => 1,
    getTopTraderPositionRatio: async () => 1,
    getTakerBuySellRatio: async () => 1,
  };
  for (let index = 0; index < 3; index += 1) {
    const recovery = await runSqueezeScan({
      client: recoveryClient,
      store: trackedStore,
      nowMs: TEST_NOW_MS + index + 1,
      config: { squeezeTopN: 1, squeezeWorkers: 1 },
    });
    assert.equal(recovery.scanned, 2);
  }
  assert.equal(
    trackedStore
      .getMarketAlertsSnapshot({ now: new Date(TEST_NOW_MS + 4).toISOString() })
      .activeSignals.some((signal) =>
        signal.kind === "short_squeeze" && signal.symbol === "SOLUSDT"),
    false,
  );

  assert.equal(trackedStore.beginSqueezeDelivery("SOLUSDT", 1, TEST_NOW_MS + 10), true);
  trackedStore.markSqueezeDeliveryUncertain("SOLUSDT", 1, "timeout");
  for (let index = 0; index < 3; index += 1) {
    await runSqueezeScan({
      client: recoveryClient,
      store: trackedStore,
      nowMs: TEST_NOW_MS + 11 + index,
      config: { squeezeTopN: 1, squeezeWorkers: 1 },
    });
  }
  assert.equal(
    trackedStore.beginSqueezeDelivery("SOLUSDT", 1, TEST_NOW_MS + 20),
    true,
  );
  trackedStore.releaseSqueezeDelivery("SOLUSDT", 1);
} finally {
  trackedStore?.close();
  rmSync(trackedDirectory, { recursive: true, force: true });
}

class FakeWebSocket {
  listeners = new Map();
  constructor(message) {
    this.messages = Array.isArray(message) ? message : message ? [message] : [];
    queueMicrotask(() => {
      this.emit("open", {});
      for (const data of this.messages) this.emit("message", { data });
    });
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  close(code = 1000, reason = "") {
    this.emit("close", { code, reason });
  }
  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class ReasonlessCloseWebSocket extends FakeWebSocket {
  close(code = 1000) {
    this.emit("close", { code, reason: "" });
  }
}

function websocketClient() {
  return {
    getExchangeInfo: async () => exchangeInfo,
    getTickers24h: async () => tickers.filter((ticker) => ticker.symbol === "BTCUSDT"),
    getKlines: async (_symbol, interval) =>
      flatKlines(interval === "5m" ? 300_000 : 60_000, interval === "5m" ? 36 : 40),
  };
}

const wsDirectory = mkdtempSync(join(tmpdir(), "market-alerts-ws-"));
let wsStore;
try {
  wsStore = openMarketAlertsStore(join(wsDirectory, "alerts.sqlite"));
  await startVolatilityWebSocketWorker({
    client: websocketClient(),
    store: wsStore,
    config: {
      wsTopN: 1,
      wsFirstMessageTimeoutMs: 100,
      wsRankRefreshMs: 10,
    },
    createWebSocket: () =>
      new ReasonlessCloseWebSocket(
        JSON.stringify({
          stream: "btcusdt@ticker",
          data: { s: "BTCUSDT", c: "107", P: "12", q: "7000" },
        }),
      ),
  });
  assert.equal(wsStore.getMarketAlertsSnapshot({ limit: 1 }).health.volatilityWs?.status, "live");

  const probe = await startVolatilityWebSocketWorker({
    client: websocketClient(),
    store: wsStore,
    once: true,
    config: {
      wsTopN: 1,
      wsFirstMessageTimeoutMs: 100,
      wsRankRefreshMs: 1_000,
    },
    createWebSocket: () =>
      new FakeWebSocket(
        JSON.stringify({
          stream: "btcusdt@ticker",
          data: { s: "BTCUSDT", c: "107", P: "12", q: "7000" },
        }),
      ),
  });
  assert.equal(probe.probe, true);
  assert.match(
    wsStore.getMarketAlertsSnapshot({ limit: 1 }).health.volatilityWs?.detail ?? "",
    /验证成功/,
  );

  let releaseFdv;
  let notifyFdvStarted;
  const fdvGate = new Promise((resolve) => {
    releaseFdv = resolve;
  });
  const fdvStarted = new Promise((resolve) => {
    notifyFdvStarted = resolve;
  });
  let fdvCalls = 0;
  let burstSocket;
  const fiveMinuteOpenTime = 1_700_000_000_000 + 35 * 300_000;
  const oneMinuteOpenTime = 1_700_000_000_000 + 39 * 60_000;
  const burstMessages = [
    JSON.stringify({
      stream: "btcusdt@kline_5m",
      data: {
        s: "BTCUSDT",
        k: {
          t: fiveMinuteOpenTime,
          o: "100",
          h: "104",
          l: "99",
          c: "103",
          v: "50",
          T: fiveMinuteOpenTime + 299_999,
          q: "5150",
        },
      },
    }),
    ...Array.from({ length: 2 }, () => JSON.stringify({
      stream: "btcusdt@kline_1m",
      data: {
        s: "BTCUSDT",
        k: {
          t: oneMinuteOpenTime,
          o: "100",
          h: "107",
          l: "99",
          c: "106",
          v: "50",
          T: oneMinuteOpenTime + 59_999,
          q: "5300",
        },
      },
    })),
  ];
  const burstWorker = startVolatilityWebSocketWorker({
    client: {
      ...websocketClient(),
      getFullyDilutedValuation: async () => {
        fdvCalls += 1;
        notifyFdvStarted();
        await fdvGate;
        return 20_000_000;
      },
    },
    store: wsStore,
    config: {
      wsTopN: 1,
      wsFirstMessageTimeoutMs: 100,
      wsRankRefreshMs: 1_000,
      minFdvUsd: 10_000_000,
    },
    createWebSocket: () => {
      burstSocket = new FakeWebSocket(burstMessages);
      return burstSocket;
    },
  });
  await fdvStarted;
  burstSocket.close(1000, "refresh-universe");
  let burstSettled = false;
  void burstWorker.then(
    () => {
      burstSettled = true;
    },
    () => {
      burstSettled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(burstSettled, false);
  releaseFdv();
  await burstWorker;
  assert.equal(fdvCalls, 1);
  assert.equal(
    wsStore.getMarketAlertsSnapshot({ limit: 10 }).events.some(
      (event) => event.symbol === "BTCUSDT" && event.type === "volatility",
    ),
    true,
  );

  await assert.rejects(
    startVolatilityWebSocketWorker({
      client: websocketClient(),
      store: wsStore,
      config: {
        wsTopN: 1,
        wsFirstMessageTimeoutMs: 5,
        wsRankRefreshMs: 1_000,
      },
      createWebSocket: () => new FakeWebSocket(null),
    }),
    /first market message/i,
  );
  assert.equal(wsStore.getMarketAlertsSnapshot({ limit: 1 }).health.volatilityWs?.status, "error");
} finally {
  wsStore?.close();
  rmSync(wsDirectory, { recursive: true, force: true });
}

console.log("ok - Binance market alert workers and fixtures");
