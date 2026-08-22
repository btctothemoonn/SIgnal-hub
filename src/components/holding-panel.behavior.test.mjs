import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(directory, "holding-panel.tsx");
const temporaryComponentPath = join(
  directory,
  `holding-panel.runtime-${process.pid}.mjs`,
);
const temporaryStubsPath = join(
  directory,
  `holding-panel.runtime-stubs-${process.pid}.mjs`,
);
const temporaryStubsImport = `./holding-panel.runtime-stubs-${process.pid}.mjs`;

const originalWindow = globalThis.window;
let renderer;

try {
  writeFileSync(
    temporaryStubsPath,
    `
import React from "react";

export function USStockHoldingPanel() {
  return React.createElement("div", { "data-us-stock-holding-stub": true });
}

export function analyzeFuturesPositions() {
  return { totalPnl: 0, totalNotional: 0, weightedPnlPercent: 0 };
}

export function getBinanceDisplayTotalEquity() {
  return 0;
}

export function buildFuturesExposureRows() {
  return [];
}

export function summarizeFuturesExposure() {
  return {
    totalNotional: 0,
    longNotional: 0,
    shortNotional: 0,
    longPercent: 0,
    shortPercent: 0,
    bias: "方向中性",
  };
}
`,
    "utf8",
  );

  const componentOutput = ts
    .transpileModule(readFileSync(componentPath, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: componentPath,
    })
    .outputText.replaceAll(
      /from "@\/[^"]+";/g,
      `from "${temporaryStubsImport}";`,
    );
  writeFileSync(temporaryComponentPath, componentOutput, "utf8");

  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };

  const { HoldingPanel } = await import(
    `${pathToFileURL(temporaryComponentPath).href}?run=${Date.now()}`
  );

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HoldingPanel));
  });

  const binanceTab = renderer.root.findByProps({ id: "holding-tab-binance" });
  const usStocksTab = renderer.root.findByProps({
    id: "holding-tab-us-stocks",
  });

  assert.equal(binanceTab.props["aria-selected"], true);
  assert.equal(usStocksTab.props["aria-selected"], false);
  assert.equal(
    renderer.root.findByProps({ id: "holding-panel-binance" }).props.role,
    "tabpanel",
  );

  await act(async () => {
    usStocksTab.props.onClick();
  });

  assert.equal(
    renderer.root.findByProps({ id: "holding-tab-us-stocks" }).props[
      "aria-selected"
    ],
    true,
  );
  assert.equal(
    renderer.root.findByProps({ id: "holding-panel-us-stocks" }).props.role,
    "tabpanel",
  );

  console.log("ok - holding panel defaults to Binance and keeps tabs interactive");
} finally {
  if (renderer) {
    await act(async () => {
      renderer.unmount();
    });
  }
  globalThis.window = originalWindow;
  rmSync(temporaryComponentPath, { force: true });
  rmSync(temporaryStubsPath, { force: true });
}
