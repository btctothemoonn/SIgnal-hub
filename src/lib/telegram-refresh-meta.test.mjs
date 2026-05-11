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

function makeSnapshot() {
  return {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: "live",
    channels: [],
    feed: [],
    note: "",
    errors: [],
  };
}

await test("withTelegramRefreshMeta attaches refresh source and timestamps", async () => {
  const { withTelegramRefreshMeta } = await importTs("./telegram-refresh-meta.ts");

  const snapshot = withTelegramRefreshMeta(makeSnapshot(), {
    source: "refresh",
    startedAtMs: 1000,
    finishedAtMs: 2500,
    cacheFetchedAtMs: 2000,
  });

  assert.equal(snapshot.refresh.source, "refresh");
  assert.equal(snapshot.refresh.startedAt, new Date(1000).toISOString());
  assert.equal(snapshot.refresh.finishedAt, new Date(2500).toISOString());
  assert.equal(snapshot.refresh.durationMs, 1500);
  assert.equal(snapshot.refresh.cacheFetchedAt, new Date(2000).toISOString());
});

await test("formatTelegramRefreshDuration shows seconds with one decimal", async () => {
  const { formatTelegramRefreshDuration } = await importTs(
    "./telegram-refresh-meta.ts",
  );

  assert.equal(formatTelegramRefreshDuration(7232), "7.2s");
  assert.equal(formatTelegramRefreshDuration(850), "0.9s");
  assert.equal(formatTelegramRefreshDuration(null), "n/a");
});
