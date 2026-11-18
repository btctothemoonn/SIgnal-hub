import assert from "node:assert/strict";
import { parseNewsMarketSymbol } from "./news-terminal-client.ts";

assert.equal(parseNewsMarketSymbol(" solusdt "), "SOL");
assert.equal(parseNewsMarketSymbol("1000PEPEUSDT"), "1000PEPE");
assert.equal(parseNewsMarketSymbol("eth"), "ETH");
assert.equal(parseNewsMarketSymbol(["SOL", "ETH"]), undefined);
assert.equal(parseNewsMarketSymbol("SOL/USDT"), undefined);
import {
  mergeNewsItems,
  chartNewsMarkers,
  formatNewsPrice,
  tradeConfirmationKey,
  newsPriceMinMove,
  newsExecutionSymbol,
  normalizeNewsOrder,
} from "./news-terminal-client.ts";

const item = (id, ts) => ({ id, publishedAt: ts });
assert.deepEqual(
  mergeNewsItems([item("old", 10)], [item("new", 20), item("old", 10)]).map(
    (x) => x.id,
  ),
  ["new", "old"],
);
assert.equal(
  mergeNewsItems(
    [],
    Array.from({ length: 600 }, (_, i) => item(String(i), i)),
  ).length,
  500,
);
assert.deepEqual(
  chartNewsMarkers(
    [
      { ...item("1", 1700000040000), score: 80, coins: [{ symbol: "BTC" }] },
      { ...item("2", 1700000050000), score: 90, coins: [{ symbol: "BTC" }] },
      { ...item("3", 1700000050000), score: 50, coins: [{ symbol: "BTC" }] },
    ],
    "BTC",
    [{ time: 1700000000 }, { time: 1700000060 }],
  ).map((m) => ({ time: m.time, text: m.text })),
  [{ time: 1700000000, text: "新闻 ×2" }],
);
assert.equal(formatNewsPrice(null), "--");
assert.equal(formatNewsPrice(0.00000123), "0.00000123");
assert.equal(newsPriceMinMove(150), .001);
assert.equal(newsPriceMinMove(.00000123), 1e-10);
assert.equal(newsExecutionSymbol("1000PEPEUSDT", "binance"), "1000PEPE");
assert.equal(newsExecutionSymbol("kPEPE", "hyperliquid"), "kPEPE");
const close = normalizeNewsOrder({ type: "market", reduceOnly: true, limitPrice: 1, stopLossPct: 3, takeProfitPct: 5 });
assert.equal(close.limitPrice, undefined);
assert.equal(close.stopLossPct, undefined);
assert.equal(close.takeProfitPct, undefined);
assert.notEqual(
  tradeConfirmationKey({
    venue: "binance",
    symbol: "BTC",
    side: "buy",
    notional: 200,
  }),
  tradeConfirmationKey({
    venue: "hyperliquid",
    symbol: "BTC",
    side: "buy",
    notional: 200,
  }),
);
assert.notEqual(
  tradeConfirmationKey({
    venue: "binance",
    symbol: "BTC",
    side: "buy",
    notional: 200,
  }),
  tradeConfirmationKey({
    venue: "binance",
    symbol: "BTC",
    side: "sell",
    notional: 200,
  }),
);
console.log(
  "ok - news client merge, candle markers, tiny prices and exact order confirmation",
);
