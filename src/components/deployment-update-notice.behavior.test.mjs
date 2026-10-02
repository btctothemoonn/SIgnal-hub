import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = new URL("./deployment-update-notice.tsx", import.meta.url);
assert.ok(existsSync(source), "Open pages need a deployment update notice");
const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "([^"]+)"/g, (_, specifier) => `from "${pathToFileURL(require.resolve(specifier)).href}"`);
const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, now: Date.now, version: process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION };
const loaded = "a".repeat(40);
const deployed = "b".repeat(40);
process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION = loaded;
const { DeploymentUpdateNotice } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) ?? []) listener(); },
    count() { return [...listeners.values()].reduce((sum, value) => sum + value.size, 0); },
  };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let renderer;
try {
  let time = 10_000, next = 0, reloads = 0;
  const timers = new Map(), requests = [];
  const win = {
    ...target(), location: { reload: () => { reloads++; } },
    setInterval(fn, delay) { timers.set(++next, { fn, delay, interval: true }); return next; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, delay) { timers.set(++next, { fn, delay }); return next; },
    clearTimeout(id) { timers.delete(id); },
  };
  const doc = { ...target(), visibilityState: "visible" };
  let reply = () => Response.json({ version: deployed });
  globalThis.window = win; globalThis.document = doc; Date.now = () => time;
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return reply(options); };
  const tick = async () => { time += 60_000; for (const timer of [...timers.values()]) if (timer.interval) timer.fn(); await flush(); };
  const mount = async () => act(async () => { renderer = TestRenderer.create(React.createElement(React.StrictMode, null, React.createElement(DeploymentUpdateNotice))); await flush(); });
  const unmount = async () => act(async () => { renderer.unmount(); renderer = null; await flush(); });
  const shown = () => renderer.root.findAllByProps({ role: "status" }).length === 1;

  // A tab opened before deployment must detect the NEW version on its very first reply.
  await mount();
  assert.ok(shown(), "must compare with the loaded bundle, not accept the first reply as a baseline");
  assert.equal(reloads, 0, "deployments must never reload the page automatically");
  assert.ok(requests.every(({ url, options }) => url === "/api/deployment-version" && options.cache === "no-store" && options.credentials === "same-origin"));
  await act(async () => renderer.root.findByType("button").props.onClick());
  assert.equal(reloads, 1, "the explicit refresh button reloads the current URL");

  // Transient failures, unauthorized replies and invalid data preserve a known notice.
  for (const response of [new Response(null, { status: 503 }), new Response(null, { status: 401 }), Response.json({ version: "" }), Response.json({ version: 123 })]) {
    reply = () => response;
    await act(async () => tick());
    assert.ok(shown());
  }
  reply = () => { throw new Error("offline"); };
  await act(async () => tick());
  assert.ok(shown());

  // Rolling back to the version already loaded makes the notice disappear.
  reply = () => Response.json({ version: loaded });
  await act(async () => tick());
  assert.equal(shown(), false);
  doc.visibilityState = "hidden";
  const count = requests.length;
  await act(async () => tick());
  assert.equal(requests.length, count, "hidden tabs must not poll");
  reply = () => Response.json({ version: deployed });
  doc.visibilityState = "visible";
  await act(async () => { doc.emit("visibilitychange"); win.emit("focus"); win.emit("online"); await flush(); });
  assert.ok(shown());
  assert.equal(requests.length, count + 1, "resume events must coalesce into one request");
  await unmount();
  assert.equal(win.count() + doc.count(), 0);
  assert.equal(timers.size, 0);

  // A slow request must not overlap checks and must be aborted on cleanup.
  let release;
  reply = () => new Promise((resolve) => { release = resolve; });
  await mount();
  const pendingCount = requests.length;
  const active = requests.at(-1).options.signal;
  assert.equal(active.aborted, false);
  await act(async () => tick());
  assert.equal(requests.length, pendingCount);
  await unmount();
  assert.equal(active.aborted, true);
  release(Response.json({ version: deployed }));
  await flush();
  assert.equal(win.count() + doc.count(), 0);
  assert.equal(timers.size, 0);

  // Timed-out replies must not manufacture a notice even if a transport resolves late.
  await mount();
  const timed = requests.at(-1).options.signal;
  await act(async () => {
    for (const timer of [...timers.values()]) if (!timer.interval) timer.fn();
    release(Response.json({ version: deployed }));
    await flush();
  });
  assert.equal(timed.aborted, true);
  assert.equal(shown(), false);
  reply = () => Response.json({ version: deployed });
  await act(async () => tick());
  assert.ok(shown(), "polling recovers after a timed-out request");
  await unmount();

  // A fresh page stays quiet when versions match or the server is temporarily unavailable.
  for (const result of [Response.json({ version: loaded }), new Response(null, { status: 503 })]) {
    reply = () => result;
    await mount();
    assert.equal(shown(), false);
    await unmount();
  }
  console.log("ok - update notice detects stale bundles, user refresh, rollback, errors, visibility, single-flight and cleanup");
} finally {
  if (renderer) await act(async () => renderer.unmount());
  globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; Date.now = previous.now;
  if (previous.version === undefined) delete process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
  else process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION = previous.version;
}
