import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const pagePath = join(directory, "alpha-research-page.tsx");
const temporaryPagePath = join(
  directory,
  `alpha-research-page.runtime-${process.pid}.mjs`,
);
const temporaryStubsPath = join(
  directory,
  `alpha-research-page.runtime-stubs-${process.pid}.mjs`,
);
const temporaryStubsImport = `./alpha-research-page.runtime-stubs-${process.pid}.mjs`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const requests = [];
const intervalCallbacks = [];
let snapshotErrorMode = "generic";
let pageRenderer;

try {
  const stubsSource = `
import React from "react";

const noop = () => {};

export function AlphaSummaryCard() {
  return null;
}

export function StocksResearchLayout(props) {
  globalThis.__task2StocksResearchLayoutProps = props;
  return null;
}

export function StocksSubscriptionReports() {
  return null;
}

export function StocksTodayChanges() {
  return null;
}

export function useBrowserJsonCache() {
  return [null, noop];
}

export function expandCompactStocksPerformanceSnapshot(snapshot) {
  return snapshot;
}

export function scheduleDeferredBrowserTask(callback) {
  callback();
  return noop;
}

export const ALPHA_RESEARCH_DEFAULT_TICKER = "NVDA";
export const ALPHA_RESEARCH_POOL_TRACKING_START_DATE = "2026-05-06";
export const ALPHA_RESEARCH_SECTORS = [
  {
    id: "semiconductors",
    name: "Semiconductors",
    description: "Semiconductor fixture",
    themeScore: 90,
    tickers: ["NVDA", "AMD"],
  },
];
export const ALPHA_RESEARCH_STOCKS = [
  { ticker: "NVDA", sectorId: "semiconductors" },
  { ticker: "AMD", sectorId: "semiconductors" },
];

export function mergeStocksMarketSnapshot(stocks) {
  return stocks;
}

export function mergeStocksFinancialSnapshot(stocks) {
  return stocks;
}

export function mergeStocksCatalystSnapshot(stocks) {
  return stocks;
}

export function buildStocksTodayChanges() {
  return [];
}

export function buildStocksSubscriptionReports() {
  return [];
}
`;
  writeFileSync(temporaryStubsPath, stubsSource, "utf8");

  assert.doesNotMatch(readFileSync(pagePath, "utf8"), /StocksHynixPremiumCurve/);

  const pageOutput = ts
    .transpileModule(readFileSync(pagePath, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: pagePath,
    })
    .outputText.replaceAll(/from "@\/[^\"]+";/g, `from "${temporaryStubsImport}";`);
  writeFileSync(temporaryPagePath, pageOutput, "utf8");

  globalThis.window = {
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval() {},
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    requests.push({ url, method, init });

    if (url === "/api/stocks-market-data") {
      return jsonResponse({
        source: "live",
        provider: "fmp",
        freshness: "realtime",
        generatedAt: "2026-07-26T09:00:00.000Z",
        errors:
          snapshotErrorMode === "generic"
            ? ["NVDA provider request timed out after 10000ms"]
            : ["refresh failed; using cached snapshot"],
      });
    }
    if (url === "/api/stocks-financial-data") {
      return jsonResponse({
        source: "live",
        generatedAt: "2026-07-26T09:00:00.000Z",
        errors:
          snapshotErrorMode === "generic"
            ? ["Yahoo chart returned provider diagnostic details"]
            : ["refresh failed; using cached snapshot"],
      });
    }
    if (url.startsWith("/api/stocks-performance?")) {
      return jsonResponse({
        source: "mock",
        generatedAt: "2026-07-26T09:00:00.000Z",
        series: [],
        errors: [],
      });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { AlphaResearchPage } = await import(
    `${pathToFileURL(temporaryPagePath).href}?run=${Date.now()}`,
  );

  await act(async () => {
    pageRenderer = TestRenderer.create(React.createElement(AlphaResearchPage));
    await flushAsyncWork();
  });

  assert.ok(requests.some(({ url }) => url === "/api/stocks-market-data"));
  assert.ok(requests.some(({ url }) => url === "/api/stocks-financial-data"));
  assert.ok(requests.some(({ url }) => url.startsWith("/api/stocks-performance?")));
  assert.ok(requests.every(({ url }) => !url.includes("stocks-catalysts")));
  assert.ok(requests.every(({ url }) => !url.includes("stocks-research-state")));

  const genericErrorAlert = pageRenderer.root.findByProps({
    "data-stocks-error-alert": true,
  });
  const genericErrorText = genericErrorAlert.children.join("");
  assert.match(genericErrorText, /行情部分数据不可用/);
  assert.match(genericErrorText, /财报部分数据不可用/);
  assert.doesNotMatch(genericErrorText, /NVDA|timed out|Yahoo|diagnostic/);

  const initialLayoutProps = globalThis.__task2StocksResearchLayoutProps;
  assert.equal("researchStates" in initialLayoutProps, false);
  assert.equal("onSaveResearchState" in initialLayoutProps, false);

  const scheduledCallbacks = [...intervalCallbacks];
  snapshotErrorMode = "cached";
  await act(async () => {
    await Promise.all(scheduledCallbacks.map((callback) => callback()));
    await flushAsyncWork();
  });

  const cachedErrorAlert = pageRenderer.root.findByProps({
    "data-stocks-error-alert": true,
  });
  const cachedErrorText = cachedErrorAlert.children.join("");
  assert.match(cachedErrorText, /行情刷新失败，使用缓存/);
  assert.match(cachedErrorText, /财报刷新失败，使用缓存/);

  assert.ok(requests.every(({ url }) => !url.includes("stocks-catalysts")));
  assert.ok(requests.every(({ url }) => !url.includes("stocks-research-state")));
} finally {
  if (pageRenderer) {
    await act(async () => pageRenderer.unmount());
  }
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  delete globalThis.__task2StocksResearchLayoutProps;
  rmSync(temporaryPagePath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}

console.log("ok - alpha research page retained endpoint behavior");
