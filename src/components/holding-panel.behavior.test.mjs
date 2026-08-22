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
let cachedSnapshot = null;

function renderedText(node) {
  return node.children
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : renderedText(child),
    )
    .join("");
}

try {
  writeFileSync(
    temporaryStubsPath,
    `
import React from "react";

export function USStockHoldingPanel() {
  return React.createElement("div", { "data-us-stock-holding-stub": true });
}

export function analyzeFuturesPositions() {
  return { biasLabel: "Neutral", netExposureLeverage: 0 };
}

export function getBinanceDisplayTotalEquity() {
  return 0;
}

export function buildFuturesExposureRows(positions) {
  return positions.map((position, index) => ({
    position,
    asset: position.symbol.replace("USDT", ""),
    rank: index + 1,
    direction: position.side === "SHORT" ? "空" : "多",
    absNotional: Math.abs(position.notional),
    exposurePercent: 100,
    pnlPercent: 10,
    liquidationDistancePercent: 45,
    isTopExposure: true,
  }));
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
        return cachedSnapshot;
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

  await act(async () => {
    renderer.unmount();
  });
  renderer = undefined;
  cachedSnapshot = JSON.stringify({
    exchange: "binance",
    accountMode: "standard",
    updatedAt: "2026-08-23T08:00:00.000Z",
    spotBalances: [],
    futuresPositions: [
      {
        symbol: "BTCUSDT",
        side: "LONG",
        amount: 1,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: 10,
        liquidationPrice: 60,
        leverage: 5,
        marginType: "cross",
        notional: 110,
        peakTracking: {
          symbol: "BTCUSDT",
          side: "LONG",
          openedAt: "2026-08-22T06:00:00.000Z",
          openedAtSource: "trades",
          favorablePrice: 130,
          drawdownPercent: 15.38,
          checkedAt: "2026-08-23T08:00:00.000Z",
          status: "live",
        },
      },
    ],
    summary: {
      spotAssetCount: 0,
      futuresPositionCount: 1,
      futuresWalletBalance: 1_000,
      futuresUnrealizedPnl: 10,
      futuresMarginBalance: 1_010,
      futuresAvailableBalance: 900,
      futuresLongNotional: 110,
      futuresShortNotional: 0,
      futuresGrossNotional: 110,
      futuresNetNotional: 110,
    },
    warnings: [],
  });

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HoldingPanel));
  });
  const peakDrawdownNodes = renderer.root.findAllByProps({
    "data-position-peak-drawdown": true,
  });
  assert.equal(
    peakDrawdownNodes.length,
    1,
    "each futures row should display its peak drawdown",
  );
  const peakDrawdown = peakDrawdownNodes[0];
  const peakDrawdownText = renderedText(peakDrawdown);
  assert.match(peakDrawdownText, /峰值回撤/);
  assert.match(peakDrawdownText, /15\.4%/);
  assert.match(peakDrawdownText, /最高.*\$130\.00/);

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
