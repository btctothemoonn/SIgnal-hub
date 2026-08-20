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
assert.match(source, /公司指引/);
assert.match(source, /calendarYear/);
assert.doesNotMatch(source, /overflow-x-auto|min-w-\[/);
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

function provenance(provider, metric, semantics, method = "direct") {
  return {
    provider,
    method,
    accountingBasis: provider === "sec" ? "US GAAP" : "Consensus",
    url: `https://example.com/${provider}`,
    fetchedAt: "2026-08-20T00:00:00.000Z",
    confidence: provider === "sec" ? "official" : "structured",
    currency: "USD",
    unit: "monetary",
    scale: "raw",
    metric,
    semantics,
  };
}

function metric({ estimate, actual, metricName, derived = false }) {
  const surprise = actual === null ? null : actual - estimate;
  return {
    estimate,
    estimateSource: provenance(
      "finnhub",
      metricName,
      "consensus-estimate",
      derived ? "eps-times-diluted-shares" : "direct",
    ),
    actual,
    actualSource:
      actual === null
        ? undefined
        : provenance("sec", metricName, "statement-actual"),
    previousYearActual: null,
    estimateYoYPct: null,
    actualYoYPct: null,
    surprise,
    surprisePct:
      surprise === null || estimate === 0 ? null : (surprise / Math.abs(estimate)) * 100,
  };
}

function earningsItem({
  fiscalYear,
  quarter,
  reportDate,
  status,
  revenueEstimate,
  revenueActual,
  netIncomeEstimate,
  netIncomeActual,
  companyGuidance = null,
  missing = [],
}) {
  return {
    ticker: "NVDA",
    fiscalYear,
    quarter,
    fiscalDateEnding: reportDate,
    reportDate,
    reportTiming: "after-market",
    currency: "USD",
    accountingBasis: "US GAAP",
    provider: "fmp",
    generatedAt: "2026-08-20T00:00:00.000Z",
    revenue: metric({
      estimate: revenueEstimate,
      actual: revenueActual,
      metricName: "revenue",
    }),
    netIncome: metric({
      estimate: netIncomeEstimate,
      actual: netIncomeActual,
      metricName: "net-income",
      derived: true,
    }),
    status,
    reportDateSource: {
      provider: "official-ir",
      url: "https://investor.nvidia.com/",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      confidence: "official",
    },
    companyGuidance,
    completeness: {
      complete: missing.length === 0,
      missing,
      attemptedProviders: ["fmp", "finnhub", "sec", "chartmill"],
    },
  };
}

function visibleText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  return visibleText(node.children);
}

let renderer;
try {
  writeFileSync(runtimePath, output, "utf8");
  const { StocksEarningsBrief, formatEarningsMoney } = await import(
    `${pathToFileURL(runtimePath).href}?run=${Date.now()}`
  );
  assert.equal(formatEarningsMoney(45_850_000_000, "USD"), "$45.85B");
  assert.equal(formatEarningsMoney(-190_400_000, "USD"), "-$190.40M");

  const items = [
    earningsItem({
      fiscalYear: 2027,
      quarter: "Q2",
      reportDate: "2026-08-26",
      status: "upcoming",
      revenueEstimate: 45_850_000_000,
      revenueActual: null,
      netIncomeEstimate: 25_048_000_000,
      netIncomeActual: null,
      companyGuidance: {
        revenueLow: 45_000_000_000,
        revenueHigh: 47_000_000_000,
        revenueMid: 46_000_000_000,
        currency: "USD",
        source: {
          provider: "official-ir",
          url: "https://investor.nvidia.com/guidance",
          fetchedAt: "2026-08-20T00:00:00.000Z",
          confidence: "official",
        },
      },
    }),
    earningsItem({
      fiscalYear: 2027,
      quarter: "Q1",
      reportDate: "2026-05-20",
      status: "reported",
      revenueEstimate: 43_280_000_000,
      revenueActual: 44_060_000_000,
      netIncomeEstimate: 23_300_000_000,
      netIncomeActual: 24_100_000_000,
    }),
    earningsItem({
      fiscalYear: 2026,
      quarter: "Q4",
      reportDate: "2026-02-25",
      status: "incomplete",
      revenueEstimate: 38_000_000_000,
      revenueActual: 39_300_000_000,
      netIncomeEstimate: 0,
      netIncomeActual: 22_000_000_000,
      missing: ["net-income-estimate"],
    }),
    earningsItem({
      fiscalYear: 2026,
      quarter: "Q3",
      reportDate: "2026-01-12",
      status: "reported",
      revenueEstimate: 34_000_000_000,
      revenueActual: 35_100_000_000,
      netIncomeEstimate: 18_000_000_000,
      netIncomeActual: 19_300_000_000,
    }),
  ];
  items[2].netIncome.estimate = null;
  items[2].netIncome.estimateSource = undefined;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        items,
        calendarYear: 2026,
        insight: {
          conclusion: "最新季度营收与净利润均高于一致预期。",
          driver: "数据中心需求保持强劲。",
          risk: "出口限制仍可能影响增速。",
          source: "ai",
          model: "MiniMax-M2.7",
          generatedAt: "2026-08-20T00:05:00.000Z",
        },
        updatedAt: "2026-08-20T00:05:00.000Z",
        source: "live",
      }),
    );
  });

  const visible = visibleText(renderer.toJSON());
  assert.match(visible, /2026 财报/);
  assert.ok(visible.indexOf("FY2027 Q2") < visible.indexOf("FY2027 Q1"));
  assert.match(visible, /即将发布/);
  assert.equal((visible.match(/等待公布/g) ?? []).length >= 2, true);
  assert.match(visible, /\$45\.85B/);
  assert.match(visible, /\$44\.06B/);
  assert.match(visible, /\+1\.80%/);
  assert.match(visible, /推导/);
  assert.match(visible, /公司指引（非一致预期）/);
  assert.match(visible, /\$45\.00B 至 \$47\.00B/);
  assert.match(visible, /数据不完整/);
  assert.match(visible, /净利润预计值/);
  assert.match(visible, /已尝试 FMP、Finnhub、SEC、ChartMill/);
  assert.match(visible, /核心结论/);
  assert.match(visible, /主要驱动/);
  assert.match(visible, /风险提示/);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StocksEarningsBrief, {
        items: [],
        calendarYear: 2026,
        insight: null,
      }),
    );
  });
  assert.match(visibleText(renderer.toJSON()), /2026 年暂无可核验的财报数据/);
} finally {
  if (renderer) await act(async () => renderer.unmount());
  rmSync(runtimePath, { force: true });
}

console.log("ok - stocks calendar-year earnings UI");
