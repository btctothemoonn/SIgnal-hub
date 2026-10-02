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
    summary: { headline: "有事件值得继续观察", consensus: ["旧版共识"], watchlist: ["旧版列表"], risks: ["旧版风险"], authors: [{ name: "研究频道", sourceCount: 2, coreView: "仍需等待正式公告", alpha: ["公告决定后续节奏"], watch: ["公开测试"] }], events: [event()] },
    error: null,
    ...overrides,
  };
}

function markup(value, audience = "signals") {
  return renderToStaticMarkup(React.createElement(AlphaSummaryScopeResult, { audience, compact: true, scope: "12h", snapshot: value, manualMessage: null }));
}

test("Signal events show their evidence class, observation conditions, and original sources", () => {
  const html = markup(snapshot());
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
  assert.match(html, /<details[^>]*>[\s\S]*<summary/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
});

test("Signal event classes distinguish author opinion and AI inference from reported statements", () => {
  const value = snapshot();
  value.summary.events = [event({ title: "作者预测", evidenceType: "opinion" }), event({ title: "推断候选", evidenceType: "inference" })];
  const html = markup(value);
  assert.match(html, /作者观点/);
  assert.match(html, /AI 推断/);
  assert.doesNotMatch(html, /已核实|已证实/);
});

test("Signal tracking cards never exceed five events", () => {
  const value = snapshot();
  value.summary.events = Array.from({ length: 7 }, (_, index) => event({ title: `跟踪事件 ${index + 1}` }));
  const html = markup(value);
  assert.match(html, /跟踪事件 5/);
  assert.doesNotMatch(html, /跟踪事件 6|跟踪事件 7/);
});

test("Signal legacy summaries remain readable when the cached result has no events", () => {
  const value = snapshot();
  delete value.summary.events;
  const html = markup(value);
  assert.match(html, /旧版共识/);
  assert.match(html, /旧版列表/);
  assert.match(html, /仍需等待正式公告/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /暂无值得跟踪的事件/);
});

test("Signal initial loading never claims that loaded messages have no meaningful events", () => {
  const initial = markup(null);
  assert.match(initial, /读取|加载/);
  assert.doesNotMatch(initial, /暂无值得跟踪的事件|未发现值得跟踪/);
  const value = snapshot();
  value.summary.events = [];
  assert.match(markup(value), /暂无值得跟踪的事件/);
});

test("Signal unknown successful generation time is labelled honestly", () => {
  const html = markup(snapshot({ generatedAt: null, status: "error", success: false, error: "模型超时" }));
  assert.match(html, /上次成功生成[：:]\s*未知/);
  assert.match(html, /本次尝试[：:]\s*2026\/10\/02 09:20/);
});

test("Stocks keeps its existing summary layout even if an event-shaped field is present", () => {
  const html = markup(snapshot(), "stocks");
  assert.match(html, /短线投研总结/);
  assert.match(html, /核心共识/);
  assert.match(html, /旧版共识/);
  assert.match(html, /Watchlist/);
  assert.match(html, /旧版风险/);
  assert.match(html, /来源观点/);
  assert.doesNotMatch(html, /<details|协议升级进入测试阶段|上次成功生成|本次尝试/);
});

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
    assert.match(result, /协议升级进入测试阶段/);
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
