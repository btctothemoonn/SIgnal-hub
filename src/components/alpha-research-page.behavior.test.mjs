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
const panelPath = join(directory, "stocks-research-state-panel.tsx");
const temporaryPagePath = join(
  directory,
  `alpha-research-page.runtime-${process.pid}.mjs`,
);
const temporaryPanelPath = join(
  directory,
  `stocks-research-state-panel.page-runtime-${process.pid}.mjs`,
);
const temporaryStubsPath = join(
  directory,
  `alpha-research-page.runtime-stubs-${process.pid}.mjs`,
);
const temporaryStubsImport = `./alpha-research-page.runtime-stubs-${process.pid}.mjs`;

function researchState(ticker, overrides = {}) {
  return {
    ticker,
    status: "watch",
    conviction: null,
    entryZone: "",
    invalidation: "",
    nextCatalyst: "",
    thesis: "",
    updatedAt: "2026-07-26T09:00:00.000Z",
    persisted: true,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function visibleText(renderer) {
  return JSON.stringify(renderer.toJSON());
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const requests = [];
const intervalCallbacks = [];
let nextResearchPutResponse = () =>
  jsonResponse({ ok: false, error: { message: "PUT response not configured" } }, 500);
let pageRenderer;
let panelRenderer;

try {
  const stubsSource = `
import React from "react";

const noop = () => {};

export function AlphaSummaryCard() {
  return null;
}

export function StocksResearchLayout(props) {
  globalThis.__task6StocksResearchLayoutProps = props;
  return null;
}

export function StocksSubscriptionReports() {
  return null;
}

export function StocksTodayChanges() {
  return null;
}

export function StocksHynixPremiumCurve() {
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

  const pageOutput = ts
    .transpileModule(readFileSync(pagePath, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: pagePath,
    })
    .outputText.replaceAll(/from "@\/[^"]+";/g, `from "${temporaryStubsImport}";`);
  writeFileSync(temporaryPagePath, pageOutput, "utf8");

  const panelOutput = ts
    .transpileModule(readFileSync(panelPath, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: panelPath,
    })
    .outputText.replaceAll(
      '"@/components/stocks-research-state-form"',
      '"./stocks-research-state-form.ts"',
    );
  writeFileSync(temporaryPanelPath, panelOutput, "utf8");

  globalThis.window = {
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval() {},
  };

  const initialStates = {
    NVDA: researchState("NVDA"),
    AMD: researchState("AMD", {
      status: "waiting",
      thesis: "Keep AMD unchanged",
    }),
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    requests.push({ url, method, init });

    if (url === "/api/stocks-research-state") {
      return method === "PUT"
        ? nextResearchPutResponse()
        : jsonResponse({ generatedAt: "2026-07-26T09:00:00.000Z", states: initialStates });
    }
    if (url === "/api/stocks-market-data") {
      return jsonResponse({
        source: "mock",
        provider: "mock",
        freshness: "mock",
        generatedAt: "2026-07-26T09:00:00.000Z",
        errors: [],
      });
    }
    if (url === "/api/stocks-financial-data") {
      return jsonResponse({
        source: "mock",
        generatedAt: "2026-07-26T09:00:00.000Z",
        errors: [],
      });
    }
    if (url === "/api/stocks-catalysts") {
      return jsonResponse({
        source: "mock",
        generatedAt: "2026-07-26T09:00:00.000Z",
        errors: [],
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
  const { StocksResearchStatePanel } = await import(
    `${pathToFileURL(temporaryPanelPath).href}?run=${Date.now()}`,
  );

  await act(async () => {
    pageRenderer = TestRenderer.create(React.createElement(AlphaResearchPage));
    await flushAsyncWork();
  });

  const researchGets = () =>
    requests.filter(
      (request) =>
        request.url === "/api/stocks-research-state" &&
        request.method === "GET",
    );
  assert.equal(researchGets().length, 1);

  const scheduledCallbacks = [...intervalCallbacks];
  await act(async () => {
    await Promise.all(scheduledCallbacks.map((callback) => callback()));
    await flushAsyncWork();
  });
  assert.equal(researchGets().length, 1);

  const initialLayoutProps = globalThis.__task6StocksResearchLayoutProps;
  assert.deepEqual(initialLayoutProps.researchStates, initialStates);
  const unchangedAmd = initialLayoutProps.researchStates.AMD;

  const completeInput = {
    ticker: "NVDA",
    status: "holding",
    conviction: 5,
    entryZone: "$180-$190",
    invalidation: "Close below $170",
    nextCatalyst: "Next earnings",
    thesis: "Demand remains strong",
  };
  const savedNvda = researchState("NVDA", {
    ...completeInput,
    updatedAt: "2026-07-26T09:05:00.000Z",
  });
  nextResearchPutResponse = () => jsonResponse({ ok: true, state: savedNvda });

  await act(async () => {
    await initialLayoutProps.onSaveResearchState(completeInput);
  });

  const successfulPut = requests.find(
    (request) =>
      request.url === "/api/stocks-research-state" &&
      request.method === "PUT",
  );
  assert.deepEqual(JSON.parse(successfulPut.init.body), completeInput);
  const savedLayoutProps = globalThis.__task6StocksResearchLayoutProps;
  assert.deepEqual(savedLayoutProps.researchStates.NVDA, savedNvda);
  assert.strictEqual(savedLayoutProps.researchStates.AMD, unchangedAmd);

  const beforeMalformedSave = savedLayoutProps.researchStates;
  const malformedSavedStates = [
    ["ticker", { ...savedNvda, ticker: 42 }],
    ["status", { ...savedNvda, status: "not-a-research-status" }],
    ["conviction", { ...savedNvda, conviction: "5" }],
    ["entryZone", { ...savedNvda, entryZone: null }],
    ["invalidation", { ...savedNvda, invalidation: 17 }],
    ["nextCatalyst", { ...savedNvda, nextCatalyst: {} }],
    ["thesis", { ...savedNvda, thesis: false }],
    ["updatedAt", { ...savedNvda, updatedAt: 123 }],
    ["persisted", { ...savedNvda, persisted: "true" }],
  ];
  for (const [field, malformedSavedState] of malformedSavedStates) {
    nextResearchPutResponse = () =>
      jsonResponse({ ok: true, state: malformedSavedState });
    let malformedSaveError = null;
    await act(async () => {
      try {
        await savedLayoutProps.onSaveResearchState(completeInput);
      } catch (error) {
        malformedSaveError = error;
      }
    });
    assert.match(
      String(malformedSaveError),
      /invalid response/i,
      `${field} must be validated`,
    );
    assert.strictEqual(
      globalThis.__task6StocksResearchLayoutProps.researchStates,
      beforeMalformedSave,
      `${field} must not enter page state`,
    );
  }

  nextResearchPutResponse = () =>
    jsonResponse(
      { ok: false, error: { message: "Persistence unavailable" } },
      503,
    );
  const editorLayoutProps = globalThis.__task6StocksResearchLayoutProps;
  await act(async () => {
    panelRenderer = TestRenderer.create(
      React.createElement(StocksResearchStatePanel, {
        ticker: "NVDA",
        researchState: editorLayoutProps.researchStates.NVDA,
        loading: false,
        onSave: editorLayoutProps.onSaveResearchState,
      }),
    );
  });
  await act(async () => {
    panelRenderer.root.findByType("textarea").props.onChange({
      target: { value: "Preserve this rejected draft" },
    });
  });
  await act(async () => {
    panelRenderer.root.findByType("form").props.onSubmit({
      preventDefault() {},
    });
    await flushAsyncWork();
  });

  assert.equal(
    panelRenderer.root.findByType("textarea").props.value,
    "Preserve this rejected draft",
  );
  assert.match(visibleText(panelRenderer), /Persistence unavailable/);
  assert.equal(
    globalThis.__task6StocksResearchLayoutProps.researchStatesError,
    "Persistence unavailable",
  );
} finally {
  if (panelRenderer) {
    await act(async () => panelRenderer.unmount());
  }
  if (pageRenderer) {
    await act(async () => pageRenderer.unmount());
  }
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  delete globalThis.__task6StocksResearchLayoutProps;
  rmSync(temporaryPagePath, { force: true });
  rmSync(temporaryPanelPath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}

console.log("ok - alpha research page research-state workflow behavior");
