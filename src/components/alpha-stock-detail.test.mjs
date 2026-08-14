import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";
import { getAlphaResearchStockByTicker } from "../lib/alpha-research-pool.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const detailPath = join(directory, "alpha-stock-detail.tsx");
const temporaryDetailPath = join(
  directory,
  `alpha-stock-detail.runtime-${process.pid}.mjs`,
);
const temporaryStubsPath = join(
  directory,
  `alpha-stock-detail.runtime-stubs-${process.pid}.mjs`,
);
const temporaryStubsImport = `./alpha-stock-detail.runtime-stubs-${process.pid}.mjs`;
const source = readFileSync(detailPath, "utf8");

assert.match(source, /data-stock-primary-context/);
assert.match(source, /研究结论/);
assert.match(source, /跟踪要点/);
assert.match(source, /StocksEarningsBrief/);
assert.match(source, /stock\.summary/);
assert.match(source, /stock\.thesis\.slice\(0, 2\)/);
assert.match(source, /compactTrackingPoints\(stock\)/);
assert.match(
  source,
  /note=\{stock\.financialSnapshot\.nextEarningsDate \|\| "n\/a"\}/,
  "missing earnings dates must retain the n/a fallback",
);

assert.doesNotMatch(source, /Ticker Intelligence/);
assert.doesNotMatch(source, /Impact & Risk Tags/);
assert.doesNotMatch(source, /StocksResearchStatePanel/);
assert.doesNotMatch(source, /订阅研报/);
assert.doesNotMatch(source, /今日催化/);
assert.doesNotMatch(source, /财报复盘/);
assert.doesNotMatch(source, /主线验证/);
assert.doesNotMatch(source, /splitStocksCatalystsForDisplay/);
assert.doesNotMatch(source, /buildSubscriptionReportInsight/);
assert.doesNotMatch(source, /stock\.catalysts/);
assert.doesNotMatch(source, /researchState/);
assert.doesNotMatch(source, /riskTags/);
assert.doesNotMatch(source, /data-stock-intelligence/);
assert.doesNotMatch(source, /data-stock-supporting-research/);
assert.doesNotMatch(source, /Priority \{stock\.priority\}/);
assert.doesNotMatch(source, /sessionLabel/);
assert.doesNotMatch(source, /CandlestickChart/);
assert.doesNotMatch(source, /candles3d/);
assert.doesNotMatch(source, /Structure Snapshot/);
assert.doesNotMatch(source, /Earnings Brief/);
assert.doesNotMatch(source, /结构与财报/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);

let detailRenderer;
try {
  writeFileSync(
    temporaryStubsPath,
    `
export { buildStocksIntelligence } from "../lib/stocks-intelligence.ts";

export function getAlphaResearchSectorById() {
  return { name: "Semiconductors" };
}

export function StocksEarningsBrief() {
  return "Stocks Earnings Brief";
}
`,
    "utf8",
  );
  const detailOutput = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: detailPath,
    })
    .outputText.replaceAll(
      /from "@\/(?:lib\/(?:alpha-research-pool|stocks-intelligence)|components\/stocks-earnings-brief)";/g,
      `from "${temporaryStubsImport}";`,
    );
  writeFileSync(temporaryDetailPath, detailOutput, "utf8");

  const nvda = getAlphaResearchStockByTicker("NVDA");
  assert.ok(nvda);
  const catalystSentinelStock = { ...nvda };
  Object.defineProperty(catalystSentinelStock, "catalysts", {
    get() {
      throw new Error("active detail intelligence must not read catalyst history");
    },
  });

  const { AlphaStockDetail } = await import(
    `${pathToFileURL(temporaryDetailPath).href}?run=${Date.now()}`,
  );
  await act(async () => {
    detailRenderer = TestRenderer.create(
      React.createElement(AlphaStockDetail, {
        stock: catalystSentinelStock,
        marketDataLabel: "基线价 / 非实时",
        marketDataLoading: false,
      }),
    );
  });
  assert.match(JSON.stringify(detailRenderer.toJSON()), /Stocks Earnings Brief/);
} finally {
  if (detailRenderer) {
    await act(async () => detailRenderer.unmount());
  }
  rmSync(temporaryDetailPath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}

console.log("ok - compact alpha stock detail UI");
