import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

await test("getFreshTelegramChannelAvatar returns cached avatar within ttl", async () => {
  const { getFreshTelegramChannelAvatar } = await importTs(
    "./telegram-channel-avatar-cache.ts",
  );
  const cache = {
    "channel:1": {
      avatar: "data:image/jpeg;base64,abc",
      updatedAt: 1000,
    },
  };

  assert.equal(
    getFreshTelegramChannelAvatar(cache, "channel:1", 7 * 24 * 60 * 60 * 1000, 2000),
    "data:image/jpeg;base64,abc",
  );
});

await test("getFreshTelegramChannelAvatar returns undefined for stale entries", async () => {
  const { getFreshTelegramChannelAvatar } = await importTs(
    "./telegram-channel-avatar-cache.ts",
  );
  const cache = {
    "channel:1": {
      avatar: "data:image/jpeg;base64,abc",
      updatedAt: 1000,
    },
  };

  assert.equal(getFreshTelegramChannelAvatar(cache, "channel:1", 1000, 2501), undefined);
});

await test("writeTelegramChannelAvatarCache persists entries", async () => {
  const {
    readTelegramChannelAvatarCache,
    setTelegramChannelAvatarCacheEntry,
    writeTelegramChannelAvatarCache,
  } = await importTs("./telegram-channel-avatar-cache.ts");
  const dir = await mkdtemp(join(tmpdir(), "telegram-avatar-cache-"));
  const filePath = join(dir, "cache.json");

  try {
    const cache = setTelegramChannelAvatarCacheEntry(
      {},
      "channel:1",
      "data:image/jpeg;base64,abc",
      1000,
    );
    await writeTelegramChannelAvatarCache(filePath, cache);
    const saved = await readTelegramChannelAvatarCache(filePath);

    assert.equal(saved["channel:1"].avatar, "data:image/jpeg;base64,abc");
    assert.equal(saved["channel:1"].updatedAt, 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
