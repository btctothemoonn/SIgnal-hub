import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

await test("isPersistedTelegramSnapshotFresh rejects stale or malformed cache records", async () => {
  const { isPersistedTelegramSnapshotFresh } = await importTs(
    "./telegram-snapshot-cache.ts",
  );

  assert.equal(
    isPersistedTelegramSnapshotFresh(
      { version: 1, fetchedAt: 1000, snapshot: { provider: "telegram" } },
      1000,
      1500,
    ),
    true,
  );
  assert.equal(
    isPersistedTelegramSnapshotFresh(
      { version: 1, fetchedAt: 1000, snapshot: { provider: "telegram" } },
      1000,
      2501,
    ),
    false,
  );
  assert.equal(isPersistedTelegramSnapshotFresh(null, 1000, 1500), false);
  assert.equal(
    isPersistedTelegramSnapshotFresh(
      { version: 2, fetchedAt: 1000, snapshot: { provider: "telegram" } },
      1000,
      1500,
    ),
    false,
  );
});

await test("mergeRealtimeUpdateIntoTelegramSnapshot prepends new messages without duplicates", async () => {
  const { mergeRealtimeUpdateIntoTelegramSnapshot } = await importTs(
    "./telegram-snapshot-cache.ts",
  );

  const oldItem = {
    id: "channel:1",
    channelRef: "@old",
    channelTitle: "Old",
    channelUsername: "old",
    channelId: "1",
    channelLink: "https://t.me/old",
    channelAvatar: null,
    messageUrl: "https://t.me/old/1",
    text: "old",
    createdAt: "2026-04-24T00:00:00.000Z",
    views: 0,
    forwards: 0,
    origin: "history",
    media: null,
    translation: null,
  };
  const newItem = {
    ...oldItem,
    id: "channel:2",
    text: "new",
    createdAt: "2026-04-24T00:01:00.000Z",
    origin: "realtime",
  };
  const snapshot = {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: "live",
    channels: [],
    feed: [oldItem],
    note: "",
    errors: [],
  };
  const update = {
    channel: "@old",
    channelTitle: "Old",
    createdAt: newItem.createdAt,
    feedItem: newItem,
  };

  const once = mergeRealtimeUpdateIntoTelegramSnapshot(snapshot, update);
  const twice = mergeRealtimeUpdateIntoTelegramSnapshot(once, update);

  assert.deepEqual(
    twice.feed.map((item) => item.id),
    ["channel:2", "channel:1"],
  );
  assert.equal(twice.status, "live");
  assert.equal(twice.isConnected, true);
});

await test("compactTelegramSnapshot removes repeated channel avatars from feed items", async () => {
  const { compactTelegramSnapshot } = await importTs("./telegram-snapshot-cache.ts");

  const snapshot = {
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: "live",
    channels: [
      {
        ref: "@old",
        title: "Old",
        username: "old",
        channelId: "1",
        link: "https://t.me/old",
        access: "mtproto",
        note: "",
        avatar: "data:image/jpeg;base64,abc",
      },
    ],
    feed: [
      {
        id: "channel:1",
        channelRef: "@old",
        channelTitle: "Old",
        channelUsername: "old",
        channelId: "1",
        channelLink: "https://t.me/old",
        channelAvatar: "data:image/jpeg;base64,abc",
        messageUrl: "https://t.me/old/1",
        text: "old",
        createdAt: "2026-04-24T00:00:00.000Z",
        views: 0,
        forwards: 0,
        origin: "history",
        media: null,
        translation: null,
      },
    ],
    note: "",
    errors: [],
  };

  const compacted = compactTelegramSnapshot(snapshot);

  assert.equal(compacted.channels[0].avatar, "data:image/jpeg;base64,abc");
  assert.equal(compacted.feed[0].channelAvatar, null);
});

await test("readPersistedTelegramSnapshotRecord recovers latest valid temporary snapshot", async () => {
  const { readPersistedTelegramSnapshotRecord } = await importTs(
    "./telegram-snapshot-cache.ts",
  );

  const dir = await mkdtemp(join(tmpdir(), "telegram-snapshot-cache-"));
  const filePath = join(dir, "telegram-snapshot-cache.json");
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${filePath}.111.1000.old.tmp`,
    `${JSON.stringify({
      version: 1,
      fetchedAt: 1000,
      snapshot: { provider: "telegram", feed: [{ id: "old" }] },
    })}\n`,
    "utf8",
  );
  await writeFile(
    `${filePath}.111.2000.new.tmp`,
    `${JSON.stringify({
      version: 1,
      fetchedAt: 2000,
      snapshot: { provider: "telegram", feed: [{ id: "new" }] },
    })}\n`,
    "utf8",
  );

  const record = await readPersistedTelegramSnapshotRecord(filePath);

  assert.equal(record?.fetchedAt, 2000);
  assert.equal(record?.snapshot.feed[0].id, "new");
});
