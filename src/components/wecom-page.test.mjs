import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { alerts, reports } from "./wecom-test-utils.mjs";

const page = new URL("../app/wecom/page.tsx", import.meta.url);
assert.ok(existsSync(page), "WeCom page must authorize on the server before reading storage");
const runtime = new URL(`./wecom-page.runtime-${process.pid}.mjs`, import.meta.url);
const stub = new URL(`./wecom-page.stubs-${process.pid}.mjs`, import.meta.url);
const calls = [];
let failure = null;
globalThis.__wecomPageTest = {
  headers: () => { calls.push("headers"); return new Headers({ cookie: "synthetic-session" }); },
  authorize: (request) => {
    calls.push("authorize");
    assert.equal(request.url, "http://localhost/wecom");
    assert.equal(request.headers.get("cookie"), "synthetic-session");
    if (failure === 401 || failure === 403) throw Object.assign(new Error("private-auth-detail"), { status: failure });
    return { ownerId: "synthetic-owner", deviceId: "synthetic-device" };
  },
  reports: (options) => {
    calls.push("reports");
    assert.deepEqual(options, { ownerId: "synthetic-owner", deviceId: "synthetic-device", cadence: "two_hour", limit: 10 });
    if (failure === "storage") throw new Error("private-db-path");
    return reports();
  },
  alerts: (options) => {
    calls.push("alerts");
    assert.deepEqual(options, { ownerId: "synthetic-owner", deviceId: "synthetic-device", active: true, limit: 50 });
    return alerts(undefined, { total: 71, truncated: true });
  },
};
try {
  writeFileSync(stub, `import React from "react";
export const headers = async () => globalThis.__wecomPageTest.headers();
export const authorizeWecomRead = (request) => { try { return globalThis.__wecomPageTest.authorize(request); } catch (error) { throw new WecomError(error.message, error.status); } };
export const getWecomReports = (options) => globalThis.__wecomPageTest.reports(options);
export const getWecomCaAlerts = (options) => globalThis.__wecomPageTest.alerts(options);
export function redirect(path) { throw new Error("redirect:" + path); }
export function AppShell({ children }) { return React.createElement("main", null, children); }
export function WecomPanel() {}
export class WecomError extends Error { constructor(message, status) { super(message); this.status = status; } }
`);
  const output = ts.transpileModule(readFileSync(page, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll(/from "(?:@\/[^\"]+|next\/[^\"]+)"/g, `from "${pathToFileURL(fileURLToPath(stub)).href}"`);
  writeFileSync(runtime, output);
  const { default: Page, dynamic, runtime: engine } = await import(runtime.href);
  test("authorized dynamic Node page forwards headers and exact access-scoped list limits", async () => {
    failure = null; calls.length = 0;
    const tree = await Page();
    assert.equal(dynamic, "force-dynamic"); assert.equal(engine, "nodejs");
    assert.deepEqual(calls, ["headers", "authorize", "reports", "alerts"]);
    assert.equal(tree.props.activeNav, "wecom");
    const panel = tree.props.children;
    assert.equal(panel.props.initialAlerts.total, 71);
    assert.equal(panel.props.initialAlerts.truncated, true);
    assert.equal(panel.props.initialReports.items.length, 1);
    assert.doesNotMatch(JSON.stringify(panel.props), /ownerId|deviceId|synthetic-session/);
  });
  for (const code of [401, 403]) test(`server ${code} does not query storage or expose authorization detail`, async () => {
    failure = code; calls.length = 0;
    if (code === 401) await assert.rejects(Page(), /redirect:\/login/);
    else {
      const tree = await Page();
      assert.match(renderToStaticMarkup(tree), /无权|授权|不可用/);
      assert.doesNotMatch(renderToStaticMarkup(tree), /private-auth-detail|initialReports|initialAlerts/);
    }
    assert.deepEqual(calls, ["headers", "authorize"]);
  });
  test("storage failure is a safe explicit error, not a successful empty dataset", async () => {
    failure = "storage"; calls.length = 0;
    const tree = await Page();
    assert.match(tree.props.children.props.initialError, /读取失败|暂不可用/);
    assert.equal(tree.props.children.props.initialReports, null);
    assert.equal(tree.props.children.props.initialAlerts, null);
    assert.doesNotMatch(JSON.stringify(tree), /private-db-path/);
  });
} finally {
  // Tests above run before process completion; stubs resolve the shared test object lazily.
  rmSync(runtime, { force: true }); rmSync(stub, { force: true });
}
