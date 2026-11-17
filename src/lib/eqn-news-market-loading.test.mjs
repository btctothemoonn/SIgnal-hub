import assert from "node:assert/strict";
import { createEqnMarketClient } from "./eqn-news-market.ts";

const step = 300_000;
let now = Math.floor(Date.now() / step) * step + 20_000;
const requests = [];
let failCandles = false;
const bar = (time, close = 101) => [time, "100", "110", "90", String(close), "4"];
const market = createEqnMarketClient({
  now: () => now,
  sleep: async () => {},
  rateLimit: null,
  valuations: () => ({ marketCap: 42, fdv: 84 }),
  fetch: async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("exchangeInfo")) return Response.json({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] });
    if (url.pathname.endsWith("klines")) {
      if (failCandles) return new Response(null, { status: 503 });
      const start = Number(url.searchParams.get("startTime"));
      const end = Number(url.searchParams.get("endTime"));
      const rows = [];
      for (let time = Math.ceil(start / step) * step; time <= end; time += step) rows.push(bar(time, time === Math.floor(now / step) * step ? 102 : 101));
      return Response.json(rows);
    }
    if (url.pathname.endsWith("24hr")) return Response.json({ lastPrice: "102", priceChangePercent: "2", quoteVolume: "1000" });
    if (url.pathname.endsWith("premiumIndex")) return Response.json({ lastFundingRate: "0.0001" });
    if (url.pathname.endsWith("openInterest")) return Response.json({ openInterest: "12" });
    throw new Error(`Unexpected ${url}`);
  },
});
const request = { symbol: "BTC", venue: "binance", interval: "5m" };
const chart = await market.getMarket(request, "chart");
assert.equal(chart.error, null);
assert.equal(chart.candles.length, 500);
assert.equal(chart.price, 102);
assert.deepEqual(requests.map((url) => url.pathname.split("/").at(-1)), ["exchangeInfo", "klines"], "chart loading makes no statistics requests");
assert.equal(chart.fundingRate, null);
const count = requests.length;
const stats = await market.getMarket(request, "stats");
assert.equal(stats.error, null);
assert.deepEqual(stats.candles, [], "statistics never re-fetch candle history");
assert.equal(stats.openInterest, 12 * 102);
assert.equal(stats.marketCap, 42);
assert.equal(requests.slice(count).some((url) => url.pathname.endsWith("klines")), false);
now += 20_000;
const sameBar = await market.getMarket(request, "chart");
assert.equal(sameBar.candles.length, 500);
let lastRequest = requests.filter((url) => url.pathname.endsWith("klines")).at(-1);
assert.equal(Number(lastRequest.searchParams.get("startTime")), chart.candles.at(-1).time * 1000);
assert.ok(Number(lastRequest.searchParams.get("limit")) <= 2, "only the mutable tail is fetched");
now += 3 * step;
const resumed = await market.getMarket(request, "chart");
assert.equal(resumed.candles.length, 500);
lastRequest = requests.filter((url) => url.pathname.endsWith("klines")).at(-1);
assert.equal(Number(lastRequest.searchParams.get("startTime")), sameBar.candles.at(-1).time * 1000, "reconnect fills every missing candle");
assert.ok(Number(lastRequest.searchParams.get("limit")) <= 5);
assert.ok(resumed.candles.every((candle, index, bars) => index === 0 || candle.time === bars[index - 1].time + step / 1000));
now += 501 * step;
const longGap = await market.getMarket(request, "chart");
assert.equal(longGap.candles.length, 500);
lastRequest = requests.filter((url) => url.pathname.endsWith("klines")).at(-1);
assert.equal(Number(lastRequest.searchParams.get("limit")), 500, "long absences rebuild the bounded window");
now += 20_000;
failCandles = true;
const failed = await market.getMarket(request, "chart");
assert.match(failed.error, /Partial\/stale/);
assert.deepEqual(failed.candles, longGap.candles);
assert.equal(failed.fetchedAt, longGap.fetchedAt, "failed updates retain the original freshness timestamp");
console.log("eqn chart/stats separation, incremental tail, gaps, retention and failed refresh passed");

let releaseBackground;
let markBackground;
const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
const backgroundStarted = new Promise(resolve => { markBackground = resolve; });
const priority = createEqnMarketClient({
  now: () => now,
  valuations: () => ({ marketCap: null, fdv: null }),
  rateLimit: { reserve: (_now, interactive) => interactive ? 0 : 9000, defer() {} },
  sleep: async ms => { if (ms === 9000) { markBackground(); await backgroundGate; } },
  fetch: async input => {
    if (String(input).includes("exchangeInfo")) return Response.json({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] });
    if (String(input).includes("klines")) return Response.json([bar(Math.floor(now / step) * step)]);
    return Response.json({ lastPrice: "101", lastFundingRate: ".0001", openInterest: "12" });
  },
});
const full = priority.getMarket(request);
await backgroundStarted;
let timer;
try {
  const chart = await Promise.race([
    priority.getMarket({ ...request, interval: "15m" }, "chart"),
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("interactive chart waited behind background reservation")), 200); }),
  ]);
  assert.equal(chart.error, null);
  assert.ok(chart.candles.length);
} finally {
  clearTimeout(timer);
  releaseBackground();
  await full;
}

const statsClient = createEqnMarketClient({
  now: () => now, rateLimit: null, sleep: async () => {}, optionalWaitMs: 1,
  valuations: () => ({ marketCap: null, fdv: null }),
  fetch: async input => {
    if (String(input).includes("exchangeInfo")) return Response.json({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] });
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ lastPrice: "101", lastFundingRate: ".0001", openInterest: "12" });
  },
});
const completedStats = await statsClient.getMarket(request, "stats");
assert.equal(completedStats.fundingRate, .0001);
assert.equal(completedStats.openInterest, 1212, "separate stats response waits for its own data after the chart is already visible");
console.log("interactive charts bypass waiting background reservations; separate stats return late metrics");
