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
assert.match(source, /accountingBasisLabel\(source/);
assert.doesNotMatch(source, /truncate/);
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
  assert.equal(formatEarningsMoney(null, "USD"), "数据源暂未覆盖");

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
      estimateSource: {
        provider: "fmp",
        method: "direct",
        accountingBasis: "FMP standardized",
      },
      actual: 582_300_000,
      actualSource: {
        provider: "finnhub",
        method: "direct",
        accountingBasis: "FMP standardized",
      },
      previousYearActual: 105_100_000,
      estimateYoYPct: 446.087,
      actualYoYPct: 454.044,
      surprise: 8_362_500,
      surprisePct: 1.457,
    },
    netIncome: {
      estimate: -273_800_000,
      estimateSource: {
        provider: "alpha-vantage",
        method: "direct",
        accountingBasis: "US GAAP",
      },
      actual: -190_400_000,
      actualSource: {
        provider: "eodhd",
        method: "eps-times-diluted-shares",
        accountingBasis: "EODHD diluted shares",
      },
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
  function visibleText(node) {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(visibleText).join("");
    return visibleText(node.children);
  }
  const visible = visibleText(renderer.toJSON());
  assert.match(rendered, /"2026"," ","Q2"/);
  assert.match(rendered, /营收/);
  assert.match(rendered, /净利润/);
  assert.match(rendered, /\$582\.30M/);
  assert.match(rendered, /-\$190\.40M/);
  assert.match(rendered, /\+1\.46%/);
  assert.match(rendered, /FMP/);
  assert.match(rendered, /Finnhub/);
  assert.match(rendered, /EPS 推算/);
  assert.match(rendered, /推导/);
  assert.match(visible, /FMP standardized/);
  assert.match(visible, /Finnhub/);
  assert.match(visible, /EODHD diluted shares/);
  assert.match(visible, /直接/);
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
  const missingEstimateRendered = JSON.stringify(renderer.toJSON());
  assert.match(missingEstimateRendered, /数据源暂未覆盖/);
  assert.doesNotMatch(missingEstimateRendered, /n\/a/);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        comparison: {
          ...comparison,
          fiscalDateEnding: "2099-06-30",
          reportDate: null,
          revenue: {
            ...comparison.revenue,
            estimate: null,
            actual: null,
            estimateYoYPct: null,
            actualYoYPct: null,
            surprise: null,
            surprisePct: null,
          },
        },
        insight: null,
      }),
    );
  });
  assert.match(JSON.stringify(renderer.toJSON()), /等待公布/);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        comparison: {
          ...comparison,
          revenue: {
            ...comparison.revenue,
            actualSource: {
              ...comparison.revenue.actualSource,
              accountingBasis: "Finnhub GAAP",
            },
          },
        },
        insight: null,
      }),
    );
  });
  const incompatibleVisible = visibleText(renderer.toJSON());
  assert.match(incompatibleVisible, /口径不可比/);
  assert.match(incompatibleVisible, /Finnhub GAAP/);
  assert.doesNotMatch(incompatibleVisible, /\+1\.46%/);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        comparison: {
          ...comparison,
          revenue: {
            ...comparison.revenue,
            actualSource: undefined,
          },
        },
        insight: null,
      }),
    );
  });
  const missingProvenanceVisible = visibleText(renderer.toJSON());
  assert.match(missingProvenanceVisible, /来源未返回/);
  assert.match(missingProvenanceVisible, /口径未返回/);
  assert.match(missingProvenanceVisible, /待数据/);
  assert.doesNotMatch(missingProvenanceVisible, /\+1\.46%/);
} finally {
  if (renderer) await act(async () => renderer.unmount());
  rmSync(runtimePath, { force: true });
}

console.log("ok - stocks earnings brief UI");
