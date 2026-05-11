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

await test("shouldDisplayTelegramWebPagePreview rejects square X link previews that are likely avatars", async () => {
  const { shouldDisplayTelegramWebPagePreview } = await importTs(
    "./telegram-webpage-preview.ts",
  );

  assert.equal(
    shouldDisplayTelegramWebPagePreview({
      url: "https://x.com/someone/status/123",
      width: 400,
      height: 400,
    }),
    false,
  );
});

await test("shouldDisplayTelegramWebPagePreview keeps wide X link previews", async () => {
  const { shouldDisplayTelegramWebPagePreview } = await importTs(
    "./telegram-webpage-preview.ts",
  );

  assert.equal(
    shouldDisplayTelegramWebPagePreview({
      url: "https://x.com/someone/status/123",
      width: 1200,
      height: 675,
    }),
    true,
  );
});

await test("shouldDisplayTelegramWebPagePreview keeps non-X previews by default", async () => {
  const { shouldDisplayTelegramWebPagePreview } = await importTs(
    "./telegram-webpage-preview.ts",
  );

  assert.equal(
    shouldDisplayTelegramWebPagePreview({
      url: "https://example.com/post",
      width: 400,
      height: 400,
    }),
    true,
  );
});
