import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEqnNewsDetail } from "./eqn-news-detail.ts";
import { normalizeEqnNews } from "./eqn-news-core.ts";
import { openEqnNewsStore } from "./eqn-news-store.ts";

const dir = mkdtempSync(join(tmpdir(), "eqn-news-detail-"));
const store = openEqnNewsStore(join(dir, "news.sqlite"));
const published = Math.floor(Date.now() / 60000) * 60000 - 10 * 60000;
const now = published + 6 * 60000;
process.env.TWITTER_SNAPSHOT_CACHE_FILE = join(dir, "twitter.json");
process.env.TELEGRAM_SNAPSHOT_CACHE_FILE = join(dir, "absent.json");
process.env.MARKET_ALERTS_DB = join(dir, "absent.sqlite");
process.env.MARKET_SIGNALS_DB = join(dir, "absent-signals.sqlite");
writeFileSync(process.env.TWITTER_SNAPSHOT_CACHE_FILE, JSON.stringify({ snapshot: { feed: [
  { text: "$BTC signal", createdAt: new Date(published).toISOString(), tweetUrl: "https://x.com/a/status/1" },
  { text: "$ETH signal", createdAt: new Date(published).toISOString(), tweetUrl: "https://x.com/a/status/2" },
] } }));
const put = (no, coins) => store.upsert(normalizeEqnNews({ no, time: new Date(published).toISOString(), zh: `news ${no}`, source: "test", channels: ["main"], coins }, "mcp"));
put(1, ["BTC", "ETH"]); put(2, ["BTC"]); put(3, ["ETH"]);
const requests = [];
let available = true;
const market = {
  resolve: async (request) => { requests.push({ type: "resolve", ...request }); return available ? { symbol: request.symbol, pair: request.venue === "binance" ? `${request.symbol}USDT` : request.symbol, multiplier: 1 } : null; },
  getCandles: async (request) => {
    requests.push({ type: "candles", ...request });
    return [0, 1, 5].map((minute) => ({ time: published + minute * 60000, open: request.symbol === "ETH" ? 200 + minute * 2 : 100 + minute * 10, high: 500, low: 1, close: 200, volume: 1 }));
  },
};
try {
  const selected = await getEqnNewsDetail("1", { store, market, now, coin: "ETH", venue: "hyperliquid" });
  assert.deepEqual(selected.relatedNews.map((item) => item.id), ["3"], "related news is scoped to the selected second coin");
  assert.deepEqual(requests.map((request) => [request.symbol, request.venue]), [["ETH", "hyperliquid"], ["ETH", "hyperliquid"]]);
  assert.equal(selected.reactions[0].change, (202 / 200 - 1) * 100);
  assert.equal(selected.reactions.find((reaction) => reaction.minutes === 15).change, null);
  assert.deepEqual(selected.signals.map((signal) => signal.title), ["$ETH signal"], "signals cannot come from another news coin");
  requests.length = 0;
  const unknown = await getEqnNewsDetail("1", { store, market, now, coin: "SOL", venue: "hyperliquid" });
  assert.ok(unknown.reactions.every((reaction) => reaction.change === null));
  assert.deepEqual(unknown.relatedNews, []);
  assert.deepEqual(unknown.signals, []);
  assert.equal(requests.length, 0, "unknown coin never resolves or fetches another asset");
  available = false;
  const unavailable = await getEqnNewsDetail("1", { store, market, now, coin: "ETH", venue: "hyperliquid" });
  assert.ok(unavailable.reactions.every((reaction) => reaction.change === null));
  assert.deepEqual(requests.map((request) => request.venue), ["hyperliquid"], "no silent Binance fallback");
  requests.length = 0; available = true;
  const defaults = await getEqnNewsDetail("1", { store, market, now });
  assert.deepEqual(requests.map((request) => [request.symbol, request.venue]), [["BTC", "binance"], ["BTC", "binance"]]);
  assert.deepEqual(defaults.relatedNews.map((item) => item.id).sort(), ["2", "3"]);
  assert.equal(defaults.reactions[0].change, (110 / 100 - 1) * 100);
  assert.equal(defaults.signals.length, 2, "no-query default preserves all-coin related signals");
  console.log("eqn-news detail selected coin, Hyperliquid, pending windows and backward compatibility tests passed");
} finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
