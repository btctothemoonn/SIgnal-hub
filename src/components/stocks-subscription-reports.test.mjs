import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./stocks-subscription-reports.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /订阅研报|璁㈤槄鐮旀姤/);
assert.match(source, /Patreon \/ bboczeng/);
assert.match(source, /reports\.map/);
assert.match(source, /buildSubscriptionReportInsight/);
assert.match(source, /coreConclusion/);
assert.match(source, /impactChain/);
assert.match(source, /riskNote/);
assert.match(source, /fallbackUsed/);
assert.match(source, /report\.tickers\.map/);
assert.match(source, /onSelectTicker\?\.\(ticker\)/);
assert.match(source, /expandedReportId/);
assert.match(source, /report\.fullSummary/);
assert.match(source, /核心结论/);
assert.match(source, /影响链条/);
assert.match(source, /风险点/);
assert.match(source, /总结未生成/);
assert.match(source, /aria-expanded/);
assert.match(source, /展开总结|灞曞紑鎬荤粨/);
assert.match(source, /收起|鏀惰捣/);
assert.match(source, /打开原文|鎵撳紑鍘熸枃/);
assert.match(source, /暂无订阅研报|鏆傛棤璁㈤槄鐮旀姤/);

console.log("ok - stocks subscription reports component");
