import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  upsertTelegramPipelineChannel,
  upsertTelegramPipelineMessage,
  setTelegramPipelineHealth,
} from "../src/lib/telegram-pipeline-store.ts";

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readSnapshotRecord() {
  const cachePath = resolve(process.cwd(), ".signal-hub", "telegram-snapshot-cache.json");
  const direct = await readJson(cachePath);
  if (direct?.snapshot?.provider === "telegram") {
    return direct;
  }

  let entries = [];
  try {
    entries = await readdir(dirname(cachePath));
  } catch {
    return null;
  }

  const prefix = `${basename(cachePath)}.`;
  const candidates = entries.filter(
    (entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"),
  );
  let latest = null;
  for (const entry of candidates) {
    const record = await readJson(join(dirname(cachePath), entry));
    if (record?.snapshot?.provider !== "telegram") continue;
    if (!latest || Number(record.fetchedAt || 0) > Number(latest.fetchedAt || 0)) {
      latest = record;
    }
  }
  return latest;
}

const record = await readSnapshotRecord();
if (!record) {
  console.log("no telegram snapshot cache found");
  process.exit(0);
}

const snapshot = record.snapshot;
let channelCount = 0;
for (const channel of snapshot.channels || []) {
  upsertTelegramPipelineChannel({
    ref: channel.ref,
    title: channel.title,
    username: channel.username,
    channelId: channel.channelId,
    link: channel.link,
    avatar: channel.avatar || null,
    avatarUpdatedAt: channel.avatar ? new Date(record.fetchedAt).toISOString() : null,
    tags: [],
  });
  channelCount += 1;
}

let messageCount = 0;
for (const item of snapshot.feed || []) {
  upsertTelegramPipelineMessage({
    channelRef: item.channelRef,
    channelTitle: item.channelTitle,
    channelUsername: item.channelUsername,
    channelId: item.channelId,
    channelLink: item.channelLink,
    channelAvatar: item.channelAvatar,
    messageId: Number(String(item.id).split(":").pop()) || 0,
    messageUrl: item.messageUrl,
    text: item.text,
    createdAt: item.createdAt,
    views: item.views || 0,
    forwards: item.forwards || 0,
    origin: item.origin === "realtime" ? "realtime" : "history",
    media: item.media || null,
    raw: { importedFromSnapshot: true, id: item.id },
  });
  messageCount += 1;
}

setTelegramPipelineHealth({
  scope: "collector",
  status: "stale",
  detail: `已从旧缓存导入 ${channelCount} 个频道、${messageCount} 条消息；实时采集等待 Telegram 连接恢复`,
});

console.log(
  JSON.stringify({
    event: "telegram_pipeline_cache_imported",
    channelCount,
    messageCount,
  }),
);
