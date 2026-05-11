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

await test("parseTelegramIdleResetMs is disabled by default", async () => {
  const { parseTelegramIdleResetMs } = await importTs(
    "./telegram-idle-reset-policy.ts",
  );

  assert.equal(parseTelegramIdleResetMs(undefined), 0);
});

await test("parseTelegramIdleResetMs accepts positive integer values", async () => {
  const { parseTelegramIdleResetMs } = await importTs(
    "./telegram-idle-reset-policy.ts",
  );

  assert.equal(parseTelegramIdleResetMs("30000"), 30_000);
  assert.equal(parseTelegramIdleResetMs("0"), 0);
  assert.equal(parseTelegramIdleResetMs("off"), 0);
  assert.equal(parseTelegramIdleResetMs("bad"), 0);
});
