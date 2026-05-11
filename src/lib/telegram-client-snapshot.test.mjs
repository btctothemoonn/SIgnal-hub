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

function feedItem(index) {
  return {
    id: `message:${index}`,
    channelRef: "channel",
    channelTitle: "Channel",
    channelUsername: "channel",
    channelId: "1",
    channelLink: "https://t.me/channel",
    channelAvatar: null,
    messageUrl: `https://t.me/channel/${index}`,
    text: `message ${index}`,
    createdAt: new Date(Date.UTC(2026, 3, 26, 10, 0 - index, 0)).toISOString(),
    views: 0,
    forwards: 0,
    origin: "history",
    media: {
      kind: "image",
      mimeType: "image/jpeg",
      previewUrl: "data:image/jpeg;base64,abc",
      label: "图片",
      width: 100,
      height: 100,
    },
    translation: null,
  };
}

await test("prepareTelegramSnapshotForClient limits feed and strips older media", async () => {
  const { prepareTelegramSnapshotForClient } = await importTs(
    "./telegram-client-snapshot.ts",
  );

  const snapshot = {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: "live",
    channels: [],
    feed: Array.from({ length: 5 }, (_, index) => feedItem(index)),
    note: "",
    errors: [],
  };

  const prepared = prepareTelegramSnapshotForClient(snapshot, {
    feedLimit: 3,
    mediaLimit: 1,
  });

  assert.deepEqual(
    prepared.feed.map((item) => item.id),
    ["message:0", "message:1", "message:2"],
  );
  assert.notEqual(prepared.feed[0].media, null);
  assert.equal(prepared.feed[1].media, null);
  assert.equal(prepared.feed[2].media, null);
});
