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
    channels: [],
    feed: [{ id: "message-1", createdAt: "2026-04-28T00:00:00.000Z" }],
    note: "ok",
    errors: [],
    ...overrides,
  };
}

await test("chooseTelegramRefreshResult returns fresh successful snapshots", async () => {
  const { chooseTelegramRefreshResult } = await importTs(
    "./telegram-refresh-fallback.ts",
  );
  const fresh = makeSnapshot({ feed: [{ id: "fresh" }] });
  const cached = makeSnapshot({ feed: [{ id: "cached" }] });

  assert.equal(chooseTelegramRefreshResult(fresh, cached).feed[0].id, "fresh");
});

await test("chooseTelegramRefreshResult falls back to cached feed when refresh fails empty", async () => {
  const { chooseTelegramRefreshResult } = await importTs(
    "./telegram-refresh-fallback.ts",
  );
  const failed = makeSnapshot({
    isConnected: false,
    status: "error",
    feed: [],
    errors: ["Telegram refresh failed"],
  });
  const cached = makeSnapshot({ feed: [{ id: "cached" }] });

  const result = chooseTelegramRefreshResult(failed, cached);

  assert.equal(result.feed[0].id, "cached");
  assert.equal(result.status, "limited");
  assert.equal(result.isConnected, false);
  assert.deepEqual(result.errors, ["Telegram refresh failed"]);
});
