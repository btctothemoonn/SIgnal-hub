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

await test("shouldWaitForTelegramRefresh accepts explicit refresh query values", async () => {
  const { shouldWaitForTelegramRefresh } = await importTs("./telegram-refresh-mode.ts");

  assert.equal(shouldWaitForTelegramRefresh("http://localhost/api/telegram?refresh=1"), true);
  assert.equal(shouldWaitForTelegramRefresh("http://localhost/api/telegram?refresh=true"), true);
  assert.equal(shouldWaitForTelegramRefresh("http://localhost/api/telegram?refresh=yes"), true);
  assert.equal(shouldWaitForTelegramRefresh("http://localhost/api/telegram"), false);
  assert.equal(shouldWaitForTelegramRefresh("http://localhost/api/telegram?refresh=0"), false);
});
