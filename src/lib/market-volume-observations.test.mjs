import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { startVolatilityWebSocketWorker } from "./market-alerts-binance.ts";

const minute = 60_000;
const base = Math.floor(Date.now() / minute) * minute - 210 * minute;
const at = (i) => base + i * minute;
const closeTime = (i) => at(i + 1);
const bar = (i, quoteVolume = 10_000, symbol = "BTCUSDT", observeVolume = true) => ({
  symbol, at: at(i), open: 100, high: 102, low: 99, close: 101, quoteVolume, observeVolume,
});
const run = (length, fn) => Array.from({ length }, (_, i) => fn(i));

const dir = mkdtempSync(join(tmpdir(), "board-minutes-"));
const path = join(dir, "market.sqlite");
let store = openMarketAlertsStore(path);
try {
  const revision = store.getMarketAlertsRevision();
  const seed = run(20, (i) => bar(i, i < 10 ? 8_000 : 12_000));
  store.recordCardMinutes(seed, closeTime(19));
  assert.equal(store.getMarketAlertsRevision(), revision);
  store.recordCardMinutes([bar(20, 50_000), bar(21, 59_999), bar(22, 66_000)], closeTime(22));
  // The 21st minute has prior median 10k, the 22nd and 23rd have median 12k.
  const episode = { symbol: "BTCUSDT", firstAt: closeTime(20), firstPrice: 101,
    firstRatio: 5, firstQuoteVolume: 50_000, lastAt: closeTime(22), count: 2 };
  assert.deepEqual(store.listVolumeEpisodes(0, closeTime(20) - 1), []);
  assert.deepEqual(store.listVolumeEpisodes(closeTime(22), closeTime(22)), [episode]);
  assert.deepEqual(store.listVolumeEpisodes(0, closeTime(21)), [{ ...episode, lastAt: closeTime(20), count: 1 }]);
  const after = store.getMarketAlertsRevision();
  assert.ok(after > revision);
  store.close();
  store = openMarketAlertsStore(path);
  store.recordCardMinutes([...seed, bar(20, 99_000), bar(22, 66_000)], closeTime(22));
  assert.equal(store.getMarketAlertsRevision(), after, "duplicate closes survive worker restart");
  assert.deepEqual(store.listVolumeEpisodes(0, closeTime(22)), [episode]);
  const mixed = ["GAPUSDT", "TRADUSDT", "XUSDC", "ZEROUSDT", "THINUSDT"].flatMap((s) =>
    run(21, (i) => bar(i, i === 20 ? (s === "THINUSDT" ? 49_999 : 60_000) : s === "ZEROUSDT" ? 0 : 2_000, s, s !== "TRADUSDT"))
      .filter((b) => !(s === "GAPUSDT" && b.at === at(11))));
  store.recordCardMinutes(mixed, closeTime(20));
  assert.deepEqual(store.listVolumeEpisodes(0, closeTime(22)), [episode]);
  store.recordCardMinutes([bar(11, 2000, "GAPUSDT")], closeTime(22));
  assert.equal(store.listVolumeEpisodes(0, closeTime(22)).find((e) => e.symbol === "GAPUSDT").firstRatio, 30);
  store.recordCardMinutes(run(22, (i) => bar(119 + i, i >= 20 ? 60_000 : 10_000)), closeTime(140));
  const split = store.listVolumeEpisodes(at(139), closeTime(140));
  assert.deepEqual(split.map((e) => [e.firstAt, e.lastAt, e.count]), [
    [closeTime(140), closeTime(140), 1], [closeTime(20), closeTime(139), 3],
  ]);
  store.recordCardMinutes(run(61, (i) => bar(140 + i, 10_000, "AAPLUSDT", false)), closeTime(200));
  const cards = store.getCardCandles(["AAPLUSDT"], closeTime(200));
  assert.equal(cards.AAPLUSDT.length, 60);
  assert.deepEqual(cards.AAPLUSDT[0], { at: at(141), open: 100, high: 102, low: 99, close: 101 });
  assert.equal(cards.AAPLUSDT.at(-1).at, at(200));
  assert.equal(store.getMarketAlertsSnapshot({ limit: 10 }).events.length, 0);
  store.recordLiquidationCoverage(at(2), at(4));
  store.recordLiquidationCoverage(at(3), at(4));
  const db = new DatabaseSync(path);
  try {
    assert.deepEqual(db.prepare("SELECT minute_at FROM market_liquidation_coverage ORDER BY minute_at").all().map(r => r.minute_at), [at(2), at(3)]);
    store.pruneMarketAlertsRetention(at(200) + 31 * 86_400_000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM market_liquidation_coverage").get().n, 0);
    assert.deepEqual(store.listVolumeEpisodes(0, at(201)), []);
    assert.deepEqual(store.getCardCandles(["AAPLUSDT"], closeTime(200)).AAPLUSDT ?? [], []);
  } finally { db.close(); }
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}

const wsDir = mkdtempSync(join(tmpdir(), "board-ws-minutes-"));
const wsPath = join(wsDir, "market.sqlite");
const wsStore = openMarketAlertsStore(wsPath);
const realNow = Date.now;
let wall = at(180) + 123;
try {
  Date.now = () => wall;
  let socket;
  let usedUrl;
  const requests = [];
  wsStore.insertMarketAlertEvent({
    type: "short_squeeze", symbol: "AAPLUSDT", side: "LONG", level: 1, stage: "initial", trigger: "test",
    source: "squeeze", price: 101, changePct: null, volumeRatio: null, score: null, metrics: {}, reasons: [],
    occurredAt: new Date(at(179)).toISOString(),
  });
  let releaseSeed;
  const gate = new Promise(resolve => { releaseSeed = resolve; });
  const row = (i, quote) => [at(i), "100", "102", "99", "101", "10", closeTime(i) - 1, String(quote)];
  const controller = new AbortController();
  const job = startVolatilityWebSocketWorker({
    client: {
      getExchangeInfo: async () => ({ symbols: ["BTC", "AAPL"].map((baseAsset) => ({
        symbol: baseAsset + "USDT", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL",
        baseAsset, underlyingType: baseAsset === "BTC" ? "COIN" : "EQUITY",
      })) }),
      getTickers24h: async () => [{ symbol: "BTCUSDT", lastPrice: "101", quoteVolume: "99999" }, { symbol: "AAPLUSDT", lastPrice: "101", quoteVolume: "999" }],
      getKlines: async (symbol, interval) => {
        requests.push([symbol, interval]);
        await gate;
        return interval === "1m" ? [...run(60, (i) => row(120 + i, 10_000)), row(180, 999_999)] : [];
      },
    },
    store: wsStore, config: { wsTopN: 1, wsRankRefreshMs: 20_000 }, signal: controller.signal,
    createWebSocket(url) {
      usedUrl = url;
      socket = new EventTarget();
      socket.close = (code, reason) => socket.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
      return socket;
    },
    deliverAlert: async () => assert.fail("a volume observation issued a delivery"),
  });
  while (!socket) await new Promise(resolve => setImmediate(resolve));
  socket.dispatchEvent(new Event("open"));
  // REST began before this minute closed. Its stale partial must not overwrite the final WS price or volume.
  const send = (symbol, i, q, closed) => {
    const data = JSON.stringify({ stream: symbol.toLowerCase() + "@kline_1m", data: { s: symbol, k: {
      t: at(i), T: closeTime(i) - 1, o: "100", h: "102", l: "99", c: "101", v: "10", q: String(q), x: closed,
    } } });
    socket.dispatchEvent(Object.assign(new Event("message"), { data }));
  };
  wall = at(184) + 100;
  send("BTCUSDT", 180, 50_000, true);
  send("BTCUSDT", 181, 10_000, true);
  send("BTCUSDT", 182, 90_000, false);
  send("AAPLUSDT", 180, 65_000, true);
  releaseSeed();
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await job;
  const streams = new URL(usedUrl).searchParams.get("streams").split("/");
  assert.deepEqual(streams.filter(s => s.startsWith("aaplusdt")), ["aaplusdt@kline_1m"]);
  assert.deepEqual(requests.filter(([symbol]) => symbol === "AAPLUSDT"), [["AAPLUSDT", "1m"]]);
  assert.deepEqual(wsStore.listVolumeEpisodes(0, wall).map(e => [e.symbol, e.firstRatio, e.count]), [["BTCUSDT", 5, 1]]);
  assert.deepEqual(wsStore.getCardCandles(["BTCUSDT"], wall).BTCUSDT.slice(-2).map(c => c.at), [at(180), at(181)]);
  assert.equal(wsStore.getCardCandles(["AAPLUSDT"], wall).AAPLUSDT.at(-1).at, at(180));
  const reader = new DatabaseSync(wsPath);
  try {
    assert.deepEqual(reader.prepare("SELECT minute_at FROM market_liquidation_coverage ORDER BY minute_at").all().map(r => r.minute_at), [at(181), at(182), at(183)]);
  } finally { reader.close(); }

  // A transport error ends coverage immediately. A delayed close on the old socket must never
  // claim offline minutes or close a full minute on a newly connected socket.
  async function disconnect(atOpen, atError, atClose, rejectCoverage = false) {
    let transport;
    wall = atOpen;
    const failingStore = rejectCoverage ? new Proxy(wsStore, {
      get(target, key) {
        if (key === "recordLiquidationCoverage") return () => { throw new Error("coverage write failed"); };
        return Reflect.get(target, key);
      },
    }) : wsStore;
    const runWorker = startVolatilityWebSocketWorker({
      store: failingStore, config: { wsRankRefreshMs: 20_000 },
      client: { getExchangeInfo: async () => ({ symbols: [] }), getTickers24h: async () => [], getKlines: async () => [] },
      createWebSocket() {
        transport = new EventTarget();
        transport.close = () => {};
        return transport;
      },
    });
    while (!transport) await new Promise(resolve => setImmediate(resolve));
    transport.dispatchEvent(new Event("open"));
    wall = atError;
    transport.dispatchEvent(new Event("error"));
    await assert.rejects(runWorker, /connection failed|coverage write failed/);
    wall = atClose;
    transport.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "" }));
  }
  await disconnect(at(184) + 800, at(186) + 200, at(190));
  await disconnect(at(190) + 900, at(192) + 250, at(194), true);
  const coverageReader = new DatabaseSync(wsPath);
  try {
    assert.deepEqual(coverageReader.prepare("SELECT minute_at FROM market_liquidation_coverage ORDER BY minute_at").all().map(r => r.minute_at),
      [at(181), at(182), at(183), at(185)]);
  } finally { coverageReader.close(); }
} finally {
  Date.now = realNow;
  wsStore.close();
  rmSync(wsDir, { recursive: true, force: true });
}
console.log("ok - closed minute candles, volume episodes and liquidation stream coverage");
