import assert from "node:assert/strict";

const { formatXHybridBackfillStatus } = await import("./x-hybrid-backfill-status.ts");

assert.equal(
  formatXHybridBackfillStatus({
    checked: 13,
    parsed: 13,
    selected: 0,
    enriched: 0,
    failed: 0,
    pointsReserved: 0,
    quotedResolved: 0,
    primaryRefreshes: 0,
    skippedAfter985Refresh: 0,
    skippedAlreadyProcessed: 13,
    skippedAlreadyIn985: 0,
    pendingGrace: 0,
    skippedNotConfigured: 0,
    skippedNoTweetId: 0,
  }),
  "6551 补漏完成：最近 24 小时检查 13 条，暂无需要调用 6551 的遗漏；13 条此前已处理，消耗 0 points",
);

assert.equal(
  formatXHybridBackfillStatus({
    checked: 20,
    parsed: 10,
    selected: 2,
    enriched: 1,
    failed: 1,
    pointsReserved: 3,
    quotedResolved: 1,
    primaryRefreshes: 1,
    skippedAfter985Refresh: 4,
    skippedAlreadyProcessed: 2,
    skippedAlreadyIn985: 4,
    pendingGrace: 1,
    skippedNotConfigured: 0,
    skippedNoTweetId: 0,
  }),
  "6551 补漏完成：补入 1/2 条，消耗 3 points，985 已预刷新，不扣 points，985 已收进来 4 条，引用 1 条，失败 1 条",
);

console.log("ok - x hybrid backfill status explains zero-candidate runs");
