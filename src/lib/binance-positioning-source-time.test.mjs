import assert from "node:assert/strict";
import test from "node:test";
import { createBinanceFuturesClient, runSqueezeScan } from "./market-alerts-binance.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { qualifyOpportunity, transitionPushEpisode } from "./important-push-policy.ts";
import { opportunityDecision, pushNow, pushNowMs } from "./important-push-test-fixtures.mjs";

const bucketStartMs = Date.parse("2026-10-02T01:55:00.000Z");
const symbol = "TESTUSDT";

function sourceClient(options = {}) {
  const { now = () => pushNowMs, otherPositionTimestamp = pushNowMs, onTakerJson } = options;
  const takerTimestamp = Object.hasOwn(options, "takerTimestamp") ? options.takerTimestamp : bucketStartMs;
  const klines = Array.from({ length: 25 }, (_, i) => {
    const open = pushNowMs - (24 - i) * 300_000;
    return [open, "100", "101", "99", "100", "10", open + 299_999, "1000"];
  });
  klines[23][4] = "103";
  klines[23][7] = "3000";
  klines[24][4] = "106";
  const responses = {
    "/fapi/v1/exchangeInfo": { symbols: [{ symbol, status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT", baseAsset: "TEST" }] },
    "/fapi/v1/ticker/24hr": [{ symbol, lastPrice: "106", priceChangePercent: "10", quoteVolume: "80000000" }],
    "/fapi/v1/premiumIndex": [{ symbol, markPrice: "106", indexPrice: "107", lastFundingRate: "-0.0012", time: pushNowMs }],
    "/fapi/v1/klines": klines,
    "/futures/data/openInterestHist": [6, 6.5, 7, 7.5, 8].map((v, i) => ({
      symbol, sumOpenInterest: String(v * 1000), sumOpenInterestValue: String(v * 1_000_000),
      timestamp: pushNowMs - (4 - i) * 300_000,
    })),
    "/futures/data/globalLongShortAccountRatio": [{ symbol, longAccount: "0.4186", shortAccount: "0.5814", longShortRatio: "0.72", timestamp: otherPositionTimestamp }],
    "/futures/data/topLongShortPositionRatio": [{ symbol, longAccount: "0.4475", shortAccount: "0.5525", longShortRatio: "0.81", timestamp: otherPositionTimestamp }],
    "/futures/data/takerlongshortRatio": [{ symbol, buyVol: "135", sellVol: "100", buySellRatio: "1.35", timestamp: takerTimestamp }],
  };
  return createBinanceFuturesClient({ requestSpacingMs: 0 }, {
    now,
    fetch: async request => {
      const url = new URL(request);
      assert.ok(Object.hasOwn(responses, url.pathname), `unexpected endpoint ${url.pathname}`);
      if (url.pathname.startsWith("/futures/data/")) assert.equal(url.searchParams.get("period"), "5m");
      const response = new Response(JSON.stringify(responses[url.pathname]), { status: 200 });
      if (url.pathname === "/futures/data/takerlongshortRatio" && onTakerJson) {
        const json = response.json.bind(response);
        response.json = async () => { const rows = await json(); onTakerJson(); return rows; };
      }
      return response;
    },
  });
}

function opportunityFromPositioning(positioning, nowMs) {
  const collectedAt = new Date(nowMs).toISOString();
  return opportunityDecision({
    observedAt: collectedAt,
    globalLongShortRatio: positioning.global.value,
    topTraderLongShortRatio: positioning.top.value,
    takerBuySellRatio: positioning.taker.value,
    pushEvidence: {
      sourceTimes: {
        futures5m: collectedAt, futures1m: collectedAt, funding: collectedAt, oiGrowth15m: collectedAt,
        globalLongShortRatio: positioning.global.observedAt,
        topTraderLongShortRatio: positioning.top.observedAt,
        takerBuySellRatio: positioning.taker.observedAt,
      },
      candles: [300_000, 60_000].map(intervalMs => ({
        openAt: collectedAt, closeAt: new Date(nowMs + intervalMs - 1).toISOString(), intervalMs, contiguous: true,
      })),
    },
  });
}

test("a newly closed taker bucket reaches real opportunity policy with its completed time", async () => {
  const nowMs = Date.parse("2026-10-02T02:00:30.000Z");
  const client = sourceClient({ now: () => nowMs });
  const positioning = await client.getSqueezePositioning(symbol);
  const decision = opportunityFromPositioning(positioning, nowMs);
  assert.equal(decision.score, 100);
  assert.equal(decision.confidence, 100);
  assert.equal(decision.decision, "关注做多");
  const observation = qualifyOpportunity({ decision, enrichment: { fetchedAt: new Date(nowMs).toISOString(), stale: false, error: null }, scanId: "closed-taker" }, nowMs);
  assert.equal(observation.classification, "qualified", "the just-closed 5m bucket must not look five minutes old");
  assert.deepEqual(positioning.taker, { value: 1.35, observedAt: "2026-10-02T02:00:00.000Z" });
  assert.equal(positioning.global.observedAt, pushNow, "global ratio timestamp already denotes period end");
  assert.equal(positioning.top.observedAt, pushNow, "top position timestamp already denotes period end");
  assert.equal((await client.getOpenInterestHistory(symbol)).at(-1).timestamp, pushNowMs);
  assert.equal((await client.getPremiumIndex())[0].time, pushNowMs);
  const { event } = transitionPushEpisode(null, [observation], nowMs);
  assert.equal(event.expiresAt, "2026-10-02T02:02:30.000Z", "notification event TTL stays two minutes");
});

for (const [ageMs, expected] of [[0, "qualified"], [120_000, "qualified"], [120_001, "incomplete"]]) {
  test(`closed taker age ${ageMs}ms remains ${expected} under the unchanged freshness policy`, async () => {
    const nowMs = pushNowMs + ageMs;
    // Make all other sources current so this boundary belongs specifically to taker provenance.
    const positioning = await sourceClient({ now: () => nowMs, otherPositionTimestamp: nowMs }).getSqueezePositioning(symbol);
    const decision = opportunityFromPositioning(positioning, nowMs);
    assert.equal(qualifyOpportunity({ decision, enrichment: { fetchedAt: new Date(nowMs).toISOString(), stale: false, error: null }, scanId: `age-${ageMs}` }, nowMs).classification, expected);
  });
}

async function squeezeEvaluation(client, nowMs) {
  const store = openMarketAlertsStore(":memory:");
  try {
    store.commitSqueezePushScan({ pushObservations: [], scannedAt: new Date(nowMs).toISOString() });
    await runSqueezeScan({ store, client, nowMs, now: () => nowMs,
      config: { squeezeTopN: 1, squeezeWorkers: 1, minOiNotional: 2_000_000 } });
    return { evaluation: store.readMarketPushEvaluation(symbol, "squeeze:short_squeeze"), events: store.readMarketPushOutboxAfter(0, 100) };
  } finally { store.close(); }
}

test("a closed taker source also qualifies through the real squeeze producer and oldest-source aggregation", async () => {
  const nowMs = pushNowMs + 30_000;
  const { evaluation, events } = await squeezeEvaluation(sourceClient({ now: () => nowMs }), nowMs);
  assert.equal(evaluation.classification, "qualified");
  assert.equal(evaluation.sourceTimes.takerAt, pushNow);
  assert.equal(evaluation.squeezeMetrics.observedAt, pushNow);
  assert.equal(evaluation.squeezeMetrics.takerBuySellRatio, 1.35);
  assert.equal(events.length, 1);
});

test("an unclosed taker bucket cannot be hidden by older valid sources in squeeze aggregation", async () => {
  const nowMs = pushNowMs + 30_000;
  const client = sourceClient({ takerTimestamp: pushNowMs, now: () => nowMs });
  const { evaluation, events } = await squeezeEvaluation(client, nowMs);
  assert.equal(events.length, 0, "a future bucket end must not create a squeeze push event");
  assert.notEqual(evaluation.classification, "qualified");
  assert.equal(evaluation.sourceTimes.takerAt, null);
  assert.equal(evaluation.squeezeMetrics.observedAt, "", "missing completion time must invalidate the minimum, rather than be hidden by it");
  assert.equal(evaluation.sourceTimes.globalPositionAt, pushNow);
  assert.equal(evaluation.sourceTimes.openInterestAt, pushNow);
  assert.equal(evaluation.squeezeMetrics.takerBuySellRatio, 1.35, "unfinished provenance does not change scoring values");
  const decision = opportunityFromPositioning(await client.getSqueezePositioning(symbol), nowMs);
  assert.equal(qualifyOpportunity({ decision, enrichment: { fetchedAt: new Date(nowMs).toISOString(), stale: false, error: null }, scanId: "unclosed-taker" }, nowMs).classification, "incomplete");
});

test("taker closure uses the response collection clock instead of the request start", async () => {
  let nowMs = pushNowMs - 1;
  const client = sourceClient({ now: () => nowMs, onTakerJson: () => { nowMs = pushNowMs; } });
  assert.equal((await client.getSqueezePositioning(symbol)).taker.observedAt, pushNow);
});

test("a bucket is not complete one millisecond before its exclusive end", async () => {
  const positioning = await sourceClient({ now: () => pushNowMs - 1 }).getSqueezePositioning(symbol);
  assert.deepEqual(positioning.taker, { value: 1.35, observedAt: null });
});

test("invalid, missing and out-of-range taker timestamps cannot become completed source evidence", async () => {
  for (const timestamp of [undefined, null, "", "  ", "not-a-time", "Infinity", NaN, Infinity, -Infinity, 0, -1, true, [], {}, 8.64e15 - 299_999, 8.64e15, 8.64e15 + 1]) {
    const positioning = await sourceClient({ takerTimestamp: timestamp, now: () => 8.64e15 }).getSqueezePositioning(symbol);
    assert.deepEqual(positioning.taker, { value: 1.35, observedAt: null }, `invalid raw timestamp: ${JSON.stringify(timestamp)}`);
  }
  const latestValid = await sourceClient({ takerTimestamp: 8.64e15 - 300_000, now: () => 8.64e15 }).getSqueezePositioning(symbol);
  assert.equal(latestValid.taker.observedAt, "+275760-09-13T00:00:00.000Z");
});

test("numeric string taker timestamps preserve their value and normalize exactly to the period end", async () => {
  const positioning = await sourceClient({ takerTimestamp: String(bucketStartMs) }).getSqueezePositioning(symbol);
  assert.deepEqual(positioning.taker, { value: 1.35, observedAt: "2026-10-02T02:00:00.000Z" });
});
