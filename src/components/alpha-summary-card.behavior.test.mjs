import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));

function moduleUrl(path, extra = "") {
  const output = ts.transpileModule(readFileSync(path, "utf8") + extra, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText.replace(/from "([^"]+)"/g, (_, specifier) => {
    if (specifier.startsWith("./")) {
      const target = join(dirname(path), specifier + (specifier.endsWith(".tsx") ? "" : ".tsx"));
      if (existsSync(target)) return `from "${moduleUrl(target)}"`;
    }
    return `from "${pathToFileURL(require.resolve(specifier)).href}"`;
  });
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const { AlphaSummaryCard, AlphaSummaryScopeResult } = await import(moduleUrl(
  join(directory, "alpha-summary-card.tsx"), "\nexport { AlphaSummaryScopeResult };\n",
));
const { SignalSummaryEvents } = await import(moduleUrl(join(directory, "signal-summary-events.tsx")));

function event(overrides = {}) {
  return {
    title: "协议升级进入测试阶段",
    change: "维护者披露公开测试网的启动日期。",
    whyTrack: "测试结果将影响正式升级节奏。",
    evidenceType: "reported",
    watch: ["观察测试网启动公告与首批运行记录。"],
    invalidate: ["若团队撤回日程，停止跟踪当前窗口。"],
    sourceIds: ["tg-1"],
    sources: [{ id: "tg-1", source: "Telegram", author: "研究频道", createdAt: "2026-10-01T03:00:00Z", link: "https://t.me/research/123" }],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    success: true, status: "generated", configured: true,
    period: { key: "signals-12h", scope: "12h", audience: "signals", inputBudgetVersion: 1, label: "最近 12 小时", startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-01T12:00:00Z", timeZone: "Asia/Shanghai" },
    generatedAt: "2026-10-01T04:15:00Z", lastAttemptAt: "2026-10-02T01:20:00Z", model: "test-model",
    itemCount: 2, sourceCounts: { telegram: 1, x: 1 },
    coverage: { candidateCount: 50, selectedCount: 2, startAt: "2026-10-01T03:00:00Z", endAt: "2026-10-01T04:00:00Z" },
    summary: {
      headline: "市场观点集中在算力与加密资产。",
      consensus: ["旧版共识"], watchlist: ["旧版列表"], risks: ["旧版风险"],
      authors: [{ name: "研究频道", sourceCount: 2, coreView: "仍需等待正式公告", alpha: ["公告决定后续节奏"], watch: ["公开测试"] }], events: [event()],
      stocks: [
        { target: "NVDA", opinions: [{ author: "@alice", view: "看好算力需求。" }, { author: "@bob", view: "估值仍需观察。" }] },
        { target: "TSLA", opinions: [{ author: "@alice", view: "等待交付数据。" }] },
      ],
      crypto: [{ target: "BTC", opinions: [{ author: "@carol", view: "关注资金流入。" }] }],
    },
    error: null,
    ...overrides,
  };
}

function markup(value, audience = "signals") {
  return renderToStaticMarkup(React.createElement(AlphaSummaryScopeResult, { audience, compact: true, scope: "12h", snapshot: value, manualMessage: null }));
}

function eventsMarkup(value) {
  return renderToStaticMarkup(React.createElement(SignalSummaryEvents, {
    events: value.summary.events, history: value.summary.eventHistory, timeZone: value.period.timeZone,
  }));
}

function tracking(state, id, overrides = {}) {
  return {
    id, state, firstSeenAt: "2026-10-01T03:00:00Z", lastSeenAt: "2026-10-02T04:00:00Z",
    lastChangedAt: "2026-10-02T04:00:00Z", previousGeneratedAt: "2026-10-01T04:15:00Z",
    newSourceIds: [], note: "本轮没有可核实的新进展，继续观察。", ...overrides,
  };
}

test("Signal continuity displays changed events first and retains each event's stable identity", () => {
  const value = snapshot();
  value.summary.events = [
    event({ title: "持续观察的旧事件", tracking: tracking("continuing", "event-old") }),
    event({ title: "本轮新增事件", tracking: tracking("new", "event-new") }),
    event({ title: "有进展的旧事件", tracking: tracking("updated", "event-updated") }),
    event({ title: "被来源撤回的事件", tracking: tracking("invalidated", "event-invalid", { note: "团队撤回了原定计划。" }) }),
  ];
  const html = eventsMarkup(value);
  for (const state of ["新增", "有新进展", "继续观察", "失效"]) assert.ok(html.includes(state), state);
  assert.ok(html.indexOf("本轮新增事件") < html.indexOf("持续观察的旧事件"));
  assert.ok(html.indexOf("有进展的旧事件") < html.indexOf("持续观察的旧事件"));
  assert.ok(html.indexOf("被来源撤回的事件") < html.indexOf("持续观察的旧事件"));
  assert.match(html, /data-signal-event-id="event-updated"/);
  assert.match(html, /团队撤回了原定计划/);
  assert.match(html, /首次跟踪[：:]\s*2026\/10\/01 11:00/);
});

test("Signal progress distinguishes newly cited originals while keeping earlier evidence", () => {
  const value = snapshot();
  value.summary.events = [event({
    tracking: tracking("updated", "event-upgrade", { newSourceIds: ["x-new"], note: "团队发布了首轮测试结果。" }),
    sourceIds: ["tg-1", "x-new"],
    sources: [
      event().sources[0],
      { id: "x-new", source: "X", author: "@maintainer", createdAt: "2026-10-02T03:00:00Z", link: "https://x.com/maintainer/status/456" },
    ],
  })];
  const html = eventsMarkup(value);
  assert.match(html, /团队发布了首轮测试结果/);
  assert.match(html, /href="https:\/\/t\.me\/research\/123"/);
  assert.match(html, /href="https:\/\/x\.com\/maintainer\/status\/456"/);
  assert.equal((html.match(/data-signal-new-evidence/g) ?? []).length, 1);
});

test("Signal events omitted from the current selection remain accessible as history without being labelled invalidated", () => {
  const value = snapshot();
  value.summary.events = [event({ title: "当前事件", tracking: tracking("new", "active") })];
  value.summary.eventHistory = [
    value.summary.events[0],
    event({ title: "此前仍在观察的事件", tracking: tracking("continuing", "history") }),
  ];
  const html = eventsMarkup(value);
  assert.match(html, /data-signal-event-history/);
  assert.match(html, /此前仍在观察的事件/);
  assert.equal((html.match(/data-signal-event-id="active"/g) ?? []).length, 1);
  const history = html.slice(html.indexOf("data-signal-event-history"));
  assert.doesNotMatch(history, /失效|<details[^>]*\sopen(?:=|>)/);
});

test("Signal events show their evidence class, observation conditions, and original sources", () => {
  const html = eventsMarkup(snapshot());
  assert.match(html, /协议升级进入测试阶段/);
  assert.match(html, /维护者披露公开测试网/);
  assert.match(html, /测试结果将影响正式升级节奏/);
  assert.match(html, /来源陈述/);
  assert.match(html, /观察测试网启动公告/);
  assert.match(html, /若团队撤回日程/);
  assert.match(html, /href="https:\/\/t\.me\/research\/123"/);
  assert.match(html, /Telegram/);
  assert.match(html, /研究频道/);
  assert.match(html, /2026\/10\/01 11:00/);
  assert.doesNotMatch(html, /旧版共识|旧版列表|旧版风险/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
});

test("Signal event classes distinguish author opinion and AI inference from reported statements", () => {
  const value = snapshot();
  value.summary.events = [event({ title: "作者预测", evidenceType: "opinion" }), event({ title: "推断候选", evidenceType: "inference" })];
  const html = eventsMarkup(value);
  assert.match(html, /作者观点/);
  assert.match(html, /AI 推断/);
  assert.doesNotMatch(html, /已核实|已证实/);
});

test("Signal tracking cards never exceed five events", () => {
  const value = snapshot();
  value.summary.events = Array.from({ length: 7 }, (_, index) => event({ title: `跟踪事件 ${index + 1}` }));
  const html = eventsMarkup(value);
  assert.match(html, /跟踪事件 5/);
  assert.doesNotMatch(html, /跟踪事件 6|跟踪事件 7/);
});

test("Legacy summaries keep their headline and honestly disclose missing target classifications", () => {
  const value = snapshot();
  delete value.summary.stocks;
  delete value.summary.crypto;
  for (const audience of ["signals", "stocks"]) {
    const html = markup(value, audience);
    assert.match(html, /市场观点集中在算力与加密资产/);
    assert.match(html, /旧版总结正在更新标的分类/);
    assert.doesNotMatch(html, /本期暂无相关标的观点|旧版共识|旧版列表|旧版风险|仍需等待正式公告|协议升级进入测试阶段/);
  }
});

test("Initial summary loading never claims that there are no target opinions", () => {
  const initial = markup(null);
  assert.match(initial, /读取|加载/);
  assert.doesNotMatch(initial, /本期暂无相关标的观点|旧版总结正在更新标的分类/);
});

test("New summaries with empty categories report the absence of target opinions", () => {
  const value = snapshot();
  value.summary.stocks = [];
  value.summary.crypto = [];
  const html = markup(value);
  assert.equal((html.match(/本期暂无相关标的观点/g) ?? []).length, 2);
  assert.doesNotMatch(html, /旧版总结正在更新标的分类|暂无值得跟踪的事件/);
});

test("An absent category remains pending even when the other category is explicitly empty", () => {
  const value = snapshot();
  delete value.summary.stocks;
  value.summary.crypto = [];
  const html = markup(value);
  const stocks = html.match(/<section[^>]*aria-label="股票"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  const crypto = html.match(/<section[^>]*aria-label="币圈"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(stocks, "stocks category should be visible");
  assert.ok(crypto, "crypto category should be visible");
  assert.match(stocks, /旧版总结正在更新标的分类/);
  assert.doesNotMatch(stocks, /本期暂无相关标的观点/);
  assert.match(crypto, /本期暂无相关标的观点/);
});

test("Signal unknown successful generation time is labelled honestly", () => {
  const html = markup(snapshot({ generatedAt: null, status: "error", success: false, error: "模型超时" }));
  assert.match(html, /上次成功生成[：:]\s*未知/);
  assert.match(html, /本次尝试[：:]\s*2026\/10\/02 09:20/);
});

for (const audience of ["signals", "stocks"]) {
  test(`${audience} presents a single summary followed by target-grouped stock and crypto opinions`, () => {
    const html = markup(snapshot(), audience);
    assert.equal((html.match(/市场观点集中在算力与加密资产/g) ?? []).length, 1);
    assert.match(html, /总结/);
    const stocks = html.match(/<section[^>]*aria-label="股票"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    const crypto = html.match(/<section[^>]*aria-label="币圈"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(stocks, "stocks category should be visible");
    assert.ok(crypto, "crypto category should be visible");
    assert.match(stocks, /NVDA[\s\S]*@alice[\s\S]*看好算力需求[\s\S]*@bob[\s\S]*估值仍需观察/);
    assert.match(stocks, /TSLA[\s\S]*@alice[\s\S]*等待交付数据/);
    assert.doesNotMatch(stocks, /BTC|关注资金流入/);
    assert.match(crypto, /BTC[\s\S]*@carol[\s\S]*关注资金流入/);
    assert.doesNotMatch(crypto, /NVDA|TSLA|看好算力需求/);
    assert.doesNotMatch(html, /核心共识|Watchlist|旧版共识|旧版列表|旧版风险|来源观点|仍需等待正式公告|协议升级进入测试阶段|<details/);
    if (audience === "signals") assert.match(html, /上次成功生成/);
    else assert.doesNotMatch(html, /上次成功生成|本次尝试/);
  });
}

test("Signal retained-summary errors and real sample coverage stay visible with header metadata hidden", async () => {
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const timers = [];
  globalThis.window = { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() { return 99; }, clearInterval() {} };
  globalThis.fetch = async () => ({ json: async () => snapshot({ status: "error", success: false, error: "模型超时" }) });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(AlphaSummaryCard, { audience: "signals", showHeaderMeta: false })); });
    await act(async () => { timers.shift()(); });
    const text = (node) => typeof node === "string" ? node : node?.children?.map(text).join("") ?? "";
    const result = text(renderer.toJSON());
    assert.match(result, /更新失败，正在显示上次总结/);
    assert.match(result, /模型超时/);
    assert.match(result, /上次成功生成[：:]\s*2026\/10\/01 12:15/);
    assert.match(result, /本次尝试[：:]\s*2026\/10\/02 09:20/);
    assert.match(result, /2026\/10\/01 11:00[\s\S]*2026\/10\/01 12:00/);
    assert.match(result, /2 条[\s\S]*50 条/);
    assert.match(result, /市场观点集中在算力与加密资产/);
    assert.match(result, /NVDA[\s\S]*@alice[\s\S]*看好算力需求/);
    assert.doesNotMatch(result, /协议升级进入测试阶段/);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    globalThis.window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});

test("Signal optional header success time also includes the date and uses the summary timezone", async () => {
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const timers = [];
  globalThis.window = { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() { return 99; }, clearInterval() {} };
  globalThis.fetch = async () => ({ json: async () => snapshot() });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(AlphaSummaryCard, { audience: "signals" })); });
    await act(async () => { timers.shift()(); });
    const text = (node) => typeof node === "string" ? node : node?.children?.map(text).join("") ?? "";
    const spans = renderer.root.findAllByType("span");
    const generationMeta = spans.find((node) => node.children.some((child) => child?.type === "span" && ["更新", "成功"].includes(text(child))));
    assert.ok(generationMeta, "optional header must identify the successful generation time");
    assert.match(text(generationMeta), /2026\/10\/01 12:15/);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    globalThis.window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});
