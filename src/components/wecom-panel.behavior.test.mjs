import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { alert, alerts, compileComponents, fixture, flush, harness, reports, status, textContent } from "./wecom-test-utils.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
assert.ok(existsSync(new URL("./wecom-panel.tsx", import.meta.url)), "WeCom page needs an interactive private panel");
const compiled = await compileComponents();
const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, now: Date.now };
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, payload = {}) { for (const callback of listeners.get(type) ?? []) callback(payload); },
    count() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); },
  };
}
let renderer;
try {
  const { WecomPanel } = await compiled.load("wecom-panel");
  const initialMarkup = renderToStaticMarkup(React.createElement(WecomPanel, {
    initialReports: reports(),
    initialAlerts: alerts(Array.from({ length: 50 }, (_, index) => alert(`initial-${index}`)), { total: 75, truncated: true }),
  }));
  assert.match(initialMarkup, /有效总量 75/);
  assert.match(initialMarkup, /仅显示前 50 条/);
  assert.equal((initialMarkup.match(/aria-label="跨群提及 /g) ?? []).length, 50);
  const errorMarkup = renderToStaticMarkup(React.createElement(WecomPanel, { initialReports: null, initialAlerts: null, initialError: "企业微信数据读取失败，请稍后重试。" }));
  assert.match(errorMarkup, /数据读取失败/);
  assert.doesNotMatch(errorMarkup, /暂无有效跨群提及|此周期暂无简报/);
  for (const authCode of [401, 403]) {
    const h = harness();
    let ca = alerts();
    const doc = { ...eventTarget(), visibilityState: "visible" };
    const win = { ...eventTarget(), setTimeout: h.runtime.setTimeout, clearTimeout: h.runtime.clearTimeout, location: { replace: h.runtime.onUnauthorized } };
    globalThis.window = win; globalThis.document = doc; globalThis.fetch = h.runtime.fetch; Date.now = h.runtime.now;
    const report = fixture("report").report;
    let statusCode = 200;
    h.respond((url) => {
      if (url.includes("/status")) return statusCode === 200 ? status() : new Response(null, { status: statusCode });
      if (url.includes("id=")) return { report, syncedAt: "2026-09-06T02:06:00Z" };
      if (url.includes("ca-alerts")) return ca;
      return reports();
    });
    const props = { initialReports: reports(), initialAlerts: alerts(undefined, { total: 75, truncated: true }) };
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.StrictMode, null, React.createElement(WecomPanel, props))); await flush(); });
    assert.ok(textContent(renderer.toJSON()).includes(report.summary));
    assert.equal(renderer.root.findAllByProps({ "aria-label": "新跨群提及" }).length, 0);
    await act(async () => { renderer.root.findByProps({ "aria-label": "简报周期" }).findAllByType("button")[1].props.onClick(); await flush(); });
    assert.ok(h.requests.some(({ url }) => url.includes("cadence=six_hour&limit=10")));
    assert.equal(renderer.root.findByProps({ "aria-label": "简报周期" }).findAllByType("button")[1].props["aria-pressed"], true);
    await act(async () => { renderer.root.findByProps({ "aria-label": "CA 范围" }).findAllByType("button")[1].props.onClick(); await flush(); });
    assert.ok(h.requests.some(({ url }) => url === "/api/wecom/ca-alerts?limit=10"));
    assert.match(textContent(renderer.toJSON()), /历史记录/);
    await act(async () => { renderer.root.findByProps({ "aria-label": "展开简报" }).props.onClick(); await flush(); });
    assert.ok(textContent(renderer.toJSON()).includes(report.briefing.projects[0].catalysts));
    ca = alerts([alert("new-notice")]);
    await act(async () => { await h.tick(15_000); });
    assert.equal(renderer.root.findAllByProps({ "aria-label": "新跨群提及" }).length, 1);
    await act(async () => { doc.visibilityState = "hidden"; doc.emit("visibilitychange"); await flush(); });
    assert.equal(renderer.root.findAllByProps({ "aria-label": "新跨群提及" }).length, 0);
    const hiddenCount = h.requests.length;
    await act(async () => { await h.tick(30_000); });
    assert.equal(h.requests.length, hiddenCount);
    await act(async () => { doc.visibilityState = "visible"; doc.emit("visibilitychange"); win.emit("focus"); await flush(); });
    assert.ok(h.requests.length > hiddenCount);
    assert.equal(renderer.root.findAllByProps({ "aria-label": "新跨群提及" }).length, 0);
    statusCode = authCode;
    await act(async () => { win.emit("focus"); await flush(); });
    const denied = textContent(renderer.toJSON());
    assert.doesNotMatch(denied, /合成甲群|小林|0xAbAb|fixture-model|M0001/);
    assert.equal(renderer.root.findAllByProps({ "aria-label": "展开简报" }).length, 0);
    assert.equal(renderer.root.findAllByProps({ "aria-label": "新跨群提及" }).length, 0);
    assert.match(denied, authCode === 401 ? /登录已失效/ : /无权|授权/);
    assert.equal(h.redirects.length, authCode === 401 ? 1 : 0);
    await act(async () => { renderer.update(React.createElement(React.StrictMode, null, React.createElement(WecomPanel, props))); await flush(); });
    assert.doesNotMatch(textContent(renderer.toJSON()), /合成甲群|小林|0xAbAb/);
    await act(async () => { renderer.unmount(); renderer = null; });
    assert.equal(win.count(), 0); assert.equal(doc.count(), 0); assert.equal(h.timers.size, 0);
  }
  console.log("ok - WeCom panel StrictMode, expansion, visibility/focus, notifications, both auth losses and SSR fallback clearing");
} finally {
  if (renderer) await act(async () => renderer.unmount());
  globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; Date.now = previous.now;
  compiled.cleanup();
}
