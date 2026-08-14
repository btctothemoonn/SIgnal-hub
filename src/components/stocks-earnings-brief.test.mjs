import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(directory, "stocks-earnings-brief.tsx");
const runtimePath = join(
  directory,
  `stocks-earnings-brief.runtime-${process.pid}.mjs`,
);
const source = readFileSync(componentPath, "utf8");

assert.match(source, /data-stocks-earnings-brief/);
assert.match(source, /预计值/);
assert.match(source, /公布值/);
assert.match(source, /较预期/);
assert.match(source, /FMP standardized/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);

const output = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: componentPath,
}).outputText;

let renderer;
try {
  writeFileSync(runtimePath, output, "utf8");
  const { StocksEarningsBrief, formatEarningsMoney } = await import(
    `${pathToFileURL(runtimePath).href}?run=${Date.now()}`
  );
  assert.equal(formatEarningsMoney(582_300_000, "USD"), "$582.30M");
  assert.equal(formatEarningsMoney(-190_400_000, "USD"), "-$190.40M");
  assert.equal(formatEarningsMoney(null, "USD"), "n/a");

  const comparison = {
    ticker: "NBIS",
    fiscalYear: 2026,
    quarter: "Q2",
    fiscalDateEnding: "2026-06-30",
    reportDate: "2026-08-12",
    reportTiming: "before-market",
    currency: "USD",
    accountingBasis: "FMP standardized",
    provider: "fmp",
    generatedAt: "2026-08-14T00:00:00.000Z",
    revenue: {
      estimate: 573_937_500,
      actual: 582_300_000,
      previousYearActual: 105_100_000,
      estimateYoYPct: 446.087,
      actualYoYPct: 454.044,
      surprise: 8_362_500,
      surprisePct: 1.457,
    },
    netIncome: {
      estimate: -273_800_000,
      actual: -190_400_000,
      previousYearActual: -143_600_000,
      estimateYoYPct: -90.669,
      actualYoYPct: -32.591,
      surprise: 83_400_000,
      surprisePct: 30.46,
    },
  };
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        comparison,
        insight: {
          conclusion: "营收与净利润均好于 FMP 一致预期。",
          driver: "净亏损较预期收窄。",
          risk: "公司仍处于亏损阶段。",
          source: "ai",
          model: "MiniMax-M2.7",
          generatedAt: "2026-08-14T00:05:00.000Z",
        },
        updatedAt: "2026-08-14T00:05:00.000Z",
        source: "live",
      }),
    );
  });
  const rendered = JSON.stringify(renderer.toJSON());
  assert.match(rendered, /"2026"," ","Q2"/);
  assert.match(rendered, /营收/);
  assert.match(rendered, /净利润/);
  assert.match(rendered, /\$582\.30M/);
  assert.match(rendered, /-\$190\.40M/);
  assert.match(rendered, /\+1\.46%/);
  assert.match(rendered, /FMP/);
  assert.match(rendered, /核心结论/);
  assert.match(rendered, /主要驱动/);
  assert.match(rendered, /风险提示/);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        comparison: {
          ...comparison,
          revenue: {
            ...comparison.revenue,
            estimate: null,
            estimateYoYPct: null,
            surprise: null,
            surprisePct: null,
          },
        },
        insight: null,
        updatedAt: comparison.generatedAt,
        source: "live",
      }),
    );
  });
  assert.match(JSON.stringify(renderer.toJSON()), /n\/a/);
} finally {
  if (renderer) await act(async () => renderer.unmount());
  rmSync(runtimePath, { force: true });
}

console.log("ok - stocks earnings brief UI");
