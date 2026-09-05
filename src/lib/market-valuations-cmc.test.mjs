import assert from "node:assert/strict";
import { fillCmcValuations } from "./market-valuations-cmc.ts";

const markets = [{ symbol: "ABCUSDT", price: 2 }];
const missing = [{ symbol: "ABCUSDT", marketCapUsd: null, fdvUsd: null }];
let calls = 0;
const coin = { symbol: "ABC", quote: [{ symbol: "USD", price: 2, market_cap: 100, fully_diluted_market_cap: 200 }] };
const fetchImpl = async (url, options) => {
  calls++;
  assert.equal(new URL(url).searchParams.get("symbol"), "ABC");
  assert.equal(options.headers["X-CMC_PRO_API_KEY"], "test");
  return Response.json({ data: [coin], status: { error_code: 0 } });
};
assert.deepEqual(await fillCmcValuations(markets, missing, { apiKey: "", fetchImpl }), missing);
assert.equal(calls, 0);
assert.deepEqual(await fillCmcValuations(markets, missing, { apiKey: "test", fetchImpl }), [{ symbol: "ABCUSDT", marketCapUsd: 100, fdvUsd: 200 }]);
const partial = [{ symbol: "ABCUSDT", marketCapUsd: 90, fdvUsd: null }];
assert.equal((await fillCmcValuations(markets, partial, { apiKey: "test", fetchImpl }))[0].marketCapUsd, 90);
for (const data of [[coin, coin], [{ ...coin, quote: [{ ...coin.quote[0], price: 200 }] }]]) {
  assert.deepEqual(await fillCmcValuations(markets, missing, { apiKey: "test", fetchImpl: async () => Response.json({ data }) }), missing);
}
assert.deepEqual(await fillCmcValuations(markets, missing, { apiKey: "test", fetchImpl: async () => { throw new Error("offline"); } }), missing);
console.log("ok - CMC fallback preserves data and rejects ambiguous or mismatched assets");
