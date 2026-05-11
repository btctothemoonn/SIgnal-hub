import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { ConnectionTCPObfuscated } from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";
import {
  loadRuntimeConfig,
} from "../src/lib/runtime-config.ts";
import {
  translateText,
} from "../src/lib/translate.ts";
import {
  getTelegramPipelineConfig,
} from "../src/lib/telegram-pipeline-config.ts";
import {
  normalizeTelegramRefKey,
} from "../src/lib/telegram-ref.ts";
import {
  extractTelegramButtonLinks,
} from "../src/lib/telegram-message-buttons.ts";
import {
  disableTelegramPipelineChannelsExcept,
  listTelegramPipelineTranslationCandidates,
  listTelegramPipelineChannels,
  getTelegramPipelineMessageMediaPreview,
  markTelegramPipelineBackfill,
  setTelegramPipelineMessageTranslation,
  setTelegramPipelineHealth,
  upsertTelegramPipelineChannel,
  upsertTelegramPipelineMessage,
} from "../src/lib/telegram-pipeline-store.ts";

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function parseList(raw) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTelegramTranslationEnabled() {
  const raw = process.env.TELEGRAM_TRANSLATE_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

function getTelegramTranslationTarget() {
  return process.env.TELEGRAM_TRANSLATE_TARGET?.trim() || "zh-CN";
}

function translationBackfillLimit() {
  const parsed = Number(process.env.TELEGRAM_TRANSLATION_BACKFILL_LIMIT || "100");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

async function translateTelegramText(text) {
  return translateText(text, {
    enabled: isTelegramTranslationEnabled(),
    targetLanguage: getTelegramTranslationTarget(),
    cacheNamespace: "telegram-pipeline",
  });
}

function channelKey(ref) {
  return normalizeTelegramRefKey(ref);
}

function normalizeId(value) {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "object" && typeof value.toString === "function"
      ? value.toString()
      : String(value);
  return raw.replace(/^-100/, "");
}

function pickString(value) {
  return typeof value === "string" ? value : "";
}

function messageText(message) {
  return (
    pickString(message?.message) ||
    pickString(message?.text) ||
    pickString(message?.rawText)
  );
}

function messageDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

function messageNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildTelegramMessageUrl(channel, messageId) {
  const username = channel.username || channel.ref.replace(/^@+/, "");
  return username ? `https://t.me/${username}/${messageId}` : channel.link;
}

function getReplyToMessageId(message) {
  return (
    messageNumber(message?.replyToMsgId) ||
    messageNumber(message?.replyTo?.replyToMsgId) ||
    0
  );
}

function inferMedia(message) {
  const media = message?.media;
  if (!media) return null;
  const className = String(media.className || media.constructor?.name || "");
  const mimeType = pickString(media.mimeType) || pickString(media.document?.mimeType);
  if (/video/i.test(mimeType) || /video/i.test(className)) {
    return { kind: "video", mimeType: mimeType || "video/mp4", extension: "mp4" };
  }
  if (/gif/i.test(mimeType)) {
    return { kind: "gif", mimeType: mimeType || "image/gif", extension: "gif" };
  }
  if (/sticker/i.test(mimeType)) {
    return { kind: "sticker", mimeType: mimeType || "image/webp", extension: "webp" };
  }
  if (/photo|document/i.test(className) || media) {
    return { kind: "image", mimeType: mimeType || "image/jpeg", extension: "jpg" };
  }
  return null;
}

function normalizeChannel(entity, ref, tags = [], avatar = null, avatarUpdatedAt = null) {
  const username = pickString(entity?.username).replace(/^@+/, "") || channelKey(ref);
  const channelId = normalizeId(entity?.id || entity?.channelId || ref);
  return {
    ref: channelKey(username || ref),
    title: pickString(entity?.title) || username || ref,
    username,
    channelId,
    link: username ? `https://t.me/${username}` : "",
    avatar,
    avatarUpdatedAt,
    tags,
  };
}

async function writeMediaFile(config, channelId, file, bytes) {
  const dir = join(config.mediaDir, channelId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), bytes);
  return `${config.mediaRouteBase}/${channelId}/${file}`;
}

async function maybeDownloadAvatar(client, entity, channel, config) {
  const now = Date.now();
  const hasFileAvatar = channel.avatar && !channel.avatar.startsWith("data:");
  if (
    hasFileAvatar &&
    channel.avatarUpdatedAt &&
    now - new Date(channel.avatarUpdatedAt).getTime() < config.channelAvatarTtlMs
  ) {
    return { avatar: channel.avatar, avatarUpdatedAt: channel.avatarUpdatedAt };
  }

  try {
    const bytes = await client.downloadProfilePhoto(entity, { isBig: false });
    if (!Buffer.isBuffer(bytes)) {
      return { avatar: channel.avatar, avatarUpdatedAt: channel.avatarUpdatedAt };
    }
    const avatar = await writeMediaFile(config, "avatars", `${channel.channelId}.jpg`, bytes);
    return { avatar, avatarUpdatedAt: new Date().toISOString() };
  } catch (error) {
    log("telegram_avatar_failed", { ref: channel.ref, error: String(error) });
    return { avatar: channel.avatar, avatarUpdatedAt: channel.avatarUpdatedAt };
  }
}

async function maybeDownloadMessageMedia(client, message, channel, config, index) {
  const messageId = messageNumber(message?.id);
  if (messageId) {
    const existing = getTelegramPipelineMessageMediaPreview(channel.channelId, messageId);
    if (existing?.previewUrl) {
      return existing;
    }
  }

  const inferred = inferMedia(message);
  if (!inferred || index >= config.mediaPreviewItems) {
    return null;
  }

  try {
    const bytes = await client.downloadMedia(message);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 2_500_000) {
      return null;
    }
    const previewUrl = await writeMediaFile(
      config,
      channel.channelId,
      `${message.id}.${inferred.extension}`,
      bytes,
    );
    return {
      kind: inferred.kind,
      mimeType: inferred.mimeType,
      previewUrl,
      label: inferred.kind === "video" ? "视频预览" : "图片预览",
      width: null,
      height: null,
    };
  } catch (error) {
    log("telegram_media_failed", {
      ref: channel.ref,
      messageId: message.id,
      error: String(error),
    });
    return null;
  }
}

async function resolveQuotedMessage(client, entity, message, channel) {
  const replyMessageId = getReplyToMessageId(message);
  const quotedText = pickString(message?.replyTo?.quoteText);
  if (!replyMessageId && !quotedText) return null;

  let replyMessage = null;
  if (typeof message?.getReplyMessage === "function") {
    try {
      replyMessage = await message.getReplyMessage();
    } catch (error) {
      log("telegram_reply_fetch_failed", {
        ref: channel.ref,
        messageId: message?.id,
        replyMessageId,
        method: "getReplyMessage",
        error: String(error),
      });
    }
  }

  if (!replyMessage && replyMessageId) {
    try {
      const fetched = await client.getMessages(entity, { ids: replyMessageId });
      replyMessage = Array.isArray(fetched) ? fetched[0] : Array.from(fetched || [])[0];
    } catch (error) {
      log("telegram_reply_fetch_failed", {
        ref: channel.ref,
        messageId: message?.id,
        replyMessageId,
        method: "getMessages",
        error: String(error),
      });
    }
  }

  const id = messageNumber(replyMessage?.id) || replyMessageId;
  if (!id) return null;

  const text = messageText(replyMessage) || quotedText;
  return {
    id: `${channel.channelId}:${id}`,
    text,
    createdAt: replyMessage ? messageDate(replyMessage.date) : "",
    channelTitle: channel.title,
    channelUsername: channel.username || channel.ref.replace(/^@+/, ""),
    messageUrl: buildTelegramMessageUrl(channel, id),
    media: null,
  };
}

function toMessageInput(message, channel, origin, media, quotedMessage = null) {
  const id = messageNumber(message?.id);
  if (!id) return null;
  const username = channel.username || channel.ref.replace(/^@+/, "");
  return {
    channelRef: channel.ref,
    channelTitle: channel.title,
    channelUsername: username,
    channelId: channel.channelId,
    channelLink: channel.link,
    channelAvatar: channel.avatar,
    messageId: id,
    messageUrl: buildTelegramMessageUrl(channel, id),
    text: messageText(message),
    createdAt: messageDate(message?.date),
    views: messageNumber(message?.views),
    forwards: messageNumber(message?.forwards),
    origin,
    media,
    quotedMessage,
    raw: {
      id,
      message: messageText(message),
      date: messageDate(message?.date),
      views: messageNumber(message?.views),
      forwards: messageNumber(message?.forwards),
      replyToMessageId: getReplyToMessageId(message),
      quoteText: pickString(message?.replyTo?.quoteText),
      buttons: extractTelegramButtonLinks(message?.replyMarkup),
    },
  };
}

async function toTranslatedMessageInput(client, entity, message, channel, origin, media) {
  const quotedMessage = await resolveQuotedMessage(client, entity, message, channel);
  const input = toMessageInput(message, channel, origin, media, quotedMessage);
  if (!input) return null;
  return {
    ...input,
    translation: await translateTelegramText(input.text),
  };
}

async function backfillMissingTranslations(limit = translationBackfillLimit()) {
  const candidates = listTelegramPipelineTranslationCandidates(limit);
  let translated = 0;
  for (const candidate of candidates) {
    const translation = await translateTelegramText(candidate.text);
    if (!translation) continue;
    setTelegramPipelineMessageTranslation(candidate.id, translation);
    translated += 1;
  }
  if (translated > 0) {
    log("telegram_translation_backfilled", {
      checked: candidates.length,
      translated,
    });
  }
}

async function createClient(config) {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const session = process.env.TELEGRAM_SESSION || "";
  if (!apiId || !apiHash || !session) {
    throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION 未配置完整");
  }

  const clientParams = {
    connection: ConnectionTCPObfuscated,
    connectionRetries: 2,
    reconnectRetries: Infinity,
    retryDelay: 3000,
    autoReconnect: true,
    maxConcurrentDownloads: 1,
  };
  if (config.proxy) {
    clientParams.proxy = config.proxy;
    log("telegram_proxy_enabled", {
      host: config.proxy.ip,
      port: config.proxy.port,
      socksType: config.proxy.socksType,
    });
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, clientParams);
  await client.connect();
  if (!client.connected) {
    throw new Error("Telegram 连接失败：client.connect() 后仍未 connected");
  }
  const authorized = await client.checkAuthorization();
  if (!authorized) {
    throw new Error("TELEGRAM_SESSION 无效，请重新登录");
  }
  await client.getMe();
  return client;
}

async function configuredRefs() {
  const runtime = await loadRuntimeConfig();
  const tagByRef = new Map();
  for (const item of runtime.telegramChannels) {
    tagByRef.set(channelKey(item.ref), item.tags);
  }
  const refs = [
    ...runtime.telegramChannels.map((item) => item.ref),
    ...parseList(process.env.TELEGRAM_CHANNELS),
  ];
  const seen = new Set();
  return refs
    .map((ref) => ref.trim())
    .filter((ref) => {
      const key = channelKey(ref);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((ref) => ({ ref, tags: tagByRef.get(channelKey(ref)) || [] }));
}

async function syncChannels(client, config) {
  const targets = await configuredRefs();
  disableTelegramPipelineChannelsExcept(targets.map((target) => channelKey(target.ref)));
  const existing = new Map(
    listTelegramPipelineChannels().map((channel) => [channelKey(channel.ref), channel]),
  );
  const channels = [];
  for (const target of targets) {
    try {
      const entity = await client.getEntity(target.ref);
      const previous = existing.get(channelKey(target.ref));
      const base = normalizeChannel(
        entity,
        target.ref.replace(/^@+/, ""),
        target.tags,
        previous?.avatar || null,
        previous?.avatarUpdatedAt || null,
      );
      const avatar = await maybeDownloadAvatar(client, entity, base, config);
      const channel = {
        ...base,
        ...avatar,
        lastMessageId: previous?.lastMessageId || 0,
        lastBackfillAt: previous?.lastBackfillAt || null,
      };
      upsertTelegramPipelineChannel(channel);
      channels.push({ channel, entity });
      log("telegram_channel_synced", { ref: channel.ref, title: channel.title });
    } catch (error) {
      setTelegramPipelineHealth({
        scope: `channel:${target.ref}`,
        status: "error",
        detail: String(error),
      });
      log("telegram_channel_sync_failed", { ref: target.ref, error: String(error) });
    }
  }
  return channels;
}

async function backfillChannel(client, config, channel, entity, mode = "full") {
  try {
    const messageOptions = { limit: config.messagesPerChannel };
    if (mode === "incremental" && channel.lastMessageId > 0) {
      messageOptions.limit = config.incrementalMessagesPerChannel;
      messageOptions.minId = channel.lastMessageId;
    }
    const messages = Array.from(
      await client.getMessages(entity, messageOptions),
    );
    let count = 0;
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const media = await maybeDownloadMessageMedia(client, message, channel, config, index);
      const input = await toTranslatedMessageInput(
        client,
        entity,
        message,
        channel,
        "history",
        media,
      );
      if (!input) continue;
      upsertTelegramPipelineMessage(input);
      count += 1;
    }
    markTelegramPipelineBackfill(channel.ref, null);
    log("telegram_channel_backfilled", { ref: channel.ref, count, mode });
  } catch (error) {
    markTelegramPipelineBackfill(channel.ref, String(error));
    log("telegram_channel_backfill_failed", { ref: channel.ref, error: String(error) });
  }
}

function matchChannel(channels, message, chat) {
  const username = pickString(chat?.username).replace(/^@+/, "").toLowerCase();
  const chatId = normalizeId(chat?.id || message?.chatId);
  return channels.find(({ channel }) => {
    return (
      (username && channel.username.toLowerCase() === username) ||
      (chatId && channel.channelId === chatId)
    );
  });
}

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  const once = process.argv.includes("--once");
  const forceFullBackfill = process.argv.includes("--full");
  const config = getTelegramPipelineConfig();
  setTelegramPipelineHealth({
    scope: "collector",
    status: "starting",
    detail: "Telegram Pipeline 启动中",
  });

  const client = await createClient(config);
  let channels = await syncChannels(client, config);
  for (const { channel, entity } of channels) {
    await backfillChannel(
      client,
      config,
      channel,
      entity,
        forceFullBackfill ? "full" : channel.lastBackfillAt ? "incremental" : "full",
      );
  }

  setTelegramPipelineHealth({
    scope: "collector",
    status: "live",
    detail: `已监听 ${channels.length} 个 Telegram 频道`,
  });

  void backfillMissingTranslations().catch((error) => {
    log("telegram_translation_backfill_failed", { error: String(error) });
  });

  if (once) {
    await client.disconnect();
    return;
  }

  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      const chat = typeof message?.getChat === "function" ? await message.getChat() : null;
      const matched = matchChannel(channels, message, chat);
      if (!matched) return;
      const media = await maybeDownloadMessageMedia(
        client,
        message,
        matched.channel,
        config,
        0,
      );
      const input = await toTranslatedMessageInput(
        client,
        matched.entity,
        message,
        matched.channel,
        "realtime",
        media,
      );
      if (!input) return;
      upsertTelegramPipelineMessage(input);
      setTelegramPipelineHealth({
        scope: "collector",
        status: "live",
        detail: `收到 ${matched.channel.title} 新消息`,
      });
      log("telegram_realtime_message", {
        ref: matched.channel.ref,
        messageId: input.messageId,
      });
      void backfillMissingTranslations().catch((error) => {
        log("telegram_translation_backfill_failed", { error: String(error) });
      });
    } catch (error) {
      setTelegramPipelineHealth({
        scope: "collector",
        status: "error",
        detail: String(error),
      });
      log("telegram_realtime_failed", { error: String(error) });
    }
  }, new NewMessage({}));

  setInterval(async () => {
    try {
      channels = await syncChannels(client, config);
      for (const { channel, entity } of channels) {
        await backfillChannel(client, config, channel, entity, "incremental");
      }
      void backfillMissingTranslations().catch((error) => {
        log("telegram_translation_backfill_failed", { error: String(error) });
      });
      setTelegramPipelineHealth({
        scope: "collector",
        status: "live",
        detail: `补漏完成，频道 ${channels.length} 个`,
      });
    } catch (error) {
      setTelegramPipelineHealth({
        scope: "collector",
        status: "error",
        detail: String(error),
      });
      log("telegram_backfill_loop_failed", { error: String(error) });
    }
  }, config.backfillIntervalMs);

  log("telegram_pipeline_worker_started", { channels: channels.length });
}

main().catch((error) => {
  setTelegramPipelineHealth({
    scope: "collector",
    status: "error",
    detail: String(error),
  });
  log("telegram_pipeline_worker_failed", { error: String(error) });
  process.exit(1);
});
