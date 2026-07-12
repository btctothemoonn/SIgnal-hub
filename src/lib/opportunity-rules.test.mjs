import assert from "node:assert/strict";
import {
  clusterOpportunityItems,
  deriveOpportunityStatus,
  formatOpportunityDateKey,
  scoreOpportunityCandidate,
  selectDailyOpportunities,
  textJaccardSimilarity,
} from "./opportunity-rules.ts";

const base = {
  market: "us",
  assetKeys: ["NVDA"],
  eventType: "order",
  publishedAt: "2026-07-12T01:00:00.000Z",
  text: "NVDA supplier confirms a new AI accelerator order for Q3 delivery",
  translation: null,
  originalUrl: "https://example.com/a",
};

const sourceItem = (overrides = {}) => ({
  ...base,
  id: "news:default",
  sourceType: "news",
  sourceName: "wire",
  ...overrides,
});

const clustered = clusterOpportunityItems([
  { ...base, id: "x:1", sourceType: "x", sourceName: "analyst-a" },
  { ...base, id: "telegram:2", sourceType: "telegram", sourceName: "channel-b" },
]);
assert.equal(clustered.length, 1);
assert.equal(clustered[0].evidence.length, 2);

const score = scoreOpportunityCandidate(clustered[0], {
  priorityAssetKeys: new Set(["NVDA"]),
  marketReaction: { available: true, absoluteMovePercent: 1.2 },
  now: new Date("2026-07-12T02:00:00.000Z"),
});
assert.ok(score.ruleScore >= 75);

const selected = selectDailyOpportunities(
  [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      finalScore: 100 - index,
      dismissed: false,
    })),
    { id: "low-score", finalScore: 74, dismissed: false },
    { id: "dismissed", finalScore: 100, dismissed: true },
  ],
  10,
);
assert.equal(selected.length, 10);
assert.ok(selected.every((item) => item.id !== "low-score" && item.id !== "dismissed"));
assert.equal(deriveOpportunityStatus({ validUntil: "2026-07-11T00:00:00.000Z" }, new Date("2026-07-12T00:00:00.000Z")), "expired");
assert.equal(deriveOpportunityStatus({ independentSourceCount: 2, finalScore: 82, confidence: "medium" }), "tracking");
assert.equal(deriveOpportunityStatus({ independentSourceCount: 3, finalScore: 88, confidence: "high" }), "confirmed");

const atSixHours = clusterOpportunityItems([
  sourceItem({ id: "boundary:first", publishedAt: "2026-07-12T01:00:00.000Z" }),
  sourceItem({ id: "boundary:exact", publishedAt: "2026-07-12T07:00:00.000Z" }),
  sourceItem({ id: "boundary:over", publishedAt: "2026-07-12T07:00:00.001Z" }),
]);
assert.equal(atSixHours.length, 2);
assert.equal(atSixHours[0].evidence.length, 2);
assert.equal(atSixHours[1].evidence.length, 1);

const bridged = clusterOpportunityItems([
  sourceItem({
    id: "bridge:first",
    text: "NVDA order supplier delivery confirmed guidance",
    publishedAt: "2026-07-12T01:00:00.000Z",
  }),
  sourceItem({
    id: "bridge:middle",
    text: "NVDA order supplier delivery expansion capacity",
    publishedAt: "2026-07-12T02:00:00.000Z",
  }),
  sourceItem({
    id: "bridge:last",
    text: "NVDA order expansion capacity production forecast",
    publishedAt: "2026-07-12T03:00:00.000Z",
  }),
]);
assert.equal(bridged.length, 2);
assert.deepEqual(bridged.map((candidate) => candidate.evidence.map((item) => item.id)), [
  ["bridge:first", "bridge:middle"],
  ["bridge:last"],
]);

assert.equal(textJaccardSimilarity("NVDA confirms an order", "NVDA confirms an order"), 1);
assert.equal(textJaccardSimilarity("", "NVDA confirms an order"), 0);
assert.equal(formatOpportunityDateKey(new Date("2026-07-11T16:00:00.000Z")), "2026-07-12");
const shanghaiCandidate = clusterOpportunityItems([
  sourceItem({ id: "date:boundary", publishedAt: "2026-07-11T16:00:00.000Z" }),
])[0];
assert.ok(shanghaiCandidate.canonicalKey.startsWith("us:order:NVDA:2026-07-12:"));

console.log("ok - opportunity rules");
