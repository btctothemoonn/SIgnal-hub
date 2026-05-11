export type TelegramXSourceLike = {
  ref?: unknown;
  username?: unknown;
  channelUsername?: unknown;
  channel_username?: unknown;
  channelId?: unknown;
  channel_id?: unknown;
  title?: unknown;
  channelTitle?: unknown;
  channel_title?: unknown;
};

function normalizeToken(value: unknown): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    (typeof value !== "object" ||
      value === null ||
      typeof value.toString !== "function")
  ) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .toLowerCase();
}

export function getTelegramXSourceChannelKeys(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const raw = env.TELEGRAM_X_SOURCE_CHANNELS || "xxxx6551monitor";
  return new Set(
    raw
      .split(/[\n,\s，]+/)
      .map(normalizeToken)
      .filter(Boolean),
  );
}

export function isTelegramXSourceChannel(
  channel: TelegramXSourceLike,
  keys = getTelegramXSourceChannelKeys(),
): boolean {
  if (keys.size === 0) return false;

  return [
    channel.ref,
    channel.username,
    channel.channelUsername,
    channel.channel_username,
    channel.channelId,
    channel.channel_id,
    channel.title,
    channel.channelTitle,
    channel.channel_title,
  ].some((value) => {
    const normalized = normalizeToken(value);
    return normalized ? keys.has(normalized) : false;
  });
}
