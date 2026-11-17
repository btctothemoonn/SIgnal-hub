import assert from "node:assert/strict";
import { cacheNewsMarket, fetchNewsMarket, newsMarketKey, persistNewsMarkets, prefetchNewsMarket, readCachedNewsMarket } from "./news-market-client.ts";

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const stored = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } });
globalThis.document = { hidden: false };
const requests = [];
let release;
const gate = new Promise(resolve => { release = resolve; });
const candle = { time: 1, open: 100, high: 110, low: 90, close: 101, volume: 1 };
const fixture = symbol => ({ symbol, pair: `${symbol}USDT`, venue: "binance", tradable: true, price: 101, change24h: null, marketCap: null, fdv: null, volume24h: null, fundingRate: null, openInterest: null, candles: [candle], fetchedAt: Date.now(), error: null });
const selection = symbol => ({ symbol, venue: "binance", interval: "5m" });
try {
  stored.set("signal-hub:news-market-cache:v1", JSON.stringify([[newsMarketKey(selection("OLD")), fixture("OLD")]]));
  globalThis.fetch = async input => {
    const url = new URL(input, "http://localhost");
    requests.push(url);
    if (url.searchParams.get("symbol") === "SOL") await gate;
    return Response.json(fixture(url.searchParams.get("symbol")));
  };
  assert.equal(readCachedNewsMarket(selection("OLD")).symbol, "OLD");
  await fetchNewsMarket(selection("OLD"), "chart");
  assert.equal(requests.length, 1, "persisted display data always needs session verification");
  prefetchNewsMarket({ ...selection("SOL"), assetId: "solana" });
  prefetchNewsMarket({ ...selection("SOL"), assetId: "solana" });
  const selected = fetchNewsMarket({ ...selection("SOL"), assetId: "solana" }, "chart");
  assert.equal(requests.length, 2, "hover and click share the same in-flight request");
  assert.equal(requests.at(-1).searchParams.get("assetId"), "solana");
  release();
  await selected;
  await fetchNewsMarket({ ...selection("SOL"), assetId: "solana" }, "chart");
  assert.equal(requests.length, 2, "fresh preloaded candles need no duplicate HTTP request");
  await fetchNewsMarket({ ...selection("SOL"), assetId: "unrelated-asset" }, "chart");
  assert.equal(requests.length, 3, "same symbol with a different identity uses a separate cache entry");
  document.hidden = true;
  prefetchNewsMarket(selection("HIDDEN"));
  await Promise.resolve();
  assert.equal(requests.length, 3);
  for (let index = 0; index < 12; index++) cacheNewsMarket(selection(`S${index}`), fixture(`S${index}`));
  persistNewsMarkets();
  assert.equal(JSON.parse(stored.get("signal-hub:news-market-cache:v1")).length, 8);
  console.log("news chart cache, identity, prefetch deduplication, hidden-tab and persistence passed");
} finally {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
