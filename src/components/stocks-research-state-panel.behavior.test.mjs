import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = dirname(fileURLToPath(import.meta.url));
const panelPath = join(directory, "stocks-research-state-panel.tsx");
const temporaryPanelPath = join(
  directory,
  `stocks-research-state-panel.runtime-${process.pid}.mjs`,
);

function researchState(overrides = {}) {
  return {
    ticker: "NVDA",
    status: "watch",
    conviction: null,
    entryZone: "",
    invalidation: "",
    nextCatalyst: "",
    thesis: "",
    updatedAt: "2026-07-26T09:00:00.000Z",
    persisted: true,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPanel(Panel, props) {
  return React.createElement(Panel, props);
}

function visibleText(renderer) {
  return JSON.stringify(renderer.toJSON());
}

function buttonWithText(root, text) {
  const button = root
    .findAllByType("button")
    .find((candidate) => candidate.children.includes(text));
  assert.ok(button, `missing button ${text}`);
  return button;
}

try {
  const output = ts.transpileModule(readFileSync(panelPath, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: panelPath,
  }).outputText.replaceAll(
    '"@/components/stocks-research-state-form"',
    '"./stocks-research-state-form.ts"',
  );
  writeFileSync(temporaryPanelPath, output, "utf8");

  const { StocksResearchStatePanel } = await import(
    `${pathToFileURL(temporaryPanelPath).href}?run=${Date.now()}`,
  );

  const save = deferred();
  const payloads = [];
  const onSave = async (input) => {
    payloads.push(input);
    await save.promise;
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      renderPanel(StocksResearchStatePanel, {
        ticker: "NVDA",
        researchState: researchState(),
        loading: false,
        onSave,
      }),
    );
  });

  await act(async () => {
    buttonWithText(renderer.root, "持有").props.onClick();
    renderer.root.findAllByType("input")[0].props.onChange({
      target: { value: "$180-$190" },
    });
    renderer.root.findByType("textarea").props.onChange({
      target: { value: "Keep the thesis" },
    });
  });

  let prevented = 0;
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({
      preventDefault() {
        prevented += 1;
      },
    });
  });
  assert.equal(prevented, 1);
  assert.deepEqual(payloads, [
    {
      ticker: "NVDA",
      status: "holding",
      conviction: null,
      entryZone: "$180-$190",
      invalidation: "",
      nextCatalyst: "",
      thesis: "Keep the thesis",
    },
  ]);
  assert.equal(buttonWithText(renderer.root, "保存中...").props.disabled, true);

  await act(async () => {
    renderer.update(
      renderPanel(StocksResearchStatePanel, {
        ticker: "NVDA",
        researchState: researchState({
          status: "holding",
          entryZone: "$180-$190",
          thesis: "Keep the thesis",
          updatedAt: "2026-07-26T09:01:00.000Z",
        }),
        loading: false,
        onSave,
      }),
    );
  });
  save.resolve();
  await act(async () => {
    await save.promise;
  });
  assert.match(visibleText(renderer), /已保存/);

  const rejectedSave = deferred();
  await act(async () => {
    renderer.update(
      renderPanel(StocksResearchStatePanel, {
        ticker: "NVDA",
        researchState: researchState({
          updatedAt: "2026-07-26T09:02:00.000Z",
        }),
        loading: false,
        onSave: () => rejectedSave.promise,
      }),
    );
  });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({
      target: { value: "Keep rejected draft" },
    });
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "Keep rejected draft");
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({
      preventDefault() {},
    });
  });
  rejectedSave.reject(new Error("Network unavailable"));
  await act(async () => {
    try {
      await rejectedSave.promise;
    } catch {}
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "Keep rejected draft");
  assert.match(visibleText(renderer), /保存失败：Network unavailable/);

  await act(async () => {
    renderer.update(
      renderPanel(StocksResearchStatePanel, {
        ticker: "NVDA",
        researchState: researchState(),
        loading: true,
        onSave,
      }),
    );
  });
  assert.equal(buttonWithText(renderer.root, "保存研究状态").props.disabled, true);

  await act(async () => {
    renderer.update(
      renderPanel(StocksResearchStatePanel, {
        ticker: "AMD",
        researchState: researchState(),
        loading: false,
        onSave,
      }),
    );
  });
  assert.match(visibleText(renderer), /研究状态暂不可用/);
  assert.equal(renderer.root.findAllByType("form").length, 0);

  await act(async () => {
    renderer.update(
      renderPanel(StocksResearchStatePanel, {
        ticker: "AMD",
        researchState: researchState(),
        loading: true,
        onSave,
      }),
    );
  });
  assert.match(visibleText(renderer), /研究状态加载中/);
} finally {
  rmSync(temporaryPanelPath, { force: true });
}

console.log("ok - stocks research state panel behavior");
