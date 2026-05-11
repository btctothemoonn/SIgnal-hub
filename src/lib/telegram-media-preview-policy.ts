const DEFAULT_TELEGRAM_MEDIA_PREVIEW_ITEMS = 12;

export function parseTelegramMediaPreviewLimit(
  raw: string | undefined,
  fallback = DEFAULT_TELEGRAM_MEDIA_PREVIEW_ITEMS,
) {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  if (value === "off" || value === "false" || value === "disabled") {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export function shouldDownloadTelegramMediaPreview(index: number, limit: number) {
  return Number.isInteger(index) && index >= 0 && index < Math.max(0, limit);
}

export function shouldDownloadTelegramChannelAvatars(raw: string | undefined) {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
