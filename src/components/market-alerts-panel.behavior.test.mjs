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
        marketCapUsd: 120_000_000,
        fdvUsd: 140_000_000,
        valuationUpdatedAt: "2026-08-31T00:10:00.000Z",
        changePct: 7.2,
        volumeRatio: 2.4,
        score: null,
        metrics: { pct24h: 10.2 },
        reasons: ["近25m上涨7.20%"],
        deliveryStatus: "site",
        telegramMessageId: null,
        chartUrl: "/api/market-alerts/charts/BTCUSDT?v=1788135000000",
        chartInterval: "15m",
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
    marketCapUsd: 450_000_000,
    fdvUsd: null,
    side: "SHORT",
    chartUrl: "/api/market-alerts/charts/ETHUSDT?v=1788135000001",
  });
  initialSnapshot.events.push({
    ...initialSnapshot.events[0],
    id: "short_squeeze:LONG:SQUEEZEUSDT:fixture",
    type: "short_squeeze",
    symbol: "SQUEEZEUSDT",
    stage: "轧空启动",
    trigger: "价格与持仓量同步增强",
    changePct: 4.2,
    metrics: { pct24h: null, oiGrowth15m: 7.5, funding: 0.0002 },
    chartUrl: null,
    chartUpdatedAt: null,
  });
  initialSnapshot.events.unshift({
    ...initialSnapshot.events[0],
    id: "volatility:LONG:XRPUSDT:fixture",
    symbol: "XRPUSDT",
    marketCapUsd: null,
    fdvUsd: null,
    metrics: {},
    chartUrl: null,
    chartUpdatedAt: null,
  });
  initialSnapshot.events.push(...Array.from({ length: 96 }, (_, index) => ({
    ...initialSnapshot.events[0],
    id: `volatility:LONG:TEST${index}USDT:fixture`,
    symbol: `TEST${index}USDT`,
    chartUrl: null,
    chartUpdatedAt: null,
  })));

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(MarketAlertsPanel, { initialSnapshot }),
    );
  });

  const workspace = renderer.root.findByProps({
    "data-market-alert-workspace": true,
  });
  assert.ok(workspace.findByProps({ "data-market-alert-feed": true }));
  assert.ok(workspace.findByProps({ "data-opportunity-panel": true }));
  assert.ok(workspace.findByProps({ "data-market-alert-right-rail": true }));
  const sidebar = workspace.findByProps({ "data-market-alert-sidebar": true });
  assert.equal(sidebar.props.role, "region");
  assert.equal(sidebar.props.tabIndex, 0);
  assert.ok(sidebar.findByProps({
    "data-market-ranking-symbol": "BTCUSDT",
  }));
  assert.equal(renderer.root.findAll((node) => node.props["data-market-alert-row"]).length, 100);
  const xrpRowText = renderedText(renderer.root.findByProps({
    "data-market-alert-row": "XRPUSDT",
  }));
  assert.match(xrpRowText, /n\/a/);
  assert.doesNotMatch(xrpRowText, /\+0\.00%/);

  assert.equal(
    renderer.root.findAllByProps({ alt: "BTCUSDT 最新 15 分钟 K 线图" }).length,
    0,
    "collapsed alerts should not load chart images",
  );
  const btcEvent = initialSnapshot.events.find((event) => event.symbol === "BTCUSDT");
  const expandBtc = renderer.root.findByProps({
    "data-market-alert-toggle": "volatility:LONG:BTCUSDT:fixture",
  });
  assert.match(renderedText(expandBtc), /\$120M/);
  assert.match(renderedText(expandBtc), /\$140M/);
  assert.match(renderedText(expandBtc), /25m 价格/);
  assert.doesNotMatch(renderedText(expandBtc), /暴涨预警|A趋势|REST/);
  const ethSummary = renderedText(renderer.root.findByProps({
    "data-market-alert-toggle": "volatility:SHORT:ETHUSDT:fixture",
  }));
  assert.match(ethSummary, /\$450M/);
  assert.match(ethSummary, /n\/a/);
  assert.match(renderedText(renderer.root.findByProps({
    "data-market-alert-toggle": "short_squeeze:LONG:SQUEEZEUSDT:fixture",
  })), /\+7\.50%15m OI/);
  await act(async () => {
    expandBtc.props.onClick();
  });
  const preview = renderer.root.findByProps({
    alt: "BTCUSDT 最新 15 分钟 K 线图",
  });
  assert.equal(preview.props.src, btcEvent.chartUrl);
  assert.equal(preview.props.loading, "eager");
  assert.equal(renderer.root.findAllByProps({
    alt: "ETHUSDT 最新 15 分钟 K 线图",
  }).length, 0);
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

  await act(async () => {
    renderer.root.findByProps({
      "data-market-alert-toggle": "volatility:SHORT:ETHUSDT:fixture",
    }).props.onClick();
  });
  assert.equal(renderer.root.findAllByProps({
    alt: "BTCUSDT 最新 15 分钟 K 线图",
  }).length, 0);
  assert.equal(renderer.root.findByProps({
    alt: "ETHUSDT 最新 15 分钟 K 线图",
  }).props.loading, "eager");

  await act(async () => {
    renderer.root.findByProps({
      "data-market-alert-toggle": "short_squeeze:LONG:SQUEEZEUSDT:fixture",
    }).props.onClick();
  });
  const squeezeDetail = renderedText(renderer.root.findByProps({
    "data-market-alert-detail": "SQUEEZEUSDT",
  })).replaceAll(/\s/g, "");
  assert.match(squeezeDetail, /15m\+4\.20%/);
  assert.match(squeezeDetail, /OI15m\+7\.50%/);
  assert.match(squeezeDetail, /24hn\/a/);
  assert.doesNotMatch(squeezeDetail, /24h\+0\.00%/);
  assert.match(squeezeDetail, /价格\$68,000/);
  assert.match(squeezeDetail, /触发08\/31/);

  console.log("ok - market alert workspace lazily expands one chart at a time");
} finally {
  if (renderer) {
    await act(async () => renderer.unmount());
  }
  globalThis.window = previousWindow;
  globalThis.EventSource = previousEventSource;
  rmSync(runtimePath, { force: true });
  rmSync(stubsPath, { force: true });
}
