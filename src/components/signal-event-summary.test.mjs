import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const component = new URL("./signal-event-summary.tsx", import.meta.url);
assert.ok(existsSync(component), "homepage needs an event-first summary view");
const runtime = new URL(`./signal-event-summary.runtime-${process.pid}.mjs`, import.meta.url);
const source = { id: "x:1", author: "@analyst", source: "X", createdAt: "2026-09-17T02:00:00Z", link: "https://x.com/analyst/status/1" };
const legacy = { headline: "已有缓存结论", authors: [{ name: "@analyst", sourceCount: 2, coreView: "来源观点内容", alpha: ["补充要点"], watch: ["等待公告"] }], consensus: ["独立来源观点一致"], risks: ["消息尚待核实"], watchlist: ["ALPHA"] };
const summary = { ...legacy, eventBrief: { version: 2, overview: ["出现新的产品进展", "市场观点存在分歧"], events: [{ topic: "ALPHA", title: "产品进展待公告确认", change: "作者发布了新进展", impact: "可能提升关注度，尚未证实", watch: ["关注官方发布时间"], evidence: "unverified", sources: [source] }], disagreements: ["另一作者认为进度不确定"], followUps: [{ subject: "ALPHA", trigger: "等待公告确认", time: "", risk: "延期会推翻预期", sources: [source] }] } };
try {
  writeFileSync(runtime, ts.transpileModule(readFileSync(component, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const { SignalEventSummary } = await import(pathToFileURL(fileURLToPath(runtime)).href);
  const html = renderToStaticMarkup(React.createElement(SignalEventSummary, { summary }));
  for (const label of ["本期速览", "重点事件", "共识与分歧", "后续关注", "来源观点", "未核实", "来源观点内容", "等待公告确认"]) assert.ok(html.includes(label), label);
  assert.ok(html.indexOf("本期速览") < html.indexOf("重点事件"));
  assert.ok(html.indexOf("重点事件") < html.indexOf("共识与分歧"));
  assert.ok(html.indexOf(">后续关注<") < html.indexOf(">来源观点<"));
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /href="https:\/\/x.com\/analyst\/status\/1"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /官方原文|已证实|<script/);
  const fallback = renderToStaticMarkup(React.createElement(SignalEventSummary, { summary: legacy }));
  assert.ok(fallback.includes("已有缓存结论"));
  assert.ok(fallback.includes("来源观点内容"));
  const empty = renderToStaticMarkup(React.createElement(SignalEventSummary, { summary: { ...legacy, authors: [], consensus: [], risks: [], watchlist: [], eventBrief: { version: 2, overview: ["没有重要变化"], events: [], disagreements: [], followUps: [] } } }));
  assert.ok(empty.includes("没有重要变化"));
  assert.doesNotMatch(empty, /重点事件|<details/);
} finally { rmSync(runtime, { force: true }); }
console.log("ok - event-first summary render, collapsed details, source links and legacy/empty states");
