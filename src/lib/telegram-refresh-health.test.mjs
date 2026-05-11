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

function makeSnapshot(overrides = {}) {
  return {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: "live",
    channels: [{ ref: "au_call" }],
    feed: [{ id: "message-1" }],
    note: "",
    errors: [],
    ...overrides,
  };
}

await test("shouldResetTelegramClientAfterSnapshot resets configured empty timeout refreshes", async () => {
  const { shouldResetTelegramClientAfterSnapshot } = await importTs(
    "./telegram-refresh-health.ts",
  );

  assert.equal(
    shouldResetTelegramClientAfterSnapshot(
      makeSnapshot({
        status: "limited",
        channels: [],
        feed: [],
        errors: ["解析 au_call 超时 (10000ms)"],
      }),
    ),
    true,
  );
});

await test("shouldResetTelegramClientAfterSnapshot keeps healthy live snapshots", async () => {
  const { shouldResetTelegramClientAfterSnapshot } = await importTs(
    "./telegram-refresh-health.ts",
  );

  assert.equal(shouldResetTelegramClientAfterSnapshot(makeSnapshot()), false);
});
