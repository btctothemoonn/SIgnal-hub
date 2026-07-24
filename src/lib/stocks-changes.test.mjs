import assert from "node:assert/strict";
import { getAlphaResearchStockByTicker } from "./alpha-research-pool.ts";
import { buildStocksTodayChanges } from "./stocks-changes.ts";

const now = new Date("2026-07-24T12:00:00.000Z");
const nvda = getAlphaResearchStockByTicker("NVDA");
const amd = getAlphaResearchStockByTicker("AMD");
const arm = getAlphaResearchStockByTicker("ARM");
const intel = getAlphaResearchStockByTicker("INTC");
assert.ok(nvda && amd && arm && intel);

const stocks = [
  {
    ...nvda,
    catalysts: [
      {
        title: "New Blackwell supply update",
        type: "supply-chain",
        date: "07/24 18:00",
        createdAt: "2026-07-24T10:00:00.000Z",
        impact: "positive",
        summary: "Supply expectations moved higher.",
        source: "Patreon",
        sourceRole: "subscription",
      },
    ],
  },
  {
    ...amd,
    market: {
      ...amd.market,
      source: "live",
      dayChangePct: -6.4,
      sevenDayChangePct: -8.1,
      earningsStatus: "quiet",
    },
    catalysts: [],
  },
  {
    ...arm,
    market: {
      ...arm.market,
      source: "live",
      dayChangePct: 0.8,
      sevenDayChangePct: 2.2,
      earningsStatus: "upcoming",
    },
    catalysts: [],
  },
  {
    ...intel,
    market: {
      ...intel.market,
      source: "mock",
      earningsStatus: "quiet",
    },
    catalysts: [],
  },
];

const changes = buildStocksTodayChanges(stocks, { now, limit: 8 });
assert.deepEqual(
  changes.map((item) => item.ticker),
  ["NVDA", "ARM", "AMD", "INTC"],
);
assert.equal(changes[0].kind, "catalyst");
assert.match(changes[0].title, /Blackwell/);
assert.equal(changes.find((item) => item.ticker === "ARM")?.kind, "earnings");
assert.equal(changes.find((item) => item.ticker === "AMD")?.kind, "risk");
assert.equal(changes.find((item) => item.ticker === "INTC")?.kind, "data");

const oldCatalystChanges = buildStocksTodayChanges(
  [
    {
      ...nvda,
      market: {
        ...nvda.market,
        source: "live",
        dayChangePct: 0,
        sevenDayChangePct: 0,
        earningsStatus: "quiet",
      },
      catalysts: [
        {
          ...stocks[0].catalysts[0],
          createdAt: "2026-07-20T10:00:00.000Z",
        },
      ],
    },
  ],
  { now },
);
assert.equal(oldCatalystChanges.length, 0);

console.log("ok - stocks today changes ranking");
