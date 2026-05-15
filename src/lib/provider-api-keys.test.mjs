import assert from "node:assert/strict";
import {
  getProviderApiKeys,
  pickProviderApiKey,
} from "./provider-api-keys.ts";

const keys = getProviderApiKeys(
  {
    STOCKS_FMP_API_KEYS: " first , second\nthird;second ",
    STOCKS_FMP_API_KEY: "single",
  },
  ["STOCKS_FMP_API_KEYS", "STOCKS_FMP_API_KEY"],
);

assert.deepEqual(keys, ["first", "second", "third", "single"]);
assert.equal(pickProviderApiKey(keys, 0), "first");
assert.equal(pickProviderApiKey(keys, 3), "single");
assert.equal(pickProviderApiKey(keys, 4), "first");
assert.equal(pickProviderApiKey(keys, -1), "second");
assert.equal(pickProviderApiKey([], 0), "");

console.log("ok - provider api keys");
