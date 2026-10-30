import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { decideHynixPremiumPush, hynixPremiumPushStillQualified, openHynixPremiumPushStore, runHynixPremiumPushCycle } from "./hynix-premium-push.ts";
import { fetchBinanceHynixPremiumQuote } from "./binance-hynix-premium.ts";
import { createHynixPushSource, runWebPushCycle } from "./web-push-worker.ts";
import { openWebPushStore } from "./web-push-store.ts";

const nowMs = Date.parse("2026-10-30T08:00:00.000Z");
const fresh = new Date(nowMs - 30_000).toISOString();
const stale = new Date(nowMs - 10 * 60_000).toISOString();

let decision = decideHynixPremiumPush({ enabled: true, thresholdPct: 50, premiumPct: 49.9, observedAt: fresh, nowMs });
assert.equal(decision.reason, "below");
assert.equal(decision.event, null);
assert.equal(decision.state.latched, false);

decision = decideHynixPremiumPush({ state: decision.state, enabled: true, thresholdPct: 50, premiumPct: 50, observedAt: fresh, nowMs });
assert.equal(decision.reason, "crossed");
assert.equal(decision.event?.source, "hynix");
assert.equal(decision.event?.target, "/stocks");
assert.equal(decision.event?.sourcePublishedAt, fresh);
assert.equal(decision.state.latched, true);
const firstId = decision.event?.id;

decision = decideHynixPremiumPush({ state: decision.state, enabled: true, thresholdPct: 50, premiumPct: 62.4, observedAt: new Date(nowMs - 10_000).toISOString(), nowMs });
assert.equal(decision.reason, "already_latched");
assert.equal(decision.event, null);

decision = decideHynixPremiumPush({ state: decision.state, enabled: true, thresholdPct: 50, premiumPct: 49, observedAt: fresh, nowMs });
assert.equal(decision.reason, "below");
const recrossAt = new Date(nowMs - 5_000).toISOString();
decision = decideHynixPremiumPush({ state: decision.state, enabled: true, thresholdPct: 50, premiumPct: 51.2, observedAt: recrossAt, nowMs });
assert.equal(decision.reason, "crossed");
assert.notEqual(decision.event?.id, firstId);

const latched = decision.state;
decision = decideHynixPremiumPush({ state: latched, enabled: true, thresholdPct: 50, premiumPct: 80, observedAt: stale, nowMs });
assert.equal(decision.reason, "stale_quote");
assert.equal(decision.event, null);
assert.equal(decision.state.latched, true, "stale history must not clear or create a crossing");

decision = decideHynixPremiumPush({ state: { ...latched, latched: false }, enabled: false, thresholdPct: 50, premiumPct: 80, observedAt: fresh, nowMs });
assert.equal(decision.reason, "disabled");
assert.equal(decision.event, null);

decision = decideHynixPremiumPush({ enabled: true, thresholdPct: 50, premiumPct: null, observedAt: null, nowMs });
assert.equal(decision.reason, "missing_quote");

const store = openHynixPremiumPushStore(":memory:");
const pushStore = openWebPushStore(":memory:");
try {
  const first = store.observe({ enabled: true, thresholdPct: 50, premiumPct: 55, observedAt: fresh, nowMs });
  const duplicate = store.observe({ enabled: true, thresholdPct: 50, premiumPct: 56, observedAt: new Date(nowMs - 20_000).toISOString(), nowMs });
  assert.equal(first.reason, "crossed");
  assert.equal(duplicate.reason, "already_latched");
  assert.equal(store.readAfter(0, 10).length, 1);
  assert.equal(store.revalidate(first.event, nowMs), true);
  assert.equal(store.revalidate(first.event, nowMs + 4 * 60_000), false);
  store.observe({ enabled: true, thresholdPct: 50, premiumPct: 10, observedAt: new Date(nowMs - 1_000).toISOString(), nowMs });
  assert.equal(hynixPremiumPushStillQualified(first.event, store.readState(), nowMs), false);

  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const keys = { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  pushStore.enrollDevice({
    subscription: { endpoint: "https://fcm.googleapis.com/hynix", keys },
    device: { deviceId: randomUUID(), deviceKey: randomBytes(32).toString("base64url") },
    baseline: { sources: { market: 0, news: 0, hynix: 0 }, marketEpisodes: [], enabledAt: new Date(nowMs - 60_000).toISOString() },
    nowMs: nowMs - 60_000,
  });
  const sent = [];
  const result = await runWebPushCycle({
    pushStore,
    marketSource: { readAfter: () => [], getBaseline: () => ({ lastSequence: 0 }), revalidate: () => true },
    newsSource: { readAfter: () => [], getBaseline: () => ({ lastSequence: 0 }), revalidate: () => true },
    hynixSource: createHynixPushSource(store),
    sender: { send: async (_subscription, payload) => { sent.push(payload); return { kind: "accepted", statusCode: 201, retryAfterMs: null, errorCode: null }; } },
    nowMs,
    now: () => nowMs,
    owner: "hynix-test",
  });
  assert.equal(result.hynixSent, 0, "a crossing that later fell below the threshold is not delivered");
} finally {
  store.close();
  pushStore.close();
}

const freshStore = openHynixPremiumPushStore(":memory:");
const deliverStore = openWebPushStore(":memory:");
try {
  const observedAt = new Date(nowMs - 15_000).toISOString();
  freshStore.observe({ enabled: true, thresholdPct: 50, premiumPct: 53.2, observedAt, nowMs });
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  deliverStore.enrollDevice({
    subscription: { endpoint: "https://web.push.apple.com/hynix", keys: { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } },
    device: { deviceId: randomUUID(), deviceKey: randomBytes(32).toString("base64url") },
    baseline: { sources: { market: 0, news: 0 }, marketEpisodes: [], enabledAt: new Date(nowMs - 120_000).toISOString() },
    nowMs: nowMs - 120_000,
  });
  const sent = [];
  const result = await runWebPushCycle({
    pushStore: deliverStore,
    marketSource: { readAfter: () => [], getBaseline: () => ({ lastSequence: 0 }), revalidate: () => true },
    newsSource: { readAfter: () => [], getBaseline: () => ({ lastSequence: 0 }), revalidate: () => true },
    hynixSource: createHynixPushSource(freshStore),
    sender: { send: async (_subscription, payload) => { sent.push(payload); return { kind: "accepted", statusCode: 201, retryAfterMs: null, errorCode: null }; } },
    nowMs,
    now: () => nowMs,
    owner: "hynix-deliver",
  });
  assert.equal(result.hynixSent, 1);
  assert.equal(sent[0].target, "/stocks");
  assert.equal(sent[0].sourcePublishedAt, observedAt);
} finally {
  freshStore.close();
  deliverStore.close();
}

const urls = [];
const quote = await fetchBinanceHynixPremiumQuote({
  env: {},
  fetchImpl: async (url) => {
    urls.push(String(url));
    const symbol = new URL(String(url)).searchParams.get("symbol");
    return new Response(JSON.stringify({
      symbol,
      markPrice: symbol === "SKHYUSDT" ? "150" : "1000",
      indexPrice: "1",
      lastFundingRate: "0.0001",
      nextFundingTime: nowMs + 60_000,
      time: nowMs - 5_000,
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(quote.premiumPct, 50);
assert.equal(quote.observedAt, new Date(nowMs - 5_000).toISOString());
assert.equal(urls.length, 2);
assert.ok(urls.every((url) => url.includes("/fapi/v1/premiumIndex") && !url.includes("/klines")));

const quoted = await runHynixPremiumPushCycle({
  nowMs,
  store: openHynixPremiumPushStore(":memory:"),
  settings: { enabled: true, thresholdPct: 50, pushRevision: 1 },
  quote: { premiumPct: 50, observedAt: fresh, baseSymbol: "SKHYUSDT", benchmarkSymbol: "SKHYNIXUSDT", basePrice: 150, benchmarkPrice: 1000 },
});
assert.equal(quoted.reason, "crossed");
assert.equal(quoted.fetchError, null);

console.log("ok - hynix premium web push");
