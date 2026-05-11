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

await test("makeTelegramClientOptions disables library auto reconnect", async () => {
  const { makeTelegramClientOptions } = await importTs("./telegram-client-options.ts");

  const options = makeTelegramClientOptions();

  assert.equal(options.autoReconnect, false);
  assert.equal(options.reconnectRetries, 0);
  assert.equal(options.connectionRetries, 3);
  assert.equal(options.maxConcurrentDownloads, 1);
});
