import assert from "node:assert/strict";
import {
  buildPullbackPushEvent,
  classifyPositioning,
  computeTradeOutcome,
  computeWatchOutcome,
  evaluatePullback,
  getMarketSignalRules,
  normalizeKlines,
  openMarketSignalsStore,
  readMarketSignalsSnapshot,
  summarizeSignals,
} from "./market-signals.ts";
import { runMarketSignalsCycle } from "./market-signals-worker.ts";

const M15 = 15 * 60_000;
const H = 60 * 60_000;
const rules = getMarketSignalRules({});
const T = Date.parse("2026-11-10T00:00:00.000Z"); // trigger time, on a bar boundary

// Build 15m bars from `from` with a price path function of the bar index after the trigger.
function bars(from, count, price) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = from + i * M15;
    const p = price(t);
    out.push({ t, o: p.o, h: p.h, l: p.l, c: p.c });
  }
  return out;
}
const flat = (v) => ({ o: v, h: v, l: v, c: v });
// Flat at 1.0 before the trigger, run to 1.30, then dip to the 12% pullback level.
function pumpThenDip(t) {
  if (t <= T) return flat(1);
  const k = (t - T) / M15;
  if (k <= 4) return { o: 1 + 0.06 * (k - 1), h: 1 + 0.075 * k, l: 1 + 0.06 * (k - 1), c: 1 + 0.075 * k };
  if (k === 5) return { o: 1.3, h: 1.3, l: 1.2, c: 1.2 };
  if (k === 6) return { o: 1.2, h: 1.2, l: 1.13, c: 1.15 };
  return flat(1.15);
}
const history = bars(T - 25 * H, 100 + 24, pumpThenDip);

// Rules match the backtest defaults.
assert.equal(rules.pullbackPct, 12);
assert.equal(rules.maxPre24hPct, 10);
assert.equal(rules.stopPct, 8);
assert.equal(getMarketSignalRules({ MARKET_SIGNAL_PULLBACK_PCT: "10" }).pullbackPct, 10);
assert.equal(getMarketSignalRules({ MARKET_SIGNAL_PULLBACK_PCT: "abc" }).pullbackPct, 12);

// normalizeKlines accepts raw Binance rows and drops malformed ones.
assert.deepEqual(normalizeKlines([[2, "1", "2", "0.5", "1.5"], ["x"], [1, "1", "1", "1", "1"]]).map((bar) => bar.t), [1, 2]);

// Before any closed bar after the trigger exists, the anchor keeps waiting.
let result = evaluatePullback({ triggerAtMs: T, bars15m: history, nowMs: T + M15, rules });
assert.equal(result.status, "waiting");

// While price is still running up, no fill.
result = evaluatePullback({ triggerAtMs: T, bars15m: history, nowMs: T + 5 * M15, rules });
assert.equal(result.status, "waiting");
assert.ok(Math.abs(result.highSinceTrigger - 1.3) < 1e-9);

// The 12% pullback from the 1.30 high fills at 1.144 on the bar that opened at T+6*15m.
result = evaluatePullback({ triggerAtMs: T, bars15m: history, nowMs: T + 8 * M15, rules });
assert.equal(result.status, "filled");
assert.ok(Math.abs(result.entryPrice - 1.144) < 1e-9);
assert.ok(Math.abs(result.stopPrice - 1.144 * 0.92) < 1e-9);
assert.equal(result.entryAtMs, T + 7 * M15);
assert.ok(Math.abs(result.pre24hPct) < 1e-9);

// An unclosed bar is never used: the dip bar is still forming at T+6*15m+1min.
result = evaluatePullback({ triggerAtMs: T, bars15m: history, nowMs: T + 6 * M15 + 60_000, rules });
assert.equal(result.status, "waiting");

// Coins that already ran 10%+ in the prior 24h are rejected.
const ranUp = bars(T - 25 * H, 124, (t) => (t <= T ? flat(t <= T - 24 * H + M15 ? 0.85 : 1) : pumpThenDip(t)));
result = evaluatePullback({ triggerAtMs: T, bars15m: ranUp, nowMs: T + 8 * M15, rules });
assert.equal(result.status, "rejected");
assert.equal(result.reason, "pre24h");

// Missing 24h history is rejected rather than guessed.
result = evaluatePullback({ triggerAtMs: T, bars15m: history.filter((bar) => bar.t >= T - 2 * H), nowMs: T + 8 * M15, rules });
assert.equal(result.status, "rejected");
assert.equal(result.reason, "history_missing");

// No pullback within 12h expires the anchor.
const neverDips = bars(T - 25 * H, 100 + 60, (t) => (t <= T ? flat(1) : flat(1.05)));
result = evaluatePullback({ triggerAtMs: T, bars15m: neverDips, nowMs: T + 13 * H, rules });
assert.equal(result.status, "expired");

// Trade outcome: stop hit, held to 24h, and not enough bars yet.
const entryAt = T;
const stopBars = bars(entryAt, 96, (t) => (t === entryAt + 3 * M15 ? { o: 1, h: 1.05, l: 0.9, c: 0.95 } : flat(1)));
let outcome = computeTradeOutcome({ entryPrice: 1, entryAtMs: entryAt, bars15m: stopBars, nowMs: entryAt + 25 * H, stopPct: 8, holdMs: 24 * H });
assert.equal(outcome.stopHit, true);
assert.ok(Math.abs(outcome.returnPct - -8.1) < 1e-9);
const winBars = bars(entryAt, 96, (t) => flat(1 + (t - entryAt) / M15 / 960));
outcome = computeTradeOutcome({ entryPrice: 1, entryAtMs: entryAt, bars15m: winBars, nowMs: entryAt + 25 * H, stopPct: 8, holdMs: 24 * H });
assert.equal(outcome.stopHit, false);
assert.ok(outcome.returnPct > 9 && outcome.returnPct < 10);
assert.equal(computeTradeOutcome({ entryPrice: 1, entryAtMs: entryAt, bars15m: winBars.slice(0, 50), nowMs: entryAt + 25 * H, stopPct: 8, holdMs: 24 * H }), null);

// Watch outcome is direction-neutral and records which side hit first.
const launch = bars(entryAt, 48, (t) => (t === entryAt + 2 * M15 ? { o: 1, h: 1.2, l: 1, c: 1.18 } : flat(1)));
let watch = computeWatchOutcome({ refPrice: 1, startMs: entryAt, bars15m: launch, nowMs: entryAt + 13 * H, windowMs: 12 * H });
assert.equal(watch.launched, true);
assert.equal(watch.upFirst, true);
const dumpFirst = bars(entryAt, 48, (t) => (t === entryAt + M15 ? { o: 1, h: 1, l: 0.9, c: 0.9 } : t === entryAt + 5 * M15 ? { o: 0.9, h: 1.2, l: 0.9, c: 1.1 } : flat(1)));
watch = computeWatchOutcome({ refPrice: 1, startMs: entryAt, bars15m: dumpFirst, nowMs: entryAt + 13 * H, windowMs: 12 * H });
assert.equal(watch.launched, true);
assert.equal(watch.upFirst, false);

// Positioning classification: coil needs OI build with flat price; volatile is OI surge or deep negative funding.
const points = (oiNow, closeNow, close4h, close24h) => Array.from({ length: 25 }, (_, i) => ({
  hourMs: T - (24 - i) * H,
  close: i === 24 ? closeNow : i === 20 ? close4h : i === 0 ? close24h : 1,
  oiValue: i === 24 ? oiNow : i === 0 ? 100 : 110,
}));
let state = classifyPositioning({ symbol: "AUSDT", points: points(140, 1.02, 1.0, 1.0), funding: 0.0001, rules });
assert.equal(state.coil, true);
assert.equal(state.volatile, true);
assert.ok(Math.abs(state.oi24hPct - 40) < 1e-9);
state = classifyPositioning({ symbol: "AUSDT", points: points(140, 1.2, 1.0, 1.0), funding: 0.0001, rules });
assert.equal(state.coil, false, "price already moved 20% in 4h");
assert.equal(state.volatile, true);
state = classifyPositioning({ symbol: "AUSDT", points: points(105, 1.0, 1.0, 1.0), funding: -0.002, rules });
assert.equal(state.coil, false);
assert.equal(state.volatile, true, "deep negative funding");
state = classifyPositioning({ symbol: "AUSDT", points: points(105, 1.0, 1.0, 1.0), funding: 0.0001, rules });
assert.equal(state.volatile, false);
assert.equal(classifyPositioning({ symbol: "AUSDT", points: points(140, 1, 1, 1).slice(10), funding: null, rules }).oi24hPct, null);

// Stats.
const mk = (kind, outcome) => ({ id: Math.random().toString(36), kind, symbol: "X", signalAt: new Date(T).toISOString(), refPrice: 1, detail: {}, outcome, pushed: false });
const stats = summarizeSignals([
  mk("pullback_long", { returnPct: 10, stopHit: false }),
  mk("pullback_long", { returnPct: -8.1, stopHit: true }),
  mk("pullback_long", { returnPct: -1, stopHit: false }),
  mk("pullback_long", null),
], "pullback_long");
assert.equal(stats.n, 3);
assert.ok(Math.abs(stats.winRate - 1 / 3) < 1e-9);
assert.equal(stats.medianReturnPct, -1);
const watchStats = summarizeSignals([mk("coil_watch", { launched: true, crashed: false, upFirst: true }), mk("coil_watch", { launched: false, crashed: true, upFirst: false })], "coil_watch");
assert.equal(watchStats.launchRate, 0.5);
assert.equal(watchStats.crashRate, 0.5);

// Store: signals are idempotent and their push event is written in the same transaction.
const store = openMarketSignalsStore(":memory:");
const signal = { id: "pullback_long:AUSDT:x", kind: "pullback_long", symbol: "AUSDT", signalAt: new Date(T).toISOString(), refPrice: 1.144, detail: { stopPrice: 1.05, pre24hPct: 0, triggerAt: "t" }, outcome: null, pushed: false };
const event = buildPullbackPushEvent(signal, rules);
assert.equal(event.source, "signals");
assert.equal(event.stage, "pullback_entry");
assert.equal(event.target, "/alerts");
assert.match(event.title, /^A 回调买点$/);
assert.equal(Date.parse(event.expiresAt) - T, 30 * 60_000);
assert.equal(store.recordSignal(signal, T, event), true);
assert.equal(store.recordSignal(signal, T, event), false);
assert.equal(store.readAfter(0, 10).length, 1);
assert.equal(store.getBaseline().lastSequence, 1);
assert.equal(store.revalidate(event, T + 60_000), true);
assert.equal(store.revalidate(event, T + 31 * 60_000), false);
assert.equal(store.latestSignalAt("pullback_long", "AUSDT"), T);
assert.equal(store.pendingOutcomes("pullback_long", T, 5).length, 1);
store.setOutcome(signal.id, { returnPct: 3, stopHit: false, maxUpPct: 5, maxDownPct: -2, closedAt: "x" });
assert.equal(store.pendingOutcomes("pullback_long", T, 5).length, 0);
store.upsertPositioning([{ symbol: "AUSDT", hourMs: T, close: 1, oiValue: 10, funding: null }]);
store.upsertPositioning([{ symbol: "AUSDT", hourMs: T, close: 1.1, oiValue: null, funding: 0.001 }]);
assert.equal(store.prunePositioning(T + 1), 1);
const snapshot = readMarketSignalsSnapshot({ store, nowMs: T + H, env: {} });
assert.equal(snapshot.signals.length, 1);
assert.equal(snapshot.stats.pullback_long.n, 1);
store.close();

// Worker cycle with a fake client: one trigger, a pullback fill that is fresh enough to push.
{
  const signals = openMarketSignalsStore(":memory:");
  const nowMs = T + 8 * M15;
  const raw = history.map((bar) => [bar.t, String(bar.o), String(bar.h), String(bar.l), String(bar.c)]);
  const calls = [];
  const client = {
    async getKlinesSince(symbol, interval, startTime) {
      calls.push([symbol, interval]);
      return raw.filter((row) => row[0] >= startTime);
    },
    async getHourlyOpenInterest() { return []; },
    async getPremiumIndex() { return []; },
    async getTickers24h() { return []; },
  };
  const alerts = {
    getMarketAlertsSnapshot: () => ({
      events: [
        { id: "e1", type: "volatility", symbol: "AUSDT", side: "LONG", occurredAt: new Date(T).toISOString(), price: 1, level: 1, trigger: "B加速·实时" },
        { id: "e2", type: "volatility", symbol: "BUSDT", side: "SHORT", occurredAt: new Date(T).toISOString(), price: 1, level: 1, trigger: "A趋势·实时" },
      ],
    }),
  };
  const cycle = await runMarketSignalsCycle({ env: {}, nowMs, alerts, signals, client });
  assert.equal(cycle.filled, 1);
  assert.equal(cycle.pushed, 1);
  assert.deepEqual(calls[0], ["AUSDT", "15m"], "short triggers are ignored");
  assert.equal(signals.readAfter(0, 10).length, 1);
  // A second cycle does not duplicate the signal or the push.
  const again = await runMarketSignalsCycle({ env: {}, nowMs: nowMs + 5 * 60_000, alerts, signals, client });
  assert.equal(again.filled, 0);
  assert.equal(signals.readAfter(0, 10).length, 1);
  // A fill discovered late (e.g. after downtime) is recorded but not pushed.
  const late = openMarketSignalsStore(":memory:");
  const lateCycle = await runMarketSignalsCycle({ env: {}, nowMs: T + 3 * H, alerts, signals: late, client });
  assert.equal(lateCycle.filled, 1);
  assert.equal(lateCycle.pushed, 0);
  assert.equal(late.readAfter(0, 10).length, 0);
  late.close();
  signals.close();
}

// Positioning cycle: stores hourly points and records a coil watch once per cooldown.
{
  const signals = openMarketSignalsStore(":memory:");
  const hourNow = T + 3 * 60_000 + 60_000; // just after the settle delay
  const lastClosed = T - H;
  const klines = Array.from({ length: 26 }, (_, i) => {
    const t = lastClosed - (25 - i) * H;
    const c = i === 25 ? 1.01 : 1;
    return [t, "1", String(c), "1", String(c)];
  });
  const oi = Array.from({ length: 26 }, (_, i) => {
    const barOpen = lastClosed - (25 - i) * H;
    return { timestamp: barOpen + H, sumOpenInterestValue: String(i === 25 ? 140 : 100) };
  });
  const client = {
    async getKlinesSince(_symbol, interval) { return interval === "1h" ? klines : []; },
    async getHourlyOpenInterest() { return oi; },
    async getPremiumIndex() { return [{ symbol: "AUSDT", lastFundingRate: "0.0001" }]; },
    async getTickers24h() {
      return [
        { symbol: "AUSDT", quoteVolume: "9000000" },
        { symbol: "USDCUSDT", quoteVolume: "900000000" },
        { symbol: "TINYUSDT", quoteVolume: "1000" },
      ];
    },
  };
  const alerts = { getMarketAlertsSnapshot: () => ({ events: [] }) };
  const cycle = await runMarketSignalsCycle({ env: {}, nowMs: hourNow, alerts, signals, client });
  assert.equal(cycle.positioning.symbols, 1);
  assert.equal(cycle.positioning.coil, 1);
  assert.equal(cycle.positioning.volatile, 1);
  // Same hour again: skipped.
  const again = await runMarketSignalsCycle({ env: {}, nowMs: hourNow + 5 * 60_000, alerts, signals, client });
  assert.equal(again.positioning, null);
  signals.close();
}

// Delivery through Web Push: an enrolled device receives the pullback signal; one enrolled after the
// signal does not get it replayed.
{
  const { createECDH, randomBytes, randomUUID } = await import("node:crypto");
  const { openWebPushStore } = await import("./web-push-store.ts");
  const { createSignalsPushSource, runWebPushCycle } = await import("./web-push-worker.ts");
  const signals = openMarketSignalsStore(":memory:");
  const pushStore = openWebPushStore(":memory:");
  const nowMs = T + 10 * 60_000;
  const enroll = (enabledAtMs) => {
    const ec = createECDH("prime256v1");
    ec.generateKeys();
    pushStore.enrollDevice({
      subscription: { endpoint: `https://web.push.apple.com/${randomUUID()}`, keys: { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } },
      device: { deviceId: randomUUID(), deviceKey: randomBytes(32).toString("base64url") },
      baseline: { sources: { market: 0, news: 0 }, marketEpisodes: [], enabledAt: new Date(enabledAtMs).toISOString() },
      nowMs: enabledAtMs,
    });
  };
  try {
    enroll(T - H);
    enroll(T + 5 * 60_000);
    const pullback = { id: "pullback_long:AUSDT:push", kind: "pullback_long", symbol: "AUSDT", signalAt: new Date(T).toISOString(), refPrice: 1.144, detail: { stopPrice: 1.05, pre24hPct: 0, triggerAt: "t" }, outcome: null, pushed: false };
    signals.recordSignal(pullback, T, buildPullbackPushEvent(pullback, rules));
    const sent = [];
    const empty = { readAfter: () => [], getBaseline: () => ({ lastSequence: 0 }), revalidate: () => true };
    const result = await runWebPushCycle({
      pushStore,
      marketSource: empty,
      newsSource: empty,
      signalsSource: createSignalsPushSource(signals),
      sender: { send: async (_subscription, payload) => { sent.push(payload); return { kind: "accepted", statusCode: 201, retryAfterMs: null, errorCode: null }; } },
      nowMs,
      now: () => nowMs,
      owner: "signals-deliver",
    });
    assert.equal(result.signalsSent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].target, "/alerts");
    assert.equal(sent[0].title, "A 回调买点");
  } finally {
    signals.close();
    pushStore.close();
  }
}

// AI notes: grounded, neutral sentences only.
{
  const { cleanSignalNote } = await import("./market-signals-ai.ts");
  const input = JSON.stringify({ symbol: "A", detail: { pre24hPct: 3.2, pullbackPct: 12 } });
  assert.equal(cleanSignalNote("A 触发前 24h 仅涨 3.2%，随后回调 12%。", input), "A 触发前 24h 仅涨 3.2%，随后回调 12%。");
  assert.equal(cleanSignalNote("<think>x</think>\nA 回调 12% 后企稳", input), "A 回调 12% 后企稳");
  assert.equal(cleanSignalNote("A 回调 15%。", input), null, "invented number");
  assert.equal(cleanSignalNote("建议轻仓做多 A", input), null, "trading advice");
  assert.equal(cleanSignalNote("", input), null);
  assert.equal(cleanSignalNote("长".repeat(81), input), null);
}

// Legacy market pushes: longs are blocked, shorts pass unless BTC already fell hard.
{
  const { legacyMarketPushAllowed } = await import("./market-signals.ts");
  assert.equal(legacyMarketPushAllowed({ direction: "LONG", btc24hPct: 1, rules }), false);
  assert.equal(legacyMarketPushAllowed({ direction: "SHORT", btc24hPct: 0.5, rules }), true);
  assert.equal(legacyMarketPushAllowed({ direction: "SHORT", btc24hPct: -1.7, rules }), false);
  assert.equal(legacyMarketPushAllowed({ direction: "SHORT", btc24hPct: null, rules }), true);
}

// Notes are generated after recording, at most twice per signal, and never for volatility watches.
{
  const signals = openMarketSignalsStore(":memory:");
  const at = new Date(T).toISOString();
  signals.recordSignal({ id: "p1", kind: "pullback_long", symbol: "AUSDT", signalAt: at, refPrice: 1, detail: {}, outcome: null, pushed: false }, T, null);
  signals.recordSignal({ id: "v1", kind: "volatile_watch", symbol: "BUSDT", signalAt: at, refPrice: 1, detail: {}, outcome: null, pushed: false }, T, null);
  signals.recordSignal({ id: "c1", kind: "coil_watch", symbol: "CUSDT", signalAt: at, refPrice: 1, detail: {}, outcome: null, pushed: false }, T, null);
  const asked = [];
  let fail = true;
  const generateNote = async ({ context }) => {
    asked.push(context.signal.id);
    if (context.signal.id === "c1" && fail) throw new Error("boom");
    return `${context.signal.symbol} 说明`;
  };
  const client = { async getKlinesSince() { return []; }, async getHourlyOpenInterest() { return []; }, async getPremiumIndex() { return []; }, async getTickers24h() { return []; } };
  const alerts = { getMarketAlertsSnapshot: () => ({ events: [] }) };
  const first = await runMarketSignalsCycle({ env: {}, nowMs: T + H, alerts, signals, client, generateNote });
  assert.equal(first.notes, 1);
  assert.deepEqual(asked.sort(), ["c1", "p1"]);
  fail = false;
  const second = await runMarketSignalsCycle({ env: {}, nowMs: T + H + 300_000, alerts, signals, client, generateNote });
  assert.equal(second.notes, 1, "failed note retried once");
  const third = await runMarketSignalsCycle({ env: {}, nowMs: T + H + 600_000, alerts, signals, client, generateNote });
  assert.equal(third.notes, 0);
  const snap = readMarketSignalsSnapshot({ store: signals, nowMs: T + 2 * H, env: {} });
  assert.equal(snap.signals.find((s) => s.id === "p1").aiNote, "AUSDT 说明");
  assert.equal(snap.signals.find((s) => s.id === "c1").aiNote, "CUSDT 说明");
  assert.equal(snap.signals.find((s) => s.id === "v1").aiNote, null);
  const off = await runMarketSignalsCycle({ env: { MARKET_SIGNAL_AI_ENABLED: "false" }, nowMs: T + H, alerts, signals: openMarketSignalsStore(":memory:"), client, generateNote });
  assert.equal(off.notes, 0);
  signals.close();
}

// Symbol classes: refreshed from exchangeInfo at most every 6h; only non-crypto underlyings are exposed.
{
  const signals = openMarketSignalsStore(":memory:");
  let calls = 0;
  const client = {
    async getExchangeInfo() {
      calls += 1;
      return { symbols: [
        { symbol: "BTCUSDT", underlyingType: "COIN" },
        { symbol: "NVDAUSDT", underlyingType: "EQUITY" },
        { symbol: "0700USDT", underlyingType: "HK_EQUITY" },
        { symbol: "XAUUSDT", underlyingType: "COMMODITY" },
        { symbol: "BROKEN" },
      ] };
    },
    async getKlinesSince() { return []; }, async getHourlyOpenInterest() { return []; }, async getPremiumIndex() { return []; }, async getTickers24h() { return []; },
  };
  const alerts = { getMarketAlertsSnapshot: () => ({ events: [] }) };
  await runMarketSignalsCycle({ env: { MARKET_SIGNAL_AI_ENABLED: "false" }, nowMs: T, alerts, signals, client });
  assert.deepEqual(signals.readSymbolClasses(), { NVDAUSDT: "EQUITY", "0700USDT": "HK_EQUITY", XAUUSDT: "COMMODITY" });
  await runMarketSignalsCycle({ env: { MARKET_SIGNAL_AI_ENABLED: "false" }, nowMs: T + H, alerts, signals, client });
  assert.equal(calls, 1, "not refreshed within 6h");
  await runMarketSignalsCycle({ env: { MARKET_SIGNAL_AI_ENABLED: "false" }, nowMs: T + 7 * H, alerts, signals, client });
  assert.equal(calls, 2);
  assert.equal(readMarketSignalsSnapshot({ store: signals, nowMs: T, env: {} }).symbolClasses.NVDAUSDT, "EQUITY");
  signals.close();
}

console.log("market-signals tests passed");
