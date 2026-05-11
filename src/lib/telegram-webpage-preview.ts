type TelegramWebPagePreviewInput = {
  url: string;
  width: number | null;
  height: number | null;
};

function isXStatusUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return (
      (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") &&
      /\/status\/\d+/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isLikelySquareAvatar(width: number | null, height: number | null) {
  if (!width || !height) {
    return false;
  }

  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  const ratio = longer / shorter;

  return ratio <= 1.12 && longer <= 600;
}

export function shouldDisplayTelegramWebPagePreview({
  url,
  width,
  height,
}: TelegramWebPagePreviewInput): boolean {
  if (!isXStatusUrl(url)) {
    return true;
  }

  return !isLikelySquareAvatar(width, height);
}
