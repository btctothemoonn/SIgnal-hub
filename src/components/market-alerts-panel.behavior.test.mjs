import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(directory, "market-alerts-panel.tsx");
const runtimePath = join(directory, `market-alerts-panel.runtime-${process.pid}.mjs`);
const stubsPath = join(directory, `market-alerts-panel.stubs-${process.pid}.mjs`);
const stubsImport = `./market-alerts-panel.stubs-${process.pid}.mjs`;
const previousWindow = globalThis.window;
const previousEventSource = globalThis.EventSource;
let renderer;

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node?.children) return "";
  return node.children.map(renderedText).join("");
}

class FakeEventSource {
  addEventListener() {}
  close() {}
}

try {
  writeFileSync(
    stubsPath,
    `
import React from "react";
export default function Image(props) {
  return React.createElement("img", props);
}
export function getMarketAlertWorkerView() {
  return { label: "离线", detail: "尚未启动", tone: "warning", lastError: null };
}
export function MarketOpportunityPanel() {
  return React.createElement("section", { "data-opportunity-panel": true });
}
`,
    "utf8",
  );
  const output = ts.transpileModule(readFileSync(componentPath, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentPath,
  }).outputText
    .replace('from "next/image"', `from "${stubsImport}"`)
    .replace('from "@/lib/market-alerts-health"', `from "${stubsImport}"`)
    .replace('from "./market-opportunity-panel"', `from "${stubsImport}"`);
  writeFileSync(runtimePath, output, "utf8");

  globalThis.window = {
    setInterval() {
      return 1;
    },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.EventSource = FakeEventSource;

  const { MarketAlertsPanel } = await import(
    `${pathToFileURL(runtimePath).href}?run=${Date.now()}`
  );
  const initialSnapshot = {
    generatedAt: "2026-08-31T00:10:00.000Z",
    latestUpdatedAt: "2026-08-31T00:10:00.000Z",
    total: 1,
    page: 1,
    limit: 100,
    events: [
      {
        id: "volatility:LONG:BTCUSDT:fixture",
        type: "volatility",
        symbol: "BTCUSDT",
        side: "LONG",
        level: 1,
        stage: "暴涨预警",
        trigger: "A趋势·确认",
        source: "rest",
        price: 68000,
        changePct: 7.2,
        volumeRatio: 2.4,
        score: null,
        metrics: { pct24h: 10.2 },
        reasons: ["近25m上涨7.20%"],
        deliveryStatus: "site",
        telegramMessageId: null,
        chartUrl: "/api/market-alerts/charts/BTCUSDT?v=1788135000000",
        chartUpdatedAt: "2026-08-31T00:10:00.000Z",
        occurredAt: "2026-08-31T00:10:00.000Z",
        createdAt: "2026-08-31T00:10:00.000Z",
      },
    ],
    activeSignals: [],
    opportunities: [],
    opportunityMeta: {
      fingerprint: null,
      lastScanAt: null,
      lastSuccessAt: null,
      stale: false,
      aiProvider: null,
      aiGeneratedAt: null,
      aiError: null,
    },
    marketRanking: [
      {
        symbol: "BTCUSDT",
        price: 68000,
        pct24h: 10.2,
        quoteVolume: 2_000_000_000,
        marketCapUsd: 120_000_000,
        fdvUsd: 140_000_000,
        updatedAt: "2026-08-31T00:10:00.000Z",
        counts: { pump: 1, crash: 0, squeeze: 0, total: 1 },
        lastTriggeredAt: "2026-08-31T00:10:00.000Z",
        dualSignal: false,
      },
      {
        symbol: "ZEROTESTUSDT",
        price: 0,
        pct24h: -8.5,
        quoteVolume: 12_000_000,
        marketCapUsd: null,
        fdvUsd: 450_000_000,
        updatedAt: "2026-08-31T00:10:00.000Z",
        counts: { pump: 0, crash: 1, squeeze: 0, total: 1 },
        lastTriggeredAt: "2026-08-31T00:10:00.000Z",
        dualSignal: false,
      },
    ],
    health: { volatilityWs: null, volatilityRest: null, squeeze: null, opportunity: null },
  };
  initialSnapshot.events.push({
    ...initialSnapshot.events[0],
    id: "volatility:SHORT:ETHUSDT:fixture",
    symbol: "ETHUSDT",
    side: "SHORT",
    chartUrl: "/api/market-alerts/charts/ETHUSDT?v=1788135000001",
  });
  initialSnapshot.events.unshift({
    ...initialSnapshot.events[0],
    id: "volatility:LONG:XRPUSDT:fixture",
    symbol: "XRPUSDT",
    chartUrl: null,
    chartUpdatedAt: null,
  });

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(MarketAlertsPanel, { initialSnapshot }),
    );
  });

  const preview = renderer.root.findByProps({
    alt: "BTCUSDT 最新 5 分钟 K 线图",
  });
  const btcEvent = initialSnapshot.events.find((event) => event.symbol === "BTCUSDT");
  assert.equal(preview.props.src, btcEvent.chartUrl);
  assert.equal(preview.props.loading, "eager");
  assert.equal(
    renderer.root.findByProps({ alt: "ETHUSDT 最新 5 分钟 K 线图" }).props.loading,
    "lazy",
  );
  const rankingRow = renderer.root.findByProps({
    "data-market-ranking-symbol": "BTCUSDT",
  });
  const rankingText = renderedText(rankingRow).replaceAll(/\s/g, "");
  assert.match(rankingText, /BTC\$68,000/);
  assert.match(rankingText, /流通市值US\$1\.2亿·FDVUS\$1\.4亿/);
  assert.doesNotMatch(rankingText, /US\$20亿/);
  const zeroPriceRow = renderer.root.findByProps({
    "data-market-ranking-symbol": "ZEROTESTUSDT",
  });
  const zeroPriceText = renderedText(zeroPriceRow).replaceAll(/\s/g, "");
  assert.match(zeroPriceText, /ZEROTESTn\/a/);
  assert.match(zeroPriceText, /流通市值n\/a·FDVUS\$4\.5亿/);
  const open = renderer.root.findByProps({
    "aria-label": "放大 BTCUSDT K线图",
  });
  await act(async () => {
    open.props.onClick();
  });
  const dialog = renderer.root.findByProps({ role: "dialog" });
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(
    dialog.findByProps({ alt: "BTCUSDT K线图大图" }).props.src,
    btcEvent.chartUrl,
  );
  await act(async () => {
    dialog.findByProps({ "aria-label": "关闭 K线图" }).props.onClick();
  });
  assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);

  console.log("ok - market alert chart preview opens and closes the full image");
} finally {
  if (renderer) {
    await act(async () => renderer.unmount());
  }
  globalThis.window = previousWindow;
  globalThis.EventSource = previousEventSource;
  rmSync(runtimePath, { force: true });
  rmSync(stubsPath, { force: true });
}
