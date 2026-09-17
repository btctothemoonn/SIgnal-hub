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
    ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    scope: "1h",
    windowStart: "2026-09-18T03:00:00.000Z",
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

test("SSR defaults to the hourly report and labels historical alert changes", async () => {
  const html = await markup({
    "1h": brief(),
    "24h": brief({ scope: "24h", headline: "全天报告" }),
  });
  assert.match(html, /异动速览/);
  assert.match(html, /小时报告/);
  assert.doesNotMatch(html, /全天报告/);
  assert.match(html, /aria-pressed="true"[^>]*>1h<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>24h<\/button>/);
  assert.match(html, /3 币种/);
  assert.match(html, /18 次预警/);
  assert.match(html, /暴涨 9/);
  assert.match(html, /暴跌 3/);
  assert.match(html, /轧空 6/);
  assert.match(html, /BTCUSDT/);
  assert.match(html, /暴涨 3/);
  assert.match(html, /最近触发/);
  assert.match(html, /\+7\.25%/);
  assert.match(html, /数据截至/);
  assert.match(html, /dateTime="2026-09-18T04:00:00.000Z"/);
  assert.match(html, /生成/);
  assert.match(html, /dateTime="2026-09-18T04:01:00.000Z"/);
  assert.match(html, /检查/);
  assert.match(html, /13 分钟前/);
  assert.match(html, /缓存/);
  assert.doesNotMatch(html, /98,?765\.43|实时价格|10\s*分钟更新/);
});

test("caps the compact report at five rows and two risks without padding short reports", async () => {
  const html = await markup({
    "1h": brief({
      items: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((symbol) => item(symbol)),
      risks: ["第一条风险", "第二条风险", "第三条风险"],
    }),
  });
  assert.equal((html.match(/data-market-brief-symbol=/g) ?? []).length, 5);
  assert.match(html, /EEE/);
  assert.doesNotMatch(html, /FFF|第三条风险/);
  assert.match(html, /第一条风险/);
  assert.match(html, /第二条风险/);
  const short = await markup({ "1h": brief({ items: [item("ONLYUSDT")] }) });
  assert.equal((short.match(/data-market-brief-symbol=/g) ?? []).length, 1);
});

test("missing optional snapshots have an explicit unavailable state", async () => {
  for (const snapshots of [undefined, {}, { "24h": brief({ scope: "24h" }) }]) {
    const html = await markup(snapshots);
    assert.match(html, /速览尚未生成/);
    assert.doesNotMatch(html, /animate-spin|加载中|小时报告/);
  }
});

for (const [status, expected] of [
  ["pending", /速览待生成/],
  ["error", /速览生成失败/],
  ["empty", /本时段暂无异动预警/],
]) {
  test(`${status} without a cached report does not pretend to load forever`, async () => {
    const html = await markup({
      "1h": brief({ status, generatedAt: null, headline: "", items: [], risks: [] }),
    });
    assert.match(html, expected);
    assert.doesNotMatch(html, /animate-spin|加载中|data-market-brief-symbol=/);
  });
}

for (const [status, expected] of [
  ["pending", /更新待完成/],
  ["error", /更新失败/],
]) {
  test(`${status} keeps the previous report visible and labels it as cached`, async () => {
    const html = await markup({ "1h": brief({ status, stale: true }) });
    assert.match(html, expected);
    assert.match(html, /缓存/);
    assert.match(html, /数据可能已过期/);
    assert.match(html, /小时报告/);
    assert.match(html, /BTCUSDT/);
    assert.match(html, /短时波动扩大/);
  });
}

test("freshness uses checkedAt with a strict 195-minute limit, never generatedAt", async () => {
  const cached = brief({
    generatedAt: "2026-09-17T01:00:00.000Z",
    checkedAt: "2026-09-18T01:00:00.000Z",
    stale: false,
  });
  assert.doesNotMatch(await markup({ "1h": cached }), /数据可能已过期/);
  assert.match(await markup({ "1h": {
    ...cached, checkedAt: "2026-09-18T00:59:59.999Z",
  } }), /数据可能已过期/);
  assert.match(await markup({ "1h": { ...cached, stale: true } }), /数据可能已过期/);
  assert.match(await markup({ "1h": brief({ stale: true }) }), /数据可能已过期/);
  for (const checkedAt of [null, "invalid-date"]) {
    assert.match(await markup({ "1h": brief({ checkedAt }) }), /数据可能已过期/);
    assert.doesNotMatch(await markup({ "1h": brief({
      checkedAt, status: "pending", generatedAt: null, headline: "", items: [], risks: [],
    }) }), /数据可能已过期/);
  }
});

test("the existing parent clock marks an unchanged report stale when all workers stop", async () => {
  const Component = await loadComponent();
  const briefs = { "1h": brief({ checkedAt: "2026-09-18T01:00:00.000Z" }) };
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Component, { briefs, nowMs }));
    });
    assert.doesNotMatch(renderedText(renderer.toJSON()), /数据可能已过期/);
    await act(async () => renderer.update(React.createElement(Component, {
      briefs, nowMs: nowMs + 1,
    })));
    assert.match(renderedText(renderer.toJSON()), /数据可能已过期/);
    assert.match(renderedText(renderer.toJSON()), /小时报告/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("unknown change and invalid times never render as zero or Invalid Date", async () => {
  const html = await markup({
    "1h": brief({
      generatedAt: null,
      checkedAt: "not-a-date",
      windowEnd: "not-a-date",
      items: [
        item("NULLUSDT", { latestAt: "not-a-date", latestChangePct: null }),
        item("DOWNUSDT", { latestChangePct: -3.5, direction: "down" }),
        item("ZEROUSDT", { latestChangePct: 0, direction: "squeeze" }),
        item("NANUSDT", { latestChangePct: NaN }),
      ],
    }),
  });
  assert.match(html, /n\/a/);
  assert.match(html, /-3\.50%/);
  assert.match(html, /\+0\.00%/);
  assert.doesNotMatch(html, /Invalid Date|not-a-date|NaN%/);
});

test("latest change identifies the alert trigger and never implies a scope-wide return", async () => {
  const Component = await loadComponent();
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Component, {
        briefs: {
          "1h": brief(),
          "24h": brief({ scope: "24h", items: [item("DAYUSDT", { latestChangePct: -1.25 })] }),
        },
        nowMs,
      }));
    });
    const changes = () => renderer.root.findAllByProps({ "data-market-brief-change": true });
    assert.equal(changes().length, 3);
    assert.match(changes()[0].props.title, /最近一次预警的触发涨跌幅/);
    assert.match(changes()[0].props.title, /非所选时段累计涨跌幅/);
    await act(async () => renderer.root.findAllByType("button")
      .find((node) => renderedText(node) === "24h").props.onClick());
    assert.equal(changes().length, 1);
    assert.match(renderedText(changes()[0]), /-1\.25%/);
    assert.match(changes()[0].props.title, /非所选时段累计涨跌幅/);
    assert.doesNotMatch(renderedText(changes()[0]), /24h|1h|实时/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("scope selection survives refreshed props and never borrows the other scope's report", async () => {
  const Component = await loadComponent();
  let renderer;
  const element = (briefs) => React.createElement(Component, { briefs, nowMs });
  try {
    await act(async () => {
      renderer = TestRenderer.create(element({
        "1h": brief(),
        "24h": brief({ scope: "24h", headline: "全天报告", items: [item("DAYUSDT")] }),
      }));
    });
    const button = (label) => renderer.root.findAllByType("button")
      .find((node) => renderedText(node) === label);
    await act(async () => button("24h").props.onClick());
    assert.equal(button("24h").props["aria-pressed"], true);
    assert.equal(button("1h").props["aria-pressed"], false);
    assert.match(renderedText(renderer.toJSON()), /全天报告/);
    assert.doesNotMatch(renderedText(renderer.toJSON()), /小时报告|BTCUSDT/);
    await act(async () => renderer.update(element({
      "1h": brief(),
      "24h": brief({ scope: "24h", headline: "全天报告已更新" }),
    })));
    assert.match(renderedText(renderer.toJSON()), /全天报告已更新/);
    await act(async () => renderer.update(element({ "1h": brief() })));
    assert.equal(button("24h").props["aria-pressed"], true);
    assert.match(renderedText(renderer.toJSON()), /速览尚未生成/);
    assert.doesNotMatch(renderedText(renderer.toJSON()), /小时报告/);
    await act(async () => button("1h").props.onClick());
    assert.match(renderedText(renderer.toJSON()), /小时报告/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("long content stays in a legible wrapping band with two-line risks", async () => {
  const Component = await loadComponent();
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Component, {
        briefs: { "1h": brief({ items: [item("VERYLONGSYMBOL".repeat(8))] }) },
        nowMs,
      }));
    });
    const section = renderer.root.findByType("section");
    assert.match(section.props.className, /min-w-0/);
    assert.match(section.props.className, /w-full/);
    assert.doesNotMatch(section.props.className, /rounded|shadow|\bborder\b(?!-)/);
    assert.match(renderer.root.findByType("header").props.className, /flex-wrap/);
    const row = renderer.root.find((node) => typeof node.props["data-market-brief-symbol"] === "string");
    assert.match(row.props.className, /min-w-0/);
    assert.match(row.findAllByType("strong")[0].props.className, /text-\[13px\]/);
    const headline = renderer.root.findByProps({ title: "小时报告：上行异动集中，留意反复。" });
    assert.match(headline.props.className, /text-sm/);
    const reason = row.findByType("p");
    assert.match(reason.props.className, /text-xs/);
    assert.match(reason.props.className, /leading-5/);
    const counts = row.findAllByType("div").find((node) => node.props.className.includes("col-span-full"));
    assert.match(counts.props.className, /text-\[11px\]/);
    const totals = renderer.root.findAllByType("div").find((node) =>
      node.props.className.includes("flex") && renderedText(node).includes("3 币种"),
    );
    assert.match(totals.props.className, /text-\[11px\]/);
    const risks = renderer.root.findAllByProps({ "data-market-brief-risk": true });
    assert.equal(risks.length, 2);
    risks.forEach((risk) => {
      assert.match(risk.props.className, /line-clamp-2/);
      assert.doesNotMatch(risk.props.className, /truncate|whitespace-nowrap/);
    });
    assert.equal(renderer.root.findAllByType("details").length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
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
    briefs: { "1h": brief() },
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
  assert.match(legacyHtml, /速览尚未生成/);
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
    briefs: { "1h": brief(), "24h": brief({ scope: "24h", headline: "全天原报告" }) },
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
      .find((node) => renderedText(node) === "24h").props.onClick());
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
