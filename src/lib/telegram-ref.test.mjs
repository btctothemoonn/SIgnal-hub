import assert from "node:assert/strict";
import { normalizeTelegramRefKey } from "./telegram-ref.ts";

assert.equal(normalizeTelegramRefKey("@MMSnews"), "mmsnews");
assert.equal(normalizeTelegramRefKey("https://t.me/wxjdqtg"), "wxjdqtg");
assert.equal(normalizeTelegramRefKey("https://t.me/BWEtradfi/123"), "bwetradfi");
assert.equal(normalizeTelegramRefKey("t.me/TreeNewsFeed"), "treenewsfeed");

console.log("ok - telegram refs normalize to stable keys");
