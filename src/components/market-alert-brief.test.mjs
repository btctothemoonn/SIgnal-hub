import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";
import { MARKET_BRIEF_STALE_AFTER_MS } from "../lib/market-alert-brief-types.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const componentPath = join(directory, "market-alert-brief.tsx");
const nowMs = Date.parse("2026-09-18T04:15:00.000Z");

function moduleUrl(path, imports = {}) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
  }).outputText.replace(/from "([^"]+)"/g, (_, specifier) =>
    `from "${imports[specifier] ?? pathToFileURL(require.resolve(specifier)).href}"`,
  );
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function loadComponent() {
  assert.ok(existsSync(componentPath), "the market alert brief component must exist");
  return (await import(moduleUrl(componentPath))).MarketAlertBrief;
}

function item(symbol, overrides = {}) {
  return {
    symbol,
    pump: 3,
    crash: 1,
    squeeze: 2,
    total: 6,
    latestAt: "2026-09-18T03:58:00.000Z",
    latestPrice: 98765.43,
    latestChangePct: 7.25,
    maxLevel: 2,
    direction: "up",
    reason: `${symbol} 成交放量，连续触发。`,
    tracking: {
      state: "new",
      observedAt: "2026-09-18T04:00:00.000Z",
      evidence: ["15 分钟涨幅 +2.30%，方向延续。", "5 分钟量比 2.10，放量得到确认。"],
      nextWatch: "观察 5 分钟量比能否保持 1.50 以上，以及 15 分钟涨幅是否仍为正。",
      dropIf: "若 15 分钟涨幅转负，或缓存超过 15 分钟未更新，移出跟踪。",
      signalKey: "up:volume-confirmed",
    },
    ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    schemaVersion: 2,
    scope: "3h",
    windowStart: "2026-09-18T01:00:00.000Z",
    windowEnd: "2026-09-18T04:00:00.000Z",
    generatedAt: "2026-09-18T04:01:00.000Z",
    checkedAt: "2026-09-18T04:02:00.000Z",
    model: "MiniMax-M3",
    status: "ready",
    stale: false,
    headline: "小时报告：上行异动集中，留意反复。",
    totals: { symbols: 3, pump: 9, crash: 3, squeeze: 6, total: 18 },
    items: [item("BTCUSDT"), item("ETHUSDT"), item("SOLUSDT")],
    risks: ["短时波动扩大。", "多空信号交错。"],
    changes: { added: ["BTCUSDT"], downgraded: ["OLDUSDT"] },
    ...overrides,
  };
}

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(renderedText).join("") ?? "";
}

async function markup(briefs) {
  const Component = await loadComponent();
  return renderToStaticMarkup(React.createElement(Component, { briefs, nowMs }));
}

test("defaults to a three-candidate tracking list with evidence and observation conditions", async () => {
  const html = await markup({ "3h": brief(), "24h": brief({ scope: "24h", headline: "全天报告" }) });
  assert.match(html, /异动跟踪/);
  assert.match(html, /aria-pressed="true"[^>]*>跟踪清单<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>24h 回顾<\/button>/);
  assert.match(html, /新出现/);
  assert.match(html, /入选理由/);
  assert.match(html, /15 分钟涨幅 \+2\.30%/);
  assert.match(html, /5 分钟量比 2\.10/);
  assert.match(html, /下一步观察/);
  assert.match(html, /量比能否保持 1\.50 以上/);
  assert.match(html, /移出条件/);
  assert.match(html, /缓存超过 15 分钟未更新/);
  assert.match(html, /指标观测/);
  assert.match(html, /本轮新增[^<]*BTCUSDT/);
  assert.match(html, /本轮已降级[^<]*OLDUSDT/);
  assert.match(html, /dateTime="2026-09-18T04:00:00.000Z"/);
  assert.match(html, /13 分钟前/);
  assert.doesNotMatch(html, /全天报告|98,?765\.43|实时价格/);
});

test("tracking never pads a short list and caps candidates at three", async () => {
  const html = await markup({ "3h": brief({
    items: ["AAA", "BBB", "CCC", "DDD", "EEE"].map((symbol) => item(symbol)),
    risks: ["第一条风险", "第二条风险", "第三条风险"],
  }) });
  assert.equal((html.match(/data-market-brief-symbol=/g) ?? []).length, 3);
  assert.match(html, /CCC/);
  assert.doesNotMatch(html, /DDD|EEE|第三条风险/);
  const short = await markup({ "3h": brief({ items: [item("ONLYUSDT")] }) });
  assert.equal((short.match(/data-market-brief-symbol=/g) ?? []).length, 1);
});

test("tracking states distinguish stable continuation from strengthening and missing evidence", async () => {
  for (const [state, label] of [["new", "新出现"], ["strengthening", "持续增强"], ["continuing", "持续跟踪"], ["waiting", "等待确认"]]) {
    const html = await markup({ "3h": brief({ items: [item("STATE", {
      tracking: { ...item("STATE").tracking, state },
    })] }) });
    assert.match(html, new RegExp(label));
  }
  const malformed = await markup({ "3h": brief({ items: [item("OLD", { tracking: undefined })] }) });
  assert.doesNotMatch(malformed, /data-market-brief-symbol=/);
  assert.match(malformed, /暂无证据充分、值得继续跟踪的异动/);
});

test("hourly strength and short-term confirmation are shown as separate dimensions", async () => {
  for (const [trend, confirmation, trendLabel, confirmationLabel] of [
    ["strong_up", "consolidating", "小时强势", "短线整理"],
    ["strong_down", "confirmed", "小时弱势", "短线已确认"],
    ["neutral", "waiting", "趋势待确认", "短线待确认"],
  ]) {
    const html = await markup({ "3h": brief({ items: [item("TREND", {
      tracking: { ...item("TREND").tracking, state: "waiting", trend, confirmation },
    })] }) });
    assert.match(html, new RegExp(trendLabel));
    assert.match(html, new RegExp(confirmationLabel));
    assert.doesNotMatch(html, />等待确认<\/span>/);
    assert.match(html, /入选理由/);
    assert.match(html, /下一步观察/);
    assert.match(html, /移出条件/);
  }
});

test("a missing new dimension is explicitly unconfirmed instead of inferred from lifecycle", async () => {
  const trendOnly = await markup({ "3h": brief({ items: [item("PARTIAL", {
    tracking: { ...item("PARTIAL").tracking, state: "strengthening", trend: "strong_up" },
  })] }) });
  assert.match(trendOnly, /小时强势/);
  assert.match(trendOnly, /短线待确认/);
  const confirmationOnly = await markup({ "3h": brief({ items: [item("PARTIAL", {
    tracking: { ...item("PARTIAL").tracking, confirmation: "confirmed" },
  })] }) });
  assert.match(confirmationOnly, /趋势待确认/);
  assert.match(confirmationOnly, /短线已确认/);
});

test("missing or pre-v2 reports stay pending instead of showing old frequency rankings", async () => {
  for (const snapshots of [undefined, {}, { "24h": brief({ scope: "24h" }) },
    { "1h": brief({ scope: "1h" }) }, { "3h": brief({ schemaVersion: undefined }) },
    { "3h": brief({ schemaVersion: 1 }) }]) {
    const html = await markup(snapshots);
    assert.match(html, /跟踪清单待生成/);
    assert.doesNotMatch(html, /小时报告|BTCUSDT|animate-spin|加载中/);
  }
});

test("an empty rule result states no qualifying candidates even when alerts exist", async () => {
  const html = await markup({ "3h": brief({ status: "empty", generatedAt: null, items: [], headline: "", model: null }) });
  assert.match(html, /暂无证据充分、值得继续跟踪的异动/);
  assert.match(html, /18 次预警/);
  assert.doesNotMatch(html, /本时段暂无异动预警|data-market-brief-symbol=/);
});

test("AI failure keeps current rule evidence visible and explicitly labels the fallback", async () => {
  const html = await markup({ "3h": brief({ status: "error", model: null, generatedAt: null }) });
  assert.match(html, /AI 解读暂不可用/);
  assert.match(html, /规则筛选/);
  assert.match(html, /BTCUSDT/);
  assert.match(html, /下一步观察/);
  assert.doesNotMatch(html, /保留缓存|速览生成失败/);
});

test("rule-only results and pending results make their state clear", async () => {
  const rules = await markup({ "3h": brief({ model: null, generatedAt: null }) });
  assert.match(rules, /规则筛选/);
  const pending = await markup({ "3h": brief({ status: "pending", generatedAt: null, headline: "", items: [], risks: [] }) });
  assert.match(pending, /跟踪清单待生成/);
  assert.doesNotMatch(pending, /animate-spin|data-market-brief-symbol=/);
});

test("freshness uses checkedAt and the shared deadline, never AI generation time", async () => {
  const checkedAt = new Date(nowMs - MARKET_BRIEF_STALE_AFTER_MS).toISOString();
  const cached = brief({ generatedAt: "2026-09-17T01:00:00.000Z", checkedAt, stale: false });
  assert.doesNotMatch(await markup({ "3h": cached }), /数据可能已过期/);
  assert.match(await markup({ "3h": { ...cached,
    checkedAt: new Date(nowMs - MARKET_BRIEF_STALE_AFTER_MS - 1).toISOString(),
  } }), /数据可能已过期/);
  assert.match(await markup({ "3h": { ...cached, stale: true } }), /数据可能已过期/);
  for (const invalid of [null, "invalid-date"]) {
    assert.match(await markup({ "3h": brief({ checkedAt: invalid }) }), /数据可能已过期/);
    assert.doesNotMatch(await markup({ "3h": brief({
      checkedAt: invalid, status: "pending", generatedAt: null, headline: "", items: [], risks: [],
    }) }), /数据可能已过期/);
  }
});

test("the parent clock marks unchanged tracking stale when workers stop", async () => {
  const Component = await loadComponent();
  const briefs = { "3h": brief({ checkedAt: new Date(nowMs - MARKET_BRIEF_STALE_AFTER_MS).toISOString() }) };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { briefs, nowMs })); });
    assert.doesNotMatch(renderedText(renderer.toJSON()), /数据可能已过期/);
    await act(async () => renderer.update(React.createElement(Component, { briefs, nowMs: nowMs + 1 })));
    assert.match(renderedText(renderer.toJSON()), /数据可能已过期/);
    assert.match(renderedText(renderer.toJSON()), /下一步观察/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("tracking evidence expires independently of a recent successful check", async () => {
  const Component = await loadComponent();
  const observedAt = new Date(nowMs - 19 * 60_000).toISOString();
  const briefs = { "3h": brief({
    checkedAt: new Date(nowMs).toISOString(),
    items: [item("AGING", { tracking: { ...item("AGING").tracking, observedAt } })],
  }) };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { briefs, nowMs })); });
    assert.doesNotMatch(renderedText(renderer.toJSON()), /数据可能已过期/);
    await act(async () => renderer.update(React.createElement(Component, { briefs, nowMs: nowMs + 2 * 60_000 })));
    assert.match(renderedText(renderer.toJSON()), /数据可能已过期/);
    assert.match(renderedText(renderer.toJSON()), /检查 2 分钟前/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("invalid, future, or expired candidate timestamps cannot appear fresh", async () => {
  for (const observedAt of ["invalid-date", new Date(nowMs + 1).toISOString(),
    new Date(nowMs - MARKET_BRIEF_STALE_AFTER_MS - 1).toISOString()]) {
    const html = await markup({ "3h": brief({ checkedAt: new Date(nowMs).toISOString(),
      items: [item("INVALID", { tracking: { ...item("INVALID").tracking, observedAt } })],
    }) });
    assert.match(html, /数据可能已过期/);
    assert.doesNotMatch(html, /Invalid Date/);
  }
  const eligible = item("BOUNDARY", { latestAt: new Date(nowMs - 60 * 60_000).toISOString() });
  assert.doesNotMatch(await markup({ "3h": brief({ items: [eligible] }) }), /数据可能已过期/);
  for (const latestAt of [new Date(nowMs - 60 * 60_000 - 1).toISOString(), "invalid-date", new Date(nowMs + 1).toISOString()]) {
    assert.match(await markup({ "3h": brief({ items: [{ ...eligible, latestAt }] }) }), /数据可能已过期/);
  }
});

test("a valid trend expiry permits an older alert until the explicit deadline", async () => {
  const Component = await loadComponent();
  const expiresAt = "2026-09-18T04:34:00.000Z";
  const briefs = { "3h": brief({ checkedAt: "2026-09-18T04:15:00.000Z", items: [item("TREND", {
    latestAt: "2026-09-18T02:55:00.000Z",
    tracking: { ...item("TREND").tracking, observedAt: "2026-09-18T04:14:00.000Z",
      trend: "strong_up", confirmation: "consolidating", expiresAt },
  })] }) };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { briefs, nowMs })); });
    assert.doesNotMatch(renderedText(renderer.toJSON()), /数据可能已过期/);
    await act(async () => renderer.update(React.createElement(Component, { briefs, nowMs: Date.parse(expiresAt) - 1 })));
    assert.doesNotMatch(renderedText(renderer.toJSON()), /数据可能已过期/);
    await act(async () => renderer.update(React.createElement(Component, { briefs, nowMs: Date.parse(expiresAt) })));
    assert.match(renderedText(renderer.toJSON()), /数据可能已过期/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("invalid or overlong expiry cannot extend stale metrics or alerts", async () => {
  const current = item("EXPIRY", { latestAt: "2026-09-18T03:58:00.000Z",
    tracking: { ...item("EXPIRY").tracking, trend: "strong_up", confirmation: "consolidating",
      observedAt: "2026-09-18T04:14:00.000Z", expiresAt: "2026-09-18T04:34:00.000Z" },
  });
  for (const overrides of [
    { tracking: { ...current.tracking, expiresAt: "invalid-date" } },
    { tracking: { ...current.tracking, expiresAt: "" } },
    { tracking: { ...current.tracking, expiresAt: "2026-09-18T04:14:59.999Z" } },
    { tracking: { ...current.tracking, expiresAt: "2026-09-18T04:34:00.001Z" } },
    { latestAt: "2026-09-18T02:55:00.000Z", tracking: { ...current.tracking, trend: "neutral" } },
    { latestAt: "2026-09-18T02:55:00.000Z", tracking: { ...current.tracking, trend: undefined } },
    { latestAt: "2026-09-18T02:20:00.000Z" },
    { latestAt: "invalid-date" },
    { latestAt: "2026-09-18T04:15:00.001Z" },
    { tracking: { ...current.tracking, observedAt: "invalid-date" } },
    { tracking: { ...current.tracking, observedAt: "2026-09-18T04:15:00.001Z" } },
  ]) {
    const html = await markup({ "3h": brief({ items: [{ ...current, ...overrides }] }) });
    assert.match(html, /数据可能已过期/, JSON.stringify(overrides));
  }
});

test("tracking evidence and invalidation remain readable without truncation", async () => {
  const Component = await loadComponent();
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, {
      briefs: { "3h": brief({ items: [item("VERYLONGSYMBOL".repeat(8))] }) }, nowMs,
    })); });
    assert.match(renderer.root.findByType("section").props.className, /min-w-0/);
    assert.match(renderer.root.findByType("header").props.className, /flex-wrap/);
    const row = renderer.root.find((node) => typeof node.props["data-market-brief-symbol"] === "string");
    const details = row.findByProps({ "data-market-brief-tracking": true });
    for (const node of [details, ...details.findAll((node) => Boolean(node.props.className))]) {
      assert.doesNotMatch(node.props.className, /line-clamp|truncate|whitespace-nowrap/);
    }
    assert.match(renderedText(details), /15 分钟涨幅转负/);
    assert.equal(renderer.root.findAllByType("details").length, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("24h retrospective keeps five rows and historical trigger labels", async () => {
  const Component = await loadComponent();
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, {
      briefs: { "3h": brief(), "24h": brief({ scope: "24h", schemaVersion: undefined,
        headline: "全天报告", items: ["A", "B", "C", "D", "E", "F"].map((symbol) => item(symbol, { tracking: undefined, latestChangePct: -1.25 })),
      }) }, nowMs,
    })); });
    await act(async () => renderer.root.findAllByType("button")
      .find((node) => renderedText(node) === "24h 回顾").props.onClick());
    const rows = renderer.root.findAll((node) => typeof node.props["data-market-brief-symbol"] === "string");
    assert.equal(rows.length, 5);
    const changes = renderer.root.findAllByProps({ "data-market-brief-change": true });
    assert.equal(changes.length, 5);
    assert.match(changes[0].props.title, /最近一次预警的触发涨跌幅/);
    assert.match(changes[0].props.title, /非所选时段累计涨跌幅/);
    assert.match(renderedText(changes[0]), /-1\.25%/);
    assert.match(renderedText(renderer.toJSON()), /全天报告/);
    assert.doesNotMatch(renderedText(renderer.toJSON()), /入选理由|本轮新增/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("scope selection survives refreshed props without borrowing the other report", async () => {
  const Component = await loadComponent();
  const element = (briefs) => React.createElement(Component, { briefs, nowMs });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(element({ "3h": brief(), "24h": brief({ scope: "24h", headline: "全天报告" }) })); });
    const button = (label) => renderer.root.findAllByType("button").find((node) => renderedText(node) === label);
    await act(async () => button("24h 回顾").props.onClick());
    assert.equal(button("24h 回顾").props["aria-pressed"], true);
    await act(async () => renderer.update(element({ "3h": brief(), "24h": brief({ scope: "24h", headline: "全天报告已更新" }) })));
    assert.match(renderedText(renderer.toJSON()), /全天报告已更新/);
    await act(async () => renderer.update(element({ "3h": brief() })));
    assert.equal(button("24h 回顾").props["aria-pressed"], true);
    assert.match(renderedText(renderer.toJSON()), /回顾尚未生成/);
    assert.doesNotMatch(renderedText(renderer.toJSON()), /小时报告|BTCUSDT/);
    await act(async () => button("跟踪清单").props.onClick());
    assert.match(renderedText(renderer.toJSON()), /下一步观察/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test("the parent renders snapshot briefs above the unchanged alert workspace", async () => {
  const briefUrl = moduleUrl(componentPath);
  const parentUrl = moduleUrl(join(directory, "market-alerts-panel.tsx"), {
    "./market-alert-brief": briefUrl,
    "./market-opportunity-panel": moduleUrl(join(directory, "market-opportunity-panel.tsx")),
    "@/lib/market-alerts-health": moduleUrl(join(directory, "../lib/market-alerts-health.ts")),
  });
  const { MarketAlertsPanel } = await import(parentUrl);
  const snapshot = {
    generatedAt: "2026-09-18T04:00:00.000Z",
    latestUpdatedAt: "2026-09-18T04:00:00.000Z",
    total: 0,
    page: 1,
    limit: 100,
    events: [],
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
    marketRanking: [],
    health: { volatilityWs: null, volatilityRest: null, squeeze: null, opportunity: null },
    briefs: { "3h": brief() },
  };
  const html = renderToStaticMarkup(React.createElement(MarketAlertsPanel, { initialSnapshot: snapshot }));
  const briefIndex = html.indexOf("data-market-alert-brief=");
  const workspaceIndex = html.indexOf("data-market-alert-workspace=");
  assert.ok(briefIndex >= 0 && briefIndex < workspaceIndex, "brief must precede the full alerts workspace");
  assert.match(html, /小时报告/);
  assert.match(html, /做单决策/);
  assert.match(html, /实时预警/);
  assert.match(html, /24h 异动排行/);
  const legacyHtml = renderToStaticMarkup(React.createElement(MarketAlertsPanel, {
    initialSnapshot: { ...snapshot, briefs: undefined },
  }));
  assert.match(legacyHtml, /跟踪清单待生成/);
  assert.match(legacyHtml, /实时预警/);
});

test("existing snapshot stream updates the selected brief without extra timers or requests", async () => {
  const { MarketAlertsPanel } = await import(moduleUrl(join(directory, "market-alerts-panel.tsx"), {
    "./market-alert-brief": moduleUrl(componentPath),
    "./market-opportunity-panel": moduleUrl(join(directory, "market-opportunity-panel.tsx")),
    "@/lib/market-alerts-health": moduleUrl(join(directory, "../lib/market-alerts-health.ts")),
  }));
  const previousWindow = globalThis.window;
  const previousEventSource = globalThis.EventSource;
  const previousFetch = globalThis.fetch;
  let intervals = 0;
  let requests = 0;
  let streams = 0;
  const listeners = new Map();
  let renderer;
  const snapshot = {
    generatedAt: "2026-09-18T04:00:00.000Z",
    latestUpdatedAt: "2026-09-18T04:00:00.000Z",
    events: [], activeSignals: [], opportunities: [], marketRanking: [],
    total: 0, page: 1, limit: 100,
    opportunityMeta: {
      fingerprint: null, lastScanAt: null, lastSuccessAt: null, stale: false,
      aiProvider: null, aiGeneratedAt: null, aiError: null,
    },
    health: { volatilityWs: null, volatilityRest: null, squeeze: null, opportunity: null },
    briefs: { "3h": brief(), "24h": brief({ scope: "24h", headline: "全天原报告" }) },
  };
  try {
    globalThis.window = {
      setInterval() { intervals += 1; return 1; },
      clearInterval() {},
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.EventSource = class {
      constructor(url) { assert.equal(url, "/api/market-alerts/stream"); streams += 1; }
      addEventListener(name, handler) { listeners.set(name, handler); }
      close() {}
    };
    globalThis.fetch = async () => { requests += 1; throw new Error("unexpected request"); };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MarketAlertsPanel, { initialSnapshot: snapshot }));
    });
    const briefBand = () => renderer.root.findByProps({ "data-market-alert-brief": true });
    await act(async () => briefBand().findAllByType("button")
      .find((node) => renderedText(node) === "24h 回顾").props.onClick());
    assert.match(renderedText(briefBand()), /全天原报告/);
    await act(async () => listeners.get("market-alerts-snapshot")({
      data: JSON.stringify({
        ...snapshot,
        briefs: { ...snapshot.briefs, "24h": brief({ scope: "24h", headline: "全天推送更新" }) },
      }),
    }));
    assert.match(renderedText(briefBand()), /全天推送更新/);
    assert.doesNotMatch(renderedText(briefBand()), /全天原报告|小时报告/);
    assert.equal(intervals, 1, "only the parent's existing clock timer is allowed");
    assert.equal(streams, 1, "only the parent's existing stream is allowed");
    assert.equal(requests, 0, "mounting and switching scopes must not fetch");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.window = previousWindow;
    globalThis.EventSource = previousEventSource;
    globalThis.fetch = previousFetch;
  }
});
