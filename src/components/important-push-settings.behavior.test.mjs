import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const path = new URL(`./important-push-settings.runtime-${process.pid}.mjs`, import.meta.url);
let renderer, enables = 0;
const client = { readStatus: async () => ({ state: 'ready', enabled: false }), enableFromUserGesture: () => { enables++; return Promise.resolve({ state: 'enabled', enabled: true }); }, disable: async () => ({ state: 'ready', enabled: false }), sendTest: async () => ({ accepted: true }) };
try {
 const source = readFileSync(new URL('./important-push-settings.tsx', import.meta.url), 'utf8');
 const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 writeFileSync(path, output); const { ImportantPushSettings } = await import(path.href);
 await act(async () => { renderer = TestRenderer.create(React.createElement(ImportantPushSettings, { client })); });
 assert.equal(enables, 0);
 const enable = renderer.root.findAllByType('button').find(b => b.children.join('') === '开启通知'); assert.ok(enable);
 await act(async () => { await enable.props.onClick(); }); assert.equal(enables, 1);
 assert.ok(JSON.stringify(renderer.toJSON()).includes('通知已开启'));
} finally { if (renderer) await act(async () => renderer.unmount()); rmSync(path, { force: true }); }
console.log('important push settings behavior passed');
