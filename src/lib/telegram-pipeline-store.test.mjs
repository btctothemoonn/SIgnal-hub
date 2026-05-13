import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function transpileToTemp() {
  const dir = await mkdtemp(join(tmpdir(), "telegram-pipeline-store-test-"));
  const runtimeStorageSource = await readFile(
    new URL("./runtime-storage.ts", import.meta.url),
    "utf8",
  );
  const configSource = (
    await readFile(new URL("./telegram-pipeline-config.ts", import.meta.url), "utf8")
  ).replace('from "./runtime-storage.ts"', 'from "./runtime-storage.mjs"');
  const xSourceChannelSource = await readFile(
    new URL("./telegram-x-source-channels.ts", import.meta.url),
    "utf8",
  );
  const translationPolicySource = await readFile(
    new URL("./telegram-translation-policy.ts", import.meta.url),
    "utf8",
  );
  const storeSource = (
    await readFile(new URL("./telegram-pipeline-store.ts", import.meta.url), "utf8")
  ).replace(
    'from "./telegram-pipeline-config.ts"',
    'from "./telegram-pipeline-config.mjs"',
  ).replace(
    'from "./telegram-translation-policy.ts"',
    'from "./telegram-translation-policy.mjs"',
  ).replace(
    'from "./telegram-x-source-channels.ts"',
    'from "./telegram-x-source-channels.mjs"',
  );

  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  await writeFile(
    join(dir, "runtime-storage.mjs"),
    ts.transpileModule(runtimeStorageSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "telegram-pipeline-config.mjs"),
    ts.transpileModule(configSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "telegram-x-source-channels.mjs"),
    ts.transpileModule(xSourceChannelSource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "telegram-translation-policy.mjs"),
    ts.transpileModule(translationPolicySource, { compilerOptions }).outputText,
    "utf8",
  );
  await writeFile(
    join(dir, "telegram-pipeline-store.mjs"),
    ts.transpileModule(storeSource, { compilerOptions }).outputText,
    "utf8",
  );
  return import(`file:///${join(dir, "telegram-pipeline-store.mjs").replace(/\\/g, "/")}`);
}

const {
  openTelegramPipelineDb,
  disableTelegramPipelineChannelsExcept,
  upsertTelegramPipelineChannel,
  upsertTelegramPipelineMessage,
  getTelegramPipelineMessageMediaPreview,
  getTelegramPipelineSnapshot,
  listTelegramPipelineTranslationCandidates,
  setTelegramPipelineMessageTranslation,
} = await transpileToTemp();

const db = openTelegramPipelineDb(":memory:");
upsertTelegramPipelineChannel(
  {
    ref: "au_call",
    title: "AU Trading",
    username: "au_call",
    channelId: "2955560057",
    link: "https://t.me/au_call",
    avatar: null,
    avatarUpdatedAt: null,
    tags: ["alpha"],
  },
  db,
);
upsertTelegramPipelineChannel(
  {
    ref: "AU_CALL",
    title: "AU Trading Updated",
    username: "au_call",
    channelId: "2955560057",
    link: "https://t.me/au_call",
    avatar: null,
    avatarUpdatedAt: null,
    tags: ["alpha"],
  },
  db,
);
upsertTelegramPipelineChannel(
  {
    ref: "old_cache_channel",
    title: "Old Cache",
    username: "old_cache_channel",
    channelId: "999",
    link: "https://t.me/old_cache_channel",
    avatar: null,
    avatarUpdatedAt: null,
    tags: [],
  },
  db,
);
disableTelegramPipelineChannelsExcept(["AU_CALL"], db);
upsertTelegramPipelineMessage(
  {
    channelRef: "au_call",
    channelTitle: "AU Trading",
    channelUsername: "au_call",
    channelId: "2955560057",
    channelLink: "https://t.me/au_call",
    channelAvatar: null,
    messageId: 123,
    messageUrl: "https://t.me/au_call/123",
    text: "hello",
    createdAt: "2026-04-28T00:00:00.000Z",
    views: 10,
    forwards: 1,
    origin: "history",
    media: {
      kind: "image",
      mimeType: "image/jpeg",
      previewUrl: "/api/telegram/media/2955560057/123.jpg",
      label: "图片预览",
      width: null,
      height: null,
    },
    translation: {
      provider: "mymemory",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      text: "你好",
    },
    quotedMessage: {
      id: "2955560057:122",
      text: "Don't forget our VW insider info.",
      createdAt: "2026-04-27T23:55:00.000Z",
      channelTitle: "AU Trading",
      channelUsername: "au_call",
      messageUrl: "https://t.me/au_call/122",
      media: null,
    },
    raw: { id: 123 },
  },
  db,
);
upsertTelegramPipelineChannel(
  {
    ref: "AU_CALL",
    title: "AU Trading Updated",
    username: "au_call",
    channelId: "2955560057",
    link: "https://t.me/au_call",
    avatar: "/api/telegram/media/avatars/2955560057.jpg",
    avatarUpdatedAt: "2026-04-28T00:00:00.000Z",
    tags: ["alpha"],
  },
  db,
);
upsertTelegramPipelineChannel(
  {
    ref: "BWETradfi",
    title: "BWETradFi | 方程式财经（传统金融新闻）",
    username: "BWETradfi",
    channelId: "888",
    link: "https://t.me/BWETradfi",
    avatar: null,
    avatarUpdatedAt: null,
    tags: ["macro"],
  },
  db,
);
upsertTelegramPipelineMessage(
  {
    channelRef: "BWETradfi",
    channelTitle: "BWETradFi | 方程式财经（传统金融新闻）",
    channelUsername: "BWETradfi",
    channelId: "888",
    channelLink: "https://t.me/BWETradfi",
    channelAvatar: null,
    messageId: 1,
    messageUrl: "https://t.me/BWETradfi/1",
    text: "Tradfin: *APPLE HAS BEEN TESTING INTEGRATIONS WITH GOOGLE AND ANTHROPIC",
    createdAt: "2026-04-27T23:50:00.000Z",
    views: 0,
    forwards: 0,
    origin: "realtime",
    media: null,
    translation: null,
    raw: { id: 1 },
  },
  db,
);

const snapshot = getTelegramPipelineSnapshot(100, db);
assert.equal(snapshot.channels.length, 2);
assert.equal(snapshot.channels[0].title, "AU Trading Updated");
const auMessage = snapshot.feed.find((message) => message.id === "2955560057:123");
const bweMessage = snapshot.feed.find((message) => message.id === "888:1");
assert.ok(auMessage);
assert.ok(bweMessage);
assert.equal(auMessage.channelAvatar, "/api/telegram/media/avatars/2955560057.jpg");
assert.equal(snapshot.feed.length, 2);
assert.equal(auMessage.media?.previewUrl, "/api/telegram/media/2955560057/123.jpg");
assert.equal(auMessage.quotedMessage?.text, "Don't forget our VW insider info.");
assert.equal(auMessage.quotedMessage?.messageUrl, "https://t.me/au_call/122");
assert.equal(snapshot.feed[0].translation?.text, "你好");
assert.equal(
  getTelegramPipelineMessageMediaPreview("2955560057", 123, db)?.previewUrl,
  "/api/telegram/media/2955560057/123.jpg",
);
assert.deepEqual(listTelegramPipelineTranslationCandidates(10, db), []);
setTelegramPipelineMessageTranslation("2955560057:123", {
  provider: "mymemory",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  text: "更新翻译",
}, db);
assert.equal(getTelegramPipelineSnapshot(100, db).feed[0].translation?.text, "更新翻译");
console.log("ok - telegram pipeline store builds dashboard snapshots");
