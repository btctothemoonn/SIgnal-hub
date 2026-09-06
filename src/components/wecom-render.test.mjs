import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { alert, alerts, compileComponents, fixture, now, status, textContent } from "./wecom-test-utils.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
assert.ok(existsSync(new URL("./wecom-report-detail.tsx", import.meta.url)), "WeCom must render full structured briefing details");
const runtime = await compileComponents();
try {
  const { WecomReportView } = await runtime.load("wecom-report-detail");
  const { WecomCaAlerts } = await runtime.load("wecom-ca-alerts");
  const { WecomStatus } = await runtime.load("wecom-status");
  const detail = (report) => React.createElement(WecomReportView, { detail: { report, syncedAt: "2026-09-06T02:06:00.000Z" } });

  test("market detail preserves all six sections, structured values, identity and citation metadata", () => {
    const report = fixture("report").report;
    const html = renderToStaticMarkup(detail(report));
    for (const heading of ["焦点", "消息", "风险速览", "项目动态", "事件", "信息缺口"]) assert.ok(html.includes(heading), heading);
    const textFields = (value) => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap(textFields);
      if (value && typeof value === "object") return Object.values(value).flatMap(textFields);
      return [];
    };
    for (const value of textFields(report.briefing).filter((v) => v !== "market")) assert.ok(html.includes(value), value);
    for (const value of ["合成甲群", "小林（合成昵称）", "M0003", "来源记录缺失", "通知采集时间", "2026/09/06 08:10:00", "总结窗口", "生成时间", "同步时间", "原文仅保存在 Mac，未同步", "冻结来源存在缺口", "CA 来源不完整", "CA 聚合未裁剪"]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /查看原文|总结已截断|已核验/);
    for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  });

  test("business detail preserves all four categories, owner, unknown deadline and original snapshot wording", () => {
    const report = fixture("report-business").report;
    const html = renderToStaticMarkup(detail(report));
    for (const value of ["业务进展", "通知", "阻塞", "待办", "负责人", "截止时间", "未提供", "小林（合成昵称）", ...report.briefing.business.tasks.map((t) => t.text)]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /暂无项目|暂无事件/);
  });

  test("quotes, markup, placeholders and supplementary Unicode are React text, never executable HTML", () => {
    const report = fixture("report").report;
    const input = '<script>alert("x")</script><img src=x onerror="alert(1)"> & \'未提供\' 待核实 未确认 ' + "\u{20000}".repeat(600);
    report.briefing.quick_read.focus.text = input;
    report.sourceReferences[0].sender = '昵称 <iframe src="javascript:alert(1)">';
    const html = renderToStaticMarkup(detail(report));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&quot;x&quot;"));
    assert.ok(html.includes("&#x27;未提供&#x27; 待核实 未确认"));
    assert.ok(html.includes("\u{20000}".repeat(600)));
    assert.doesNotMatch(html, /<script|<img|<iframe|dangerouslySetInnerHTML/);
    report.caCoverage = { sourcesComplete: true, totalItems: 70, exportedItems: 1, truncated: true };
    const clipped = renderToStaticMarkup(detail(report));
    assert.ok(clipped.includes("CA 聚合已裁剪"));
    assert.doesNotMatch(clipped, /CA 来源不完整/);
  });

  test("active list shows total and truncation, exact address, network and separate counts", () => {
    const item = alert();
    const html = renderToStaticMarkup(React.createElement(WecomCaAlerts, { data: alerts([item], { total: 73, truncated: true }), mode: "active", now }));
    for (const value of ["73", "仅显示前", "跨群提及", item.address, "base", "群数", "提及数", "去重陈述", "重复搬运", "非投资建议", "通知采集范围", "触发时间", "评估时间", "预计失效", "首次接收", "同步时间"]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /投资机会|独立人数/);
  });

  test("CA history labels early closure, last valid snapshot, catchup, delay and local expiry separately", () => {
    const items = [alert("closed", { status: "expired", effectiveStatus: "expired" }), alert("catchup", { catchup: true }), alert("delayed", { delayed: true }), alert("elapsed", { expiresAt: "2026-09-06T00:30:19Z" })];
    const html = renderToStaticMarkup(React.createElement(WecomCaAlerts, { data: alerts(items), mode: "history", now }));
    for (const value of ["提前关闭", "最后有效快照", "追赶补传", "延迟接收", "已失效"]) assert.ok(html.includes(value), value);
  });

  test("copy control copies full mixed-case address and reports clipboard failure safely", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let copied;
    let renderer;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { copied = value; } } } });
    try {
      await act(async () => { renderer = TestRenderer.create(React.createElement(WecomCaAlerts, { data: alerts(), mode: "active", now })); });
      await act(async () => { await renderer.root.findByProps({ "aria-label": "复制地址" }).props.onClick(); });
      assert.equal(copied, "0xAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAb");
      assert.ok(textContent(renderer.toJSON()).includes("已复制"));
      globalThis.navigator.clipboard.writeText = async () => { throw new Error("private clipboard failure"); };
      await act(async () => { await renderer.root.findByProps({ "aria-label": "复制地址" }).props.onClick(); });
      assert.ok(textContent(renderer.toJSON()).includes("复制失败"));
      assert.doesNotMatch(textContent(renderer.toJSON()), /private clipboard/);
    } finally {
      if (renderer) await act(async () => renderer.unmount());
      if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator;
    }
  });

  test("status never infers CA online from worker and stale connection overrides old process evidence", () => {
    const html = renderToStaticMarkup(React.createElement(WecomStatus, { status: status({ worker: "offline", caDetector: "online" }), now }));
    for (const value of ["设备连接", "监听", "总结进程", "CA 检测", "报告待发送", "CA 待发送", "worker_stale"]) assert.ok(html.includes(value), value);
    const stale = renderToStaticMarkup(React.createElement(WecomStatus, { status: status({ connection: "offline", listener: "online", worker: "online", caDetector: "online" }), now }));
    assert.ok(stale.includes("状态已过时"));
    assert.doesNotMatch(stale, />在线</);
    const clockStale = renderToStaticMarkup(React.createElement(WecomStatus, { status: status({ listener: "online", worker: "online", caDetector: "online" }), now: now + 181_000 }));
    assert.ok(clockStale.includes("状态已过时"));
    const unknown = renderToStaticMarkup(React.createElement(WecomStatus, { status: null, now }));
    assert.ok(unknown.includes("状态暂不可用"));
    assert.doesNotMatch(unknown, />0</);
  });
  test("CA evidence waits for the next 60-second heartbeat instead of inventing an offline process", () => {
    const html = renderToStaticMarkup(React.createElement(WecomStatus, { status: status({ worker: "online", caDetector: "online", lastCaEvaluatedAt: "2026-09-06T00:29:49Z" }), now }));
    assert.match(html, /CA 检测<\/span><span[^>]*>状态待更新<\/span>/);
  });
} finally {
  runtime.cleanup();
}
