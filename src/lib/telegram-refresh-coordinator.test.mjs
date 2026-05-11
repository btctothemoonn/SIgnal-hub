import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("createTelegramRefreshCoordinator coalesces concurrent refreshes", async () => {
  const { createTelegramRefreshCoordinator } = await importTs(
    "./telegram-refresh-coordinator.ts",
  );

  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createTelegramRefreshCoordinator({
    minIntervalMs: 120000,
    now: () => 1000,
  });

  const first = coordinator.run(() => {
    calls += 1;
    return gate.then(() => "snapshot");
  });
  const second = coordinator.run(() => {
    calls += 1;
    return Promise.resolve("other");
  });

  assert.equal(calls, 1);
  release();
  assert.equal(await first, "snapshot");
  assert.equal(await second, "snapshot");
});

await test("createTelegramRefreshCoordinator throttles background refreshes", async () => {
  const { createTelegramRefreshCoordinator } = await importTs(
    "./telegram-refresh-coordinator.ts",
  );

  let now = 1000;
  const coordinator = createTelegramRefreshCoordinator({
    minIntervalMs: 120000,
    now: () => now,
  });

  assert.equal(coordinator.shouldStartBackgroundRefresh(), true);
  await coordinator.run(() => Promise.resolve("snapshot"));
  assert.equal(coordinator.shouldStartBackgroundRefresh(), false);

  now += 119999;
  assert.equal(coordinator.shouldStartBackgroundRefresh(), false);

  now += 1;
  assert.equal(coordinator.shouldStartBackgroundRefresh(), true);
});
