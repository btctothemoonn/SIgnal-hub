import assert from "node:assert/strict";
import { parseAlphaSummaryContent } from "./alpha-summary.ts";

const summary = parseAlphaSummaryContent(JSON.stringify({
  headline: "科技股和 BTC 受到关注。",
  stocks: [{ target: "NVDA", opinions: [
    { author: "@alice", view: "需求增长，继续看好。" },
    { author: "@bob", view: "估值偏高，等待回调。" },
  ] }],
  crypto: [{ target: "BTC", opinions: [{ author: "频道 C", view: "关注资金流入。" }] }],
}));
assert.equal(summary.stocks[0].target, "NVDA");
assert.deepEqual(summary.stocks[0].opinions, [
  { author: "@alice", view: "需求增长，继续看好。" },
  { author: "@bob", view: "估值偏高，等待回调。" },
]);
assert.equal(summary.crypto[0].opinions[0].author, "频道 C");
const empty = parseAlphaSummaryContent('{"headline":"暂无标的观点","stocks":[],"crypto":[]}');
assert.deepEqual(empty.stocks, []);
assert.deepEqual(empty.crypto, []);
const merged = parseAlphaSummaryContent(JSON.stringify({
  headline: "观点合并",
  stocks: [
    { target: "NVDA", opinions: [{ author: "@alice", view: "看好需求" }] },
    { target: "NVDA", opinions: [{ author: "@alice", view: "等待财报" }, { author: "", view: "无来源" }] },
    { target: "", opinions: [{ author: "@bob", view: "无标的" }] },
  ],
  crypto: [],
}));
assert.deepEqual(merged.stocks, [{ target: "NVDA", opinions: [{ author: "@alice", view: "看好需求；等待财报" }] }]);
assert.throws(() => parseAlphaSummaryContent('{"headline":"invalid"}'));
const legacy = {
  headline: "旧结构包含作者观点",
  authors: [{ name: "@alice", sourceCount: 1, coreView: "看好 NVDA", alpha: [], watch: ["NVDA"] }],
  consensus: [],
  risks: [],
  watchlist: ["NVDA"],
};
assert.throws(
  () => parseAlphaSummaryContent(JSON.stringify(legacy)),
  /target groups/,
  "newly generated summaries must not accept hidden legacy author opinions",
);
for (const groups of [
  { stocks: [] },
  { crypto: [] },
  { stocks: [], crypto: {} },
  { stocks: null, crypto: [] },
]) {
  assert.throws(
    () => parseAlphaSummaryContent(JSON.stringify({ ...legacy, ...groups })),
    /target groups/,
    "both market categories must be arrays even when legacy authors are present",
  );
}
console.log("ok - target summaries preserve opinions and market categories");
