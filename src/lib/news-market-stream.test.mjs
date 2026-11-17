import assert from "node:assert/strict";
import { connectNewsCandles, mergeNewsCandles, parseNewsCandleMessage } from "./news-market-stream.ts";

const time = Math.floor(Date.now() / 300_000) * 300_000;
const binance = (overrides = {}) => JSON.stringify({ e: "kline", E: time + 1000, s: "1000PEPEUSDT", k: { s: "1000PEPEUSDT", i: "5m", t: time, o: "0.01", h: "0.02", l: "0.009", c: "0.015", v: "4", ...overrides } });
const parsed = parseNewsCandleMessage(binance(), "binance", "1000PEPEUSDT", "5m");
assert.equal(parsed.candle.time, time / 1000);
assert.equal(parsed.candle.close, 0.015, "native scaled contract prices are retained");
assert.equal(parseNewsCandleMessage(binance(), "binance", "PEPEUSDT", "5m"), null);
assert.equal(parseNewsCandleMessage(binance(), "binance", "1000PEPEUSDT", "1h"), null);
assert.equal(parseNewsCandleMessage(binance({ h: "0.001" }), "binance", "1000PEPEUSDT", "5m"), null);
assert.equal(parseNewsCandleMessage("bad", "binance", "1000PEPEUSDT", "5m"), null);
const hl = JSON.stringify({ channel: "candle", data: { s: "xyz:NVDA", i: "5m", t: time, o: "150", h: "155", l: "149", c: "154", v: "3" } });
assert.equal(parseNewsCandleMessage(hl, "hyperliquid", "xyz:NVDA", "5m").candle.close, 154);
assert.equal(parseNewsCandleMessage(hl, "hyperliquid", "NVDA", "5m"), null);
const oldBar = { ...parsed.candle, time: time / 1000 - 300 };
const revised = { ...parsed.candle, close: 0.016 };
assert.deepEqual(mergeNewsCandles([oldBar, parsed.candle], [revised]), [oldBar, revised]);
assert.equal(mergeNewsCandles(Array.from({ length: 600 }, (_, i) => ({ ...oldBar, time: i })), []).length, 500);

const realTimeout = globalThis.setTimeout;
const realInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (fn) => { timers.set(++timerId, fn); return timerId; };
globalThis.setInterval = (fn) => { timers.set(++timerId, fn); return timerId; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => timers.delete(id);
try {
  const sockets = [];
  const states = [];
  const candles = [];
  let reconnects = 0;
  function createSocket(url) {
    const socket = { url, readyState: 1, closed: false, sent: [], send(data) { this.sent.push(JSON.parse(data)); }, close() { this.closed = true; } };
    sockets.push(socket);
    return socket;
  }
  const stop = connectNewsCandles({ venue: "binance", pair: "1000PEPEUSDT", interval: "5m", createSocket,
    onState: (live) => states.push(live), onCandle: (candle) => candles.push(candle), onReconnect: () => reconnects++ });
  assert.match(sockets[0].url, /\/market\/ws\/1000pepeusdt@kline_5m$/);
  sockets[0].onopen();
  sockets[0].onmessage({ data: binance() });
  sockets[0].onmessage({ data: JSON.stringify({ e: "kline", E: time + 500, s: "1000PEPEUSDT", k: JSON.parse(binance({ c: "0.014" })).k }) });
  assert.equal(candles.length, 1, "older events cannot roll the current candle back");
  assert.equal(states.at(-1), true);
  sockets[0].onclose();
  assert.equal(states.at(-1), false);
  assert.equal(sockets[0].closed, true);
  const [retry, callback] = [...timers.entries()].at(-1);
  timers.delete(retry);
  callback();
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.equal(reconnects, 1, "reconnect requests a REST gap fill");
  const late = sockets[1].onmessage;
  stop();
  late({ data: binance({ c: "0.017" }) });
  assert.equal(candles.length, 1, "unsubscribed sockets cannot update another chart");
  assert.equal(sockets[1].closed, true);
  assert.equal(timers.size, 0, "all heartbeat and reconnect timers are released");
  const stopHl = connectNewsCandles({ venue: "hyperliquid", pair: "xyz:NVDA", interval: "5m", createSocket,
    onState: () => {}, onCandle: () => {}, onReconnect: () => {} });
  sockets.at(-1).onopen();
  assert.deepEqual(sockets.at(-1).sent[0], { method: "subscribe", subscription: { type: "candle", coin: "xyz:NVDA", interval: "5m" } });
  stopHl();
} finally {
  globalThis.setTimeout = realTimeout;
  globalThis.setInterval = realInterval;
  globalThis.clearTimeout = realClearTimeout;
  globalThis.clearInterval = realClearInterval;
}
console.log("news live candles: identity, intervals, scaled prices, ordering, reconnect and cleanup passed");
