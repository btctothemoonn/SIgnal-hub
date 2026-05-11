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

await test("parseTelegramEntityResolveTimeoutMs defaults to a longer timeout than the old 10s limit", async () => {
  const { parseTelegramEntityResolveTimeoutMs } = await importTs(
    "./telegram-entity-resolve-policy.ts",
  );

  assert.equal(parseTelegramEntityResolveTimeoutMs(undefined), 25000);
  assert.equal(parseTelegramEntityResolveTimeoutMs("12000"), 12000);
  assert.equal(parseTelegramEntityResolveTimeoutMs("0"), 25000);
});

await test("parseTelegramEntityResolveConcurrency keeps channel resolution bounded", async () => {
  const { parseTelegramEntityResolveConcurrency } = await importTs(
    "./telegram-entity-resolve-policy.ts",
  );

  assert.equal(parseTelegramEntityResolveConcurrency(undefined), 4);
  assert.equal(parseTelegramEntityResolveConcurrency("2"), 2);
  assert.equal(parseTelegramEntityResolveConcurrency("99"), 8);
  assert.equal(parseTelegramEntityResolveConcurrency("0"), 4);
});
