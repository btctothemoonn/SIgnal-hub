const SKIP_TRANSLATION_CHANNELS = new Set(["bwetradfi"]);

function normalizeChannelKey(value: string | null | undefined) {
  return (value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function shouldSkipTelegramChannelTranslation(channel: {
  channelUsername?: string | null;
  channelRef?: string | null;
  channelTitle?: string | null;
}) {
  const username = normalizeChannelKey(channel.channelUsername);
  const ref = normalizeChannelKey(channel.channelRef);
  const title = normalizeChannelKey(channel.channelTitle);

  return (
    SKIP_TRANSLATION_CHANNELS.has(username) ||
    SKIP_TRANSLATION_CHANNELS.has(ref) ||
    title.includes("bwetradfi")
  );
}
