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

await test("keeps previous resolved channels when refresh resolves nothing for configured targets", async () => {
  const { applyResolvedTelegramChannelRefresh } = await importTs(
    "./telegram-resolved-channel-cache.ts",
  );

  const previous = {
    loadedAt: 1000,
    channels: [{ ref: "@old", title: "Old" }],
  };
  const result = applyResolvedTelegramChannelRefresh({
    previous,
    channels: [],
    errors: ["Telegram timeout"],
    targetCount: 3,
    now: 2000,
  });

  assert.deepEqual(result.cache, {
    channels: previous.channels,
    loadedAt: 2000,
  });
  assert.equal(result.usedStaleCache, true);
  assert.deepEqual(result.channels, previous.channels);
  assert.deepEqual(result.errors, ["Telegram timeout"]);
});

await test("stores empty cache only when there are no configured targets", async () => {
  const { applyResolvedTelegramChannelRefresh } = await importTs(
    "./telegram-resolved-channel-cache.ts",
  );

  const result = applyResolvedTelegramChannelRefresh({
    previous: null,
    channels: [],
    errors: [],
    targetCount: 0,
    now: 2000,
  });

  assert.deepEqual(result.cache, { channels: [], loadedAt: 2000 });
  assert.equal(result.usedStaleCache, false);
  assert.deepEqual(result.channels, []);
});
