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

await test("parseTelegramMediaPreviewLimit accepts positive integer values", async () => {
  const { parseTelegramMediaPreviewLimit } = await importTs(
    "./telegram-media-preview-policy.ts",
  );

  assert.equal(parseTelegramMediaPreviewLimit("8"), 8);
  assert.equal(parseTelegramMediaPreviewLimit(" 24 "), 24);
});

await test("parseTelegramMediaPreviewLimit treats disabled values as zero", async () => {
  const { parseTelegramMediaPreviewLimit } = await importTs(
    "./telegram-media-preview-policy.ts",
  );

  assert.equal(parseTelegramMediaPreviewLimit("0"), 0);
  assert.equal(parseTelegramMediaPreviewLimit("off"), 0);
  assert.equal(parseTelegramMediaPreviewLimit("false"), 0);
});

await test("shouldDownloadTelegramMediaPreview only allows the newest limited items", async () => {
  const { shouldDownloadTelegramMediaPreview } = await importTs(
    "./telegram-media-preview-policy.ts",
  );

  assert.equal(shouldDownloadTelegramMediaPreview(0, 2), true);
  assert.equal(shouldDownloadTelegramMediaPreview(1, 2), true);
  assert.equal(shouldDownloadTelegramMediaPreview(2, 2), false);
  assert.equal(shouldDownloadTelegramMediaPreview(-1, 2), false);
});

await test("shouldDownloadTelegramChannelAvatars is enabled by default and can be disabled", async () => {
  const { shouldDownloadTelegramChannelAvatars } = await importTs(
    "./telegram-media-preview-policy.ts",
  );

  assert.equal(shouldDownloadTelegramChannelAvatars(undefined), true);
  assert.equal(shouldDownloadTelegramChannelAvatars("false"), false);
  assert.equal(shouldDownloadTelegramChannelAvatars("1"), true);
  assert.equal(shouldDownloadTelegramChannelAvatars("true"), true);
});
