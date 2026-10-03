import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const runtime = new URL(`./daily-brief-push.runtime-${process.pid}.mjs`, import.meta.url);
const priorDocument = globalThis.document;
let renderer;
try {
  const source = readFileSync(new URL('./daily-brief-panel.tsx', import.meta.url), 'utf8')
    .replace('"@/lib/daily-brief-display"', JSON.stringify(new URL('../lib/daily-brief-display.ts', import.meta.url).href));
  writeFileSync(runtime, ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const { DailyBriefPanel } = await import(runtime.href);
  for (const [topic, group] of [['BTC / 加密货币', 'crypto'], ['宏观 / 地缘政治 / 原油', 'markets'], ['AI / 科技产业链', 'ai']]) {
    const id = 'news:' + 'a'.repeat(32), scrolled = [];
    globalThis.document = { getElementById: target => ({ scrollIntoView: () => scrolled.push(target) }) };
    const item = { pushEventId: id, rank: 1, importance: 'high', title: '重要事件', topic, sourceNames: ['Reuters'], sourceUrls: [], imageUrl: null, whatHappened: '事实', investmentImpact: '影响', watchNext: '跟进' };
    const snapshot = { success: true, status: 'cached', configured: true, period: { dateKey: '2026-10-01', label: '10月1日' }, generatedAt: '2026-10-01T02:00:00Z', sourceCounts: {}, brief: { title: '历史简报', items: [item], watchVariables: [] } };
    await act(async () => { renderer = TestRenderer.create(React.createElement(DailyBriefPanel, { initialSnapshot: snapshot, initialHistory: [], initialPushEventId: id })); });
    assert.equal(renderer.root.findAll(node => node.type === 'article' && node.props.id === `news-push-${id}`).length, 1,
      `${group} push must mount its article rather than the default AI tab`);
    assert.deepEqual(scrolled, [`news-push-${id}`], 'scroll after the target category is rendered');
    await act(async () => renderer.unmount()); renderer = null;
  }
  const ordinary = { rank: 1, importance: 'high', title: '普通打开时的币圈新闻', topic: 'BTC / 加密货币', sourceNames: [], sourceUrls: [], imageUrl: null };
  const normalSnapshot = { success: true, status: 'cached', period: { dateKey: '2026-10-02' }, sourceCounts: {}, brief: { title: '最新简报', items: [ordinary], watchVariables: [] } };
  await act(async () => { renderer = TestRenderer.create(React.createElement(DailyBriefPanel, { initialSnapshot: normalSnapshot, initialHistory: [] })); });
  assert.equal(renderer.root.findAllByType('article').length, 0, 'without a push target, the existing default AI category is preserved');
} finally {
  if (renderer) await act(async () => renderer.unmount());
  globalThis.document = priorDocument; rmSync(runtime, { force: true });
}
console.log('news push selects and scrolls every category');
