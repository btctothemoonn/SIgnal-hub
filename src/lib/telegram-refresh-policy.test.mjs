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

const { shouldRefreshTelegramSnapshot } = await importTs(
  "./telegram-refresh-policy.ts",
);

assert.equal(shouldRefreshTelegramSnapshot(1000, 1000), false);
assert.equal(shouldRefreshTelegramSnapshot(1000, 1000 + 59999), false);
assert.equal(shouldRefreshTelegramSnapshot(1000, 1000 + 60000), true);

console.log("ok - Telegram refresh policy enforces the 60000ms boundary");
