import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(directory, "market-opportunity-panel.tsx");
const runtimePath = join(directory, `market-opportunity-panel.runtime-${process.pid}.mjs`);
let renderer;

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node?.children) return "";
  return node.children.map(renderedText).join("");
}

function decision(symbol, rank, overrides = {}) {
  const observedAt = "2026-09-04T01:00:00.000Z";
  return {
    symbol,
    rank,
    model: "capital_long",
    direction: "LONG",
    stage: "拉盘做多确认",
    decision: "关注做多",
    score: 82 - rank,
    confidence: 76,
    evidence: ["5m 成交显著放大", "OI 随价格扩张"],
    confirmations: ["等待现货继续跟随"],
    invalidations: ["5m 跌破启动结构"],
    risks: ["短时涨幅偏高"],
    mandatoryComplete: true,
    hardInvalidated: false,
    dataCoverage: 86,
    metrics: {
      symbol,
      observedAt,
      stale: false,
      pct1m: 0.8,
      pct5m: 3.2,
      pct15m: 6.4,
      pct1h: 9.1,
      pct24h: 13.5,
      volumeRatio1m: 2.1,
      volumeRatio5m: 2.8,
      oiGrowth15m: 5.6,
      oiNotional: 12_000_000,
      funding: 0.0008,
      basis: 0.12,
      globalLongShortRatio: 1.08,
      topTraderLongShortRatio: 1.14,
      takerBuySellRatio: 1.31,
      spotAvailable: true,
      spotChange15m: 4.2,
      spotVolumeRatio5m: 2.2,
      perpSpotDivergencePct: 0.4,
      distanceFromHighPct: -1.8,
      distanceFromLowPct: 12.4,
      priorRunUpPct: 11.2,
      supportBreak: false,
      lowerStructure: false,
      breakout20: true,
      quoteVolume: 98_000_000,
      marketCapUsd: 210_000_000,
      fdvUsd: 310_000_000,
      alertCounts: { pump: 2, crash: 0, squeeze: 0, total: 2 },
    },
    observedAt,
    expiresAt: "2026-09-04T13:00:00.000Z",
    selectedAt: "2026-09-04T01:01:00.000Z",
    updatedAt: "2026-09-04T01:02:00.000Z",
    ai: {
      symbol,
      summary: `${symbol} 量价与持仓量同步增强。`,
      rationale: "现货与永续方向一致。",
      confirmation: "观察成交量能否维持。",
      invalidation: "跌破启动结构后失效。",
      risk: "急涨后的回撤风险。",
      validFor: "未来 2 小时",
    },
    ...overrides,
  };
}

const healthyMeta = {
  fingerprint: "fixture",
  lastScanAt: "2026-09-04T01:02:00.000Z",
  lastSuccessAt: "2026-09-04T01:02:00.000Z",
  stale: false,
  aiProvider: "minimax",
  aiGeneratedAt: "2026-09-04T01:02:00.000Z",
  aiError: null,
};

const healthyHeartbeat = {
  worker: "opportunity",
  status: "ok",
  detail: "扫描完成",
  lastError: null,
  lastErrorAt: null,
  lastSuccessAt: "2026-09-04T01:02:00.000Z",
  updatedAt: "2026-09-04T01:02:00.000Z",
};

try {
  const source = readFileSync(componentPath, "utf8");
  assert.match(source, /做单决策/);
  assert.match(source, /snap-x snap-mandatory/);
  assert.match(source, /AI 解释暂不可用/);

  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentPath,
  }).outputText;
  writeFileSync(runtimePath, output, "utf8");

  const { MarketOpportunityPanel } = await import(
    `${pathToFileURL(runtimePath).href}?run=${Date.now()}`
  );

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(MarketOpportunityPanel, {
        opportunities: [],
        meta: healthyMeta,
        heartbeat: healthyHeartbeat,
        nowMs: Date.parse("2026-09-04T01:03:00.000Z"),
      }),
    );
  });
  assert.match(renderedText(renderer.toJSON()), /暂无满足条件的短线机会/);

  const first = decision("AAAUSDT", 1);
  const second = decision("BBBUSDT", 2);
  const third = decision("CCCUSDT", 3);
  const fourth = decision("DDDUSDT", 4);
  const fifth = decision("EEEUSDT", 5);
  const topFive = [first, second, third, fourth, fifth];
  await act(async () => {
    renderer.update(
      React.createElement(MarketOpportunityPanel, {
        opportunities: topFive,
        meta: healthyMeta,
        heartbeat: healthyHeartbeat,
        nowMs: Date.parse("2026-09-04T01:03:00.000Z"),
      }),
    );
  });
  assert.match(renderedText(renderer.toJSON()), /5 个候选/);
  assert.match(renderedText(renderer.toJSON()), /1 \/ 5/);
  const desktopStrip = renderer.root.findByProps({
    "data-opportunity-strip": true,
  });
  assert.equal(
    desktopStrip.findAll((node) => node.props["data-opportunity-selector"]).length,
    5,
  );
  assert.equal(
    renderer.root.findAllByProps({ "data-opportunity-card": true }).length,
    5,
  );
  const mobilePager = renderer.root.find(
    (node) => typeof node.props.className === "string" &&
      node.props.className.includes("snap-x snap-mandatory"),
  );
  assert.equal(mobilePager.props.role, "region");
  assert.equal(mobilePager.props.tabIndex, 0);
  await act(async () => {
    mobilePager.props.onScroll({ currentTarget: { clientWidth: 390, scrollLeft: 390 } });
  });
  assert.match(renderedText(renderer.toJSON()), /2 \/ 5/);

  const firstDesktopDetail = renderedText(renderer.root.findByProps({
    "data-opportunity-detail": "AAAUSDT",
  }));
  assert.match(firstDesktopDetail, /覆盖 86%/);
  assert.match(firstDesktopDetail, /观察成交量能否维持/);
  assert.match(firstDesktopDetail, /跌破启动结构后失效/);
  assert.match(firstDesktopDetail, /急涨后的回撤风险/);
  const fullDesktopDetail = renderedText(renderer.root.findByProps({
    "data-opportunity-full-detail": "AAAUSDT",
  }));
  assert.match(fullDesktopDetail, /AAAUSDT 量价与持仓量同步增强/);
  assert.match(fullDesktopDetail, /现货与永续方向一致/);

  const secondSelector = renderer.root.findByProps({
    "data-opportunity-selector": "BBBUSDT",
  });
  await act(async () => secondSelector.props.onClick());
  assert.equal(
    renderer.root.findByProps({ "data-opportunity-selector": "BBBUSDT" }).props[
      "aria-pressed"
    ],
    true,
  );

  await act(async () => {
    renderer.update(
      React.createElement(MarketOpportunityPanel, {
        opportunities: [second, first],
        meta: healthyMeta,
        heartbeat: healthyHeartbeat,
        nowMs: Date.parse("2026-09-04T01:04:00.000Z"),
      }),
    );
  });
  assert.equal(
    renderer.root.findByProps({ "data-opportunity-selector": "BBBUSDT" }).props[
      "aria-pressed"
    ],
    true,
  );
  assert.match(
    renderedText(renderer.root.findByProps({ "data-opportunity-detail": "BBBUSDT" })),
    /BBBUSDT/,
  );

  await act(async () => {
    renderer.update(
      React.createElement(MarketOpportunityPanel, {
        opportunities: [decision("FAILUSDT", 1, { ai: null })],
        meta: { ...healthyMeta, stale: true, aiError: "quota exceeded" },
        heartbeat: { ...healthyHeartbeat, status: "error" },
        nowMs: Date.parse("2026-09-04T01:10:00.000Z"),
      }),
    );
  });
  const failedText = renderedText(renderer.toJSON());
  assert.match(failedText, /数据可能已过期/);
  assert.match(failedText, /AI 解释暂不可用/);
  assert.match(failedText, /5m 成交显著放大/);

  console.log("ok - market opportunity panel preserves selection and fallbacks");
} finally {
  if (renderer) await act(async () => renderer.unmount());
  rmSync(runtimePath, { force: true });
}
