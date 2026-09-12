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
    const visible = html.replace(/<[^>]*>/g, "");
    for (const value of textFields(report.briefing).filter((v) => v !== "market" && !/^M\d+$/.test(v))) assert.ok(visible.includes(value.replace(/\bM\d{4}\b/g, "")), value);
    for (const value of ["合成甲群", "小林（合成昵称）", "来源记录缺失", "通知采集时间", "2026/09/06 08:10:00", "总结窗口", "生成时间", "同步时间", "原文仅保存在 Mac，未同步", "冻结来源存在缺口", "CA 来源不完整", "CA 聚合未裁剪"]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /查看原文|总结已截断|已核验/);
    for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  });

  test("v3 template renders five sections, cited speakers and source time without inventing missing values", () => {
    const report=fixture("report").report;report.briefing.version=3;
    for(const p of report.briefing.projects) Object.assign(p,{section:"opportunity",views:[{speaker:"小林",text:"本人观点",source_message_ids:p.source_message_ids}],disagreement:"未提供"});
    for(const e of report.briefing.events)e.section="warning";
    report.briefing.projects[0].latest="[小林]补充最新进展 <img src=x onerror=alert(1)>";
    report.briefing.projects[0].catalysts="【小林】说明触发条件";
    const html=renderToStaticMarkup(detail(report));
    for(const title of ["机会与逻辑","消息面","标的与事件","大盘与主流币","警示","[小林]","已引用"]) assert.ok(html.includes(title),title);
    assert.ok(!html.includes("分歧：未提供"));
    assert.ok(!html.includes("概述："), "latest and summary must not create duplicate paragraphs");
    assert.match(html, /<strong[^>]*>\[小林\]<\/strong>补充最新进展/);
    assert.match(html, /<strong[^>]*>【小林】<\/strong>说明触发条件/);
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.doesNotMatch(html, /<img/);
    assert.ok(html.includes(`CA: ${report.briefing.projects[0].addresses[0].address}`));
    assert.ok(html.includes("intel-sources"), "source metadata remains linked without repeated visible IDs");
    assert.ok(html.includes("报告窗口 CA 聚合"));
    assert.ok(html.includes("通知采集时间"));
    for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
  });

  for (const version of [2, 3]) test(`v${version} highlights exact known nicknames and hides citation numbers while retaining source access`, () => {
    const report = fixture("report").report;
    const speakers = ["小林", "小林同学", "S. F]并向你翻了个白眼", "Ken", "SOL", "𠀀小牛", '<img src=x onerror="bad()">'];
    report.sourceReferences = speakers.map((sender, index) => ({ ...report.sourceReferences[0], id: `M${String(index + 1).padStart(4, "0")}`, sender }));
    report.briefing.version = version;
    const narrative = '群友小林认为有条件；小林同学补充。 [S. F]并向你翻了个白眼]回应，𠀀小牛表示等待；Ken认为未确认。 [陌生人]不可归因。 $SOL SOLANA https://example.com/Ken/ SOL合同。 [M0001, M0002]';
    report.briefing.quick_read.focus.text = narrative;
    report.briefing.projects[0].latest = narrative;
    report.briefing.projects[0].catalysts = '【小林】解释条件 <img src=x onerror="bad()">表示谨慎';
    if (version === 3) {
      for (const project of report.briefing.projects) Object.assign(project, { section: "subject", views: [{ speaker: "观点昵称", text: "观点昵称强调等待确认", source_message_ids: project.source_message_ids }], disagreement: "未提供" });
      for (const event of report.briefing.events) event.section = "news";
    }
    const before = JSON.stringify(report);
    const html = renderToStaticMarkup(detail(report));
    assert.equal(JSON.stringify(report), before, "presentation must not rewrite stored report text or IDs");
    for (const name of ["小林", "小林同学", "[S. F]并向你翻了个白眼]", "𠀀小牛", "Ken"]) assert.ok(html.includes(`>${name}</strong>`), name);
    assert.match(html, /text-\[#138390\][^>]*>小林<\/strong>认为/);
    assert.match(html, /<strong[^>]*>【小林】<\/strong>解释条件/);
    assert.ok(html.includes("$SOL SOLANA https://example.com/Ken/"), "symbols and URL components must not be colored as speakers");
    assert.ok(html.includes("[陌生人]不可归因"));
    assert.doesNotMatch(html, /<strong[^>]*>\[陌生人\]/);
    assert.doesNotMatch(html, /<img|<script|<iframe/);
    assert.ok(html.includes("&lt;img src=x onerror=&quot;bad()&quot;&gt;"));
    const visible = html.replace(/<[^>]*>/g, "");
    assert.doesNotMatch(visible, /M\d{4}/, "chat record numbers must not appear in narrative or source metadata");
    assert.doesNotMatch(html, /(?:aria-label|title)="[^"]*M\d{4}/, "accessible link names must not announce hidden record IDs");
    const links = [...html.matchAll(/href="#([^"]+)"[^>]*>([^<]*)<\/a>/g)];
    assert.ok(links.length);
    for (const [, id, label] of links) { assert.ok(html.includes(`id="${id}"`)); assert.match(label, /^来源(?: \d+)?$/); }
    if (version === 2) {
      const focus = html.match(/焦点<\/h4><p[^>]*>([\s\S]*?)<\/p>/)[1];
      const focusLinks = [...focus.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
      assert.equal(focusLinks.length, new Set(report.briefing.quick_read.focus.source_message_ids).size);
      for (const id of report.briefing.quick_read.focus.source_message_ids) assert.ok(focusLinks.some((target) => target.endsWith(`-${id}`)), "each cited record remains directly accessible");
    } else {
      const card = html.slice(html.indexOf(">标的与事件</h4>")).match(/<article[^>]*>([\s\S]*?)<\/article>/)[1];
      const cardLinks = [...card.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
      const project = report.briefing.projects[0];
      const ids = new Set([project, ...project.data, ...project.addresses, ...project.views].flatMap((item) => item.source_message_ids));
      assert.equal(cardLinks.length, ids.size);
      for (const id of ids) assert.ok(cardLinks.some((target) => target.endsWith(`-${id}`)), "v3 cards retain the source association for every cited record");
    }
  });

  for (const version of [2, 3]) test(`v${version} preserves literal ID names and URLs while hiding explicit source notation`, () => {
    const report = fixture("report").report;
    report.briefing.version = version;
    const narrative = "M0001 is a literal name, not a citation. https://example.com/M0001 https://example.com/[M0002] [来源：M0002] 来源：M0002。 据小林自述，另由小林更正。";
    report.sourceReferences[0].sender = "小林";
    report.briefing.quick_read.focus.text = narrative;
    report.briefing.projects[0].latest = narrative;
    if (version === 3) {
      for (const project of report.briefing.projects) Object.assign(project, { section: "subject", views: [], disagreement: "未提供" });
      for (const event of report.briefing.events) event.section = "news";
    }
    const html = renderToStaticMarkup(detail(report));
    assert.ok(html.includes("M0001 is a literal name, not a citation."));
    assert.ok(html.includes("https://example.com/M0001 https://example.com/[M0002]"));
    assert.doesNotMatch(html, /\[来源：M0002\]|来源：M0002/);
    assert.match(html, /据<strong[^>]*>小林<\/strong>自述/);
    assert.match(html, /由<strong[^>]*>小林<\/strong>更正/);
    report.sourceReferences[0].sender = "M0001";
    report.briefing.quick_read.focus.text = "[M0001]表示等待";
    report.briefing.projects[0].latest = "[M0001]表示等待";
    const named = renderToStaticMarkup(detail(report));
    assert.match(named, /<strong[^>]*>\[M0001\]<\/strong>表示等待/, "a real nickname that resembles an ID must remain intact");
  });

  for (const version of [2, 3]) test(`v${version} removes exact citations without corrupting longer or unknown IDs`, () => {
    const renderNarrative = (text, ids) => {
      const report = fixture("report").report;
      report.briefing.version = version;
      report.sourceReferences.push(...ids.map((id) => ({ ...report.sourceReferences[0], id, sender: "边界示例昵称" })));
      report.briefing.quick_read.focus.text = text;
      report.briefing.projects[0].latest = text;
      if (version === 3) {
        for (const project of report.briefing.projects) Object.assign(project, { section: "subject", views: [], disagreement: "未提供" });
        for (const event of report.briefing.events) event.section = "news";
      }
      return renderToStaticMarkup(detail(report)).replace(/<[^>]*>/g, "");
    };
    assert.ok(renderNarrative("开头来源：M10000。结尾", ["M1000", "M10000"]).includes("开头。结尾"), "longer known IDs must be removed whole");
    assert.ok(renderNarrative("来源：M10001。", ["M1000"]).includes("来源：M10001。"), "a known prefix must not corrupt an unknown reference");
    assert.ok(renderNarrative("引用：M1000Pro", ["M1000"]).includes("引用：M1000Pro"), "literal names sharing a reference prefix must remain intact");
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

  test("v3 inline CA copies the complete address and exposes accessible feedback", async () => {
    const report = fixture("report").report;
    report.briefing.version = 3;
    for (const project of report.briefing.projects) Object.assign(project, { section: "opportunity", views: [], disagreement: "未提供" });
    for (const event of report.briefing.events) event.section = "news";
    const address = report.briefing.projects[0].addresses[0].address;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let copied;
    let renderer;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { copied = value; } } } });
    try {
      await act(async () => { renderer = TestRenderer.create(detail(report)); });
      const button = renderer.root.findByProps({ "aria-label": `复制地址 ${address}` });
      await act(async () => { await button.props.onClick(); });
      assert.equal(copied, address);
      assert.ok(textContent(renderer.toJSON()).includes("已复制"));
      globalThis.navigator.clipboard.writeText = async () => { throw new Error("private clipboard failure"); };
      await act(async () => { await button.props.onClick(); });
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
