import assert from "node:assert/strict";
import * as transport from "./stocks-performance-transport.ts";

assert.equal(typeof transport.compactStocksPerformanceSnapshot, "function");
assert.equal(typeof transport.expandCompactStocksPerformanceSnapshot, "function");

const snapshot = {
  generatedAt: "2026-08-13T08:00:00.000Z",
  marketDate: "2026-05-06 -> 2026-08-13",
  marketDates: ["2026-05-06", "2026-08-13"],
  source: "local-cache",
  provider: "local-cache",
  series: [
    {
      ticker: "NVDA",
      provider: "finnhub",
      confidence: "high",
      latestPrice: 190,
      latestChangePct: 10,
      points: [
        {
          ticker: "NVDA",
          capturedAt: "2026-05-06T20:00:00.000Z",
          marketDate: "2026-05-06",
          price: 172.73,
          changePct: 0,
          provider: "yahoo",
          freshness: "delayed",
          confidence: "medium",
        },
        {
          ticker: "NVDA",
          capturedAt: "2026-08-13T08:00:00.000Z",
          marketDate: "2026-08-13",
          price: 190,
          changePct: 10,
          provider: "finnhub",
          freshness: "realtime",
          confidence: "high",
        },
      ],
    },
  ],
  missingTickers: [],
  errors: [],
};

const compact = transport.compactStocksPerformanceSnapshot(snapshot);
assert.equal(compact.format, "compact-v1");
assert.ok(Array.isArray(compact.series[0].points[0]));
assert.deepEqual(
  transport.expandCompactStocksPerformanceSnapshot(compact),
  snapshot,
);

console.log("ok - stocks performance compact transport round trip");
