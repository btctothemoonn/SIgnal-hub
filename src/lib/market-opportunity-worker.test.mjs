import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openMarketAlertsStore } = await import("./market-alerts-store.ts");
const { runMarketOpportunityScan } = await import("./market-opportunity-worker.ts");

const directory = mkdtempSync(join(tmpdir(), "market-opportunity-worker-"));
const nowMs = Date.parse("2026-09-04T04:00:00.000Z");
let store;

function kline(index, close, volume = 10, intervalMs = 300_000) {
  const openTime = nowMs - (300 - index) * intervalMs;
  return [
    openTime,
    String(close),
    String(close * 1.001),
    String(close * 0.999),
    String(close),
    String(volume),
    openTime + intervalMs - 1,
    String(volume * close),
  ];
}

function strongKlines(interval) {
  const intervalMs = interval === "1m" ? 60_000 : 300_000;
  const count = interval === "1m" ? 30 : 288;
  const rows = Array.from({ length: count }, (_, index) =>
    kline(index, 90, 10, intervalMs));
  if (interval === "1m") {
    rows[count - 2] = kline(count - 2, 103, 15, intervalMs);
    rows[count - 1] = kline(count - 1, 106, 35, intervalMs);
    return rows;
  }
  rows[count - 13] = kline(count - 13, 93, 10, intervalMs);
  rows[count - 4] = kline(count - 4, 100, 30, intervalMs);
  rows[count - 3] = kline(count - 3, 102, 30, intervalMs);
  rows[count - 2] = kline(count - 2, 104, 30, intervalMs);
  rows[count - 1] = kline(count - 1, 106, 30, intervalMs);
  return rows;
}

try {
  store = openMarketAlertsStore(join(directory, "alerts.sqlite"));
  for (let index = 0; index < 20; index += 1) {
    const symbol = `T${String(index).padStart(2, "0")}USDT`;
    store.insertMarketAlertEvent({
      id: `volatility:LONG:${symbol}:fixture`,
      type: "volatility",
      symbol,
      side: "LONG",
      level: index < 12 ? 2 : 1,
      stage: "暴涨预警",
      trigger: "A趋势·确认",
      source: "rest",
      price: 106,
      changePct: 8,
      volumeRatio: 3,
      score: null,
      metrics: { pct5m: 8 },
      reasons: ["fixture"],
      occurredAt: new Date(nowMs - index * 1_000).toISOString(),
      createdAt: new Date(nowMs - index * 1_000).toISOString(),
    });
    store.insertMarketAlertEvent({
      id: `volatility:LONG:${symbol}:fixture-2`,
      type: "volatility",
      symbol,
      side: "LONG",
      level: index < 12 ? 2 : 1,
      stage: "暴涨预警",
      trigger: "B加速·确认",
      source: "ws",
      price: 106,
      changePct: 7,
      volumeRatio: 2.5,
      score: null,
      metrics: { pct5m: 7 },
      reasons: ["fixture"],
      occurredAt: new Date(nowMs - index * 1_000 - 500).toISOString(),
      createdAt: new Date(nowMs - index * 1_000 - 500).toISOString(),
    });
    store.upsertMarketTickers([{
      symbol,
      price: 106,
      pct24h: 18,
      quoteVolume: 80_000_000 - index,
      updatedAt: new Date(nowMs).toISOString(),
    }]);
  }

  const fetchedSymbols = new Set();
  let aiCalls = 0;
  const aiProviders = [{
    id: "minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "fixture-key",
    model: "MiniMax-M2.7-worker-test",
  }];
  const aiFetch = async () => {
    aiCalls += 1;
    return Response.json({
      choices: [{ message: { content: JSON.stringify({
        items: ["T00USDT", "T01USDT", "T02USDT", "T03USDT", "T04USDT"].map(
          (symbol) => ({
            symbol,
            summary: "规则确认后关注。",
            rationale: "价格、成交和 OI 同向。",
            confirmation: "等待回踩不破。",
            invalidation: "跌破启动结构。",
            risk: "短线波动风险。",
            validFor: "2 小时内复核。",
          }),
        ),
      }) } }],
    });
  };
  const client = {
    getKlines: async (symbol, interval) => {
      fetchedSymbols.add(symbol);
      return strongKlines(interval);
    },
    getPremiumIndex: async () => Array.from({ length: 20 }, (_, index) => ({
      symbol: `T${String(index).padStart(2, "0")}USDT`,
      markPrice: "106",
      indexPrice: "106.1",
      lastFundingRate: "0.0001",
    })),
    getOpenInterestHistory: async () => [
      { sumOpenInterest: "70000" },
      { sumOpenInterest: "77000" },
    ],
    getGlobalLongShortRatio: async () => 1.02,
    getTopTraderPositionRatio: async () => 1.04,
    getTakerBuySellRatio: async () => 1.34,
    getSpotContext: async () => ({ ticker: null, klines5m: strongKlines("5m") }),
  };

  const first = await runMarketOpportunityScan({
    store,
    client,
    nowMs,
    aiProviders,
    fetchImpl: aiFetch,
  });
  assert.equal(first.seedCount, 12);
  assert.equal(first.enrichedCount, 12);
  assert.equal(first.selectedCount, 0, "first qualifying scan only primes entry counters");
  assert.equal(fetchedSymbols.size, 12);

  const second = await runMarketOpportunityScan({
    store,
    client,
    nowMs: nowMs + 60_000,
    aiProviders,
    fetchImpl: aiFetch,
  });
  assert.equal(second.selectedCount, 5);
  assert.equal(store.getMarketAlertsSnapshot({ limit: 5 }).opportunities.length, 5);
  assert.equal(
    new Set(store.getMarketAlertsSnapshot({ limit: 5 }).opportunities.map((item) => item.symbol)).size,
    5,
  );
  assert.equal(store.getMarketAlertsSnapshot({ limit: 5 }).health.opportunity?.status, "live");
  assert.match(store.getMarketAlertsSnapshot({ limit: 5 }).health.opportunity?.detail ?? "", /selected=5/);
  assert.equal(aiCalls, 1, "the whole Top 5 must be explained in one AI batch");
  assert.equal(
    store.getMarketAlertsSnapshot({ limit: 5 }).opportunities[0].ai?.summary,
    "规则确认后关注。",
  );

  await runMarketOpportunityScan({
    store,
    client,
    nowMs: nowMs + 2 * 60_000,
    aiProviders,
    fetchImpl: aiFetch,
  });
  assert.equal(aiCalls, 1, "an unchanged decision fingerprint must reuse the AI cache");

  const priorDiagnostics = store.pruneOpportunityDiagnostics("2026-09-04T03:59:30.000Z");
  assert.ok(priorDiagnostics >= 0);

  const emptyDirectory = mkdtempSync(join(tmpdir(), "market-opportunity-empty-"));
  const emptyStore = openMarketAlertsStore(join(emptyDirectory, "alerts.sqlite"));
  try {
    const empty = await runMarketOpportunityScan({
      store: emptyStore,
      client,
      nowMs,
    });
    assert.equal(empty.seedCount, 0);
    assert.equal(empty.enrichedCount, 0);
    assert.equal(empty.selectedCount, 0);
    assert.equal(typeof empty.fingerprint, "string");
    assert.equal(emptyStore.getMarketAlertsSnapshot().opportunities.length, 0);
  } finally {
    emptyStore.close();
    rmSync(emptyDirectory, { recursive: true, force: true });
  }
} finally {
  store?.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log("ok - market opportunity scan persists a bounded deterministic Top 5");
