import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { runSqueezeScan } from "./market-alerts-binance.ts";
import { qualifyOpportunity } from "./important-push-policy.ts";
import { opportunityDecision, pushNow, pushNowMs } from "./important-push-test-fixtures.mjs";
const directory = mkdtempSync(join(tmpdir(), "push-producers-"));
const path = join(directory, "alerts.sqlite");
let store;
try {
  store = openMarketAlertsStore(path);
  assert.equal(typeof store.commitOpportunityScan, "function", "candidate/outbox transaction must exist");
  store.commitOpportunityScan({ states: [], pushObservations: [], scannedAt: pushNow }); // warm producer baseline
  const decision = opportunityDecision();
  const candidate = { symbol: decision.symbol, decision, entryStreak: 2, exitStreak: 0, enteredAt: pushNow, lastQualifiedAt: pushNow, lastConfirmedAt: pushNow, selected: true, rank: 1, updatedAt: pushNow };
  const observation = qualifyOpportunity({ decision, enrichment: { fetchedAt: pushNow, stale: false, error: null }, scanId: "op-1" }, pushNowMs);
  const injector = new DatabaseSync(path);
  injector.exec("CREATE TRIGGER fail_push BEFORE INSERT ON important_push_outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END;");
  assert.throws(() => store.commitOpportunityScan({ states: [candidate], pushObservations: [observation], scannedAt: pushNow }), /injected/);
  assert.deepEqual(store.getOpportunityCandidateStates(), []);
  assert.equal(store.getMarketPushBaseline().episodes.length, 0);
  injector.exec("DROP TRIGGER fail_push;"); injector.close();
  store.commitOpportunityScan({ states: [candidate], pushObservations: [observation], scannedAt: pushNow });
  assert.equal(store.readMarketPushOutboxAfter(0, 100).length, 1);
  store.close(); store = openMarketAlertsStore(path);
  store.commitOpportunityScan({ states: [candidate], pushObservations: [observation], scannedAt: pushNow });
  assert.equal(store.readMarketPushOutboxAfter(0, 100).length, 1, "restart preserves dedup");
  store.commitSqueezePushScan({ pushObservations: [], scannedAt: pushNow });
  const rows = Array.from({ length: 25 }, (_, i) => [pushNowMs - (25 - i) * 300_000, "100", "101", "99", "100", "10", pushNowMs - (24 - i) * 300_000 - 1, "1000"]);
  rows[23][4] = "103"; rows[23][7] = "3000"; rows[24][4] = "106";
  const client = {
    getExchangeInfo: async () => ({ symbols: [{ symbol: "TESTUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT", baseAsset: "TEST" }] }),
    getTickers24h: async () => [{ symbol: "TESTUSDT", lastPrice: "106", priceChangePercent: "10", quoteVolume: "80000000" }],
    getPremiumIndex: async () => [{ symbol: "TESTUSDT", markPrice: "106", indexPrice: "107", lastFundingRate: "-0.0012", time: pushNowMs }],
    getOpenInterestHistory: async () => [6, 6.5, 7, 7.5, 8].map((v, i) => ({ sumOpenInterestValue: String(v * 1_000_000), timestamp: pushNowMs - (4 - i) * 300_000 })),
    getKlines: async () => rows,
    getGlobalLongShortRatio: async () => 0.72, getTopTraderPositionRatio: async () => 0.81, getTakerBuySellRatio: async () => 1.35,
    getSqueezePositioning: async () => ({ global: { value: 0.72, observedAt: pushNow }, top: { value: 0.81, observedAt: pushNow }, taker: { value: 1.35, observedAt: pushNow } }),
  };
  await assert.rejects(runSqueezeScan({ store, client, nowMs: pushNowMs, now: () => pushNowMs, config: { squeezeTopN: 1, squeezeWorkers: 1, minOiNotional: 2_000_000 }, deliverAlert: async () => { throw new Error("telegram unavailable"); } }), /telegram unavailable/);
  assert.equal(store.readMarketPushOutboxAfter(0, 100).length, 2, "raw acceleration commits before Telegram failure");
  assert.equal(store.readMarketPushEvaluation("TESTUSDT", "squeeze:short_squeeze").squeezeMetrics.breakout20, true);
  assert.equal(store.readMarketPushEvaluation("TESTUSDT", "squeeze:short_squeeze").sourceTimes.openInterestAt, pushNow);
  await runSqueezeScan({ store, client, nowMs: pushNowMs + 1_000, now: () => pushNowMs + 1_000, config: { squeezeTopN: 1, squeezeWorkers: 1, minOiNotional: 2_000_000 } });
  assert.equal(store.readMarketPushOutboxAfter(0, 100).length, 2, "unchanged raw stage never repeats");
  assert.equal(store.readMarketPushEvaluation("TESTUSDT", "squeeze:short_squeeze").scanId, `squeeze:${pushNowMs + 1_000}`);
} finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
console.log("market push producers commit and recover tests passed");
