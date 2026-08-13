import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import { buildStocksTodayChanges } from "./stocks-changes.ts";

const nvda = getAlphaResearchStockByTicker("NVDA");
const amd = getAlphaResearchStockByTicker("AMD");
const arm = getAlphaResearchStockByTicker("ARM");
const intel = getAlphaResearchStockByTicker("INTC");
assert.ok(nvda && amd && arm && intel);

const catalystSentinelStock = {
  ...nvda,
  market: {
    ...nvda.market,
    source: "live",
    dayChangePct: 4.8,
    sevenDayChangePct: 6.2,
    earningsStatus: "quiet",
  },
};
Object.defineProperty(catalystSentinelStock, "catalysts", {
  get() {
    throw new Error("today changes must not read catalysts");
  },
});

const changes = buildStocksTodayChanges([
  catalystSentinelStock,
  {
    ...amd,
    market: {
      ...amd.market,
      source: "live",
      dayChangePct: -6.4,
      sevenDayChangePct: -8.1,
      earningsStatus: "quiet",
    },
    catalysts: [
      {
        title: "HISTORICAL_CATALYST_MUST_NOT_RENDER",
        type: "earnings",
        date: "2026-07-24",
        impact: "negative",
        summary: "old item",
      },
    ],
  },
  {
    ...arm,
    market: {
      ...arm.market,
      source: "live",
      dayChangePct: 0.8,
      sevenDayChangePct: -12.3,
      earningsStatus: "upcoming",
    },
    catalysts: [],
  },
  {
    ...intel,
    market: {
      ...intel.market,
      source: "mock",
      dayChangePct: 8.2,
      sevenDayChangePct: -12.4,
      earningsStatus: "upcoming",
    },
    catalysts: [],
  },
]);

assert.deepEqual(
  changes.map((item) => item.ticker),
  ["AMD", "NVDA", "ARM"],
);
assert.equal(changes.length, new Set(changes.map((item) => item.ticker)).size);
assert.ok(changes.every((item) => !("kind" in item)));
assert.equal(changes.find((item) => item.ticker === "NVDA")?.tone, "positive");
assert.equal(changes.find((item) => item.ticker === "AMD")?.tone, "negative");
assert.equal(changes.find((item) => item.ticker === "ARM")?.tone, "negative");
assert.match(changes.find((item) => item.ticker === "AMD")?.title ?? "", /下跌/);
assert.match(changes.find((item) => item.ticker === "ARM")?.title ?? "", /走弱/);
assert.ok(
  changes.every(
    (item) =>
      !`${item.title} ${item.detail}`.includes(
        "HISTORICAL_CATALYST_MUST_NOT_RENDER",
      ),
  ),
);
assert.ok(changes.every((item) => item.ticker !== "INTC"));

const source = readFileSync(new URL("./stocks-changes.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /StocksTodayChangeKind/);
assert.doesNotMatch(source, /stock\.catalysts/);
assert.doesNotMatch(source, /catalystWindowHours/);
assert.doesNotMatch(source, /catalystChange/);
assert.doesNotMatch(source, /earningsChange/);
assert.doesNotMatch(source, /recentTimestamp/);

console.log("ok - stocks today changes are market moves only");
