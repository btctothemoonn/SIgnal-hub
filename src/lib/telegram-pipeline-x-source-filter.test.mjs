import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "telegram-pipeline-x-filter-test-"));
  const files = [
    "telegram-pipeline-config.ts",
    "telegram-x-source-channels.ts",
    "telegram-pipeline-store.ts",
  ];
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };

  for (const file of files) {
    let source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    source = source
      .replace('from "./telegram-pipeline-config.ts"', 'from "./telegram-pipeline-config.mjs"')
      .replace('from "./telegram-x-source-channels.ts"', 'from "./telegram-x-source-channels.mjs"');
    await writeFile(
      join(dir, file.replace(/\.ts$/, ".mjs")),
      ts.transpileModule(source, { compilerOptions }).outputText,
      "utf8",
    );
  }

  return {
    store: await import(`file:///${join(dir, "telegram-pipeline-store.mjs").replace(/\\/g, "/")}`),
    xSource: await import(`file:///${join(dir, "telegram-x-source-channels.mjs").replace(/\\/g, "/")}`),
  };
}

process.env.TELEGRAM_X_SOURCE_CHANNELS = "xxxx6551monitor";

const {
  openTelegramPipelineDb,
  upsertTelegramPipelineChannel,
  upsertTelegramPipelineMessage,
  getTelegramPipelineSnapshot,
} = (await transpileToTemp()).store;

const { isTelegramXSourceChannel } = (await transpileToTemp()).xSource;
assert.equal(
  isTelegramXSourceChannel({ ref: "xxxx6551monitor", username: "xxxx6551monitor" }),
  true,
);

const db = openTelegramPipelineDb(":memory:");
upsertTelegramPipelineChannel(
  {
    ref: "xxxx6551monitor",
    title: "XXXX Monitor",
    username: "xxxx6551monitor",
    channelId: "65510001",
    link: "https://t.me/xxxx6551monitor",
    avatar: null,
    avatarUpdatedAt: null,
    tags: [],
  },
  db,
);
upsertTelegramPipelineChannel(
  {
    ref: "au_call",
    title: "AU Trading",
    username: "au_call",
    channelId: "2955560057",
    link: "https://t.me/au_call",
    avatar: null,
    avatarUpdatedAt: null,
    tags: [],
  },
  db,
);
upsertTelegramPipelineMessage(
  {
    channelRef: "xxxx6551monitor",
    channelTitle: "XXXX Monitor",
    channelUsername: "xxxx6551monitor",
    channelId: "65510001",
    channelLink: "https://t.me/xxxx6551monitor",
    channelAvatar: null,
    messageId: 1,
    messageUrl: "https://t.me/xxxx6551monitor/1",
    text: "🌟 监控到新推文",
    createdAt: "2026-04-28T00:00:00.000Z",
    views: 0,
    forwards: 0,
    origin: "history",
    media: null,
    raw: { id: 1 },
  },
  db,
);
upsertTelegramPipelineMessage(
  {
    channelRef: "au_call",
    channelTitle: "AU Trading",
    channelUsername: "au_call",
    channelId: "2955560057",
    channelLink: "https://t.me/au_call",
    channelAvatar: null,
    messageId: 2,
    messageUrl: "https://t.me/au_call/2",
    text: "visible telegram message",
    createdAt: "2026-04-28T00:01:00.000Z",
    views: 0,
    forwards: 0,
    origin: "history",
    media: null,
    raw: { id: 2 },
  },
  db,
);

const snapshot = getTelegramPipelineSnapshot(100, db);
assert.deepEqual(
  snapshot.channels.map((channel) => channel.username),
  ["au_call"],
);
assert.deepEqual(
  snapshot.feed.map((message) => message.channelUsername),
  ["au_call"],
);

console.log("ok - telegram pipeline hides X source channels from display snapshots");
