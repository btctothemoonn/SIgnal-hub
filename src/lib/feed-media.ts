export function isMediaPage(url: string) {
  return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(url);
}

export function playableMediaUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https:\/\/[^\s?#]+\.mp4(?:[?#]|$)/i.test(value) ? value : undefined;
}

export function readPlaybackUrl(item: Record<string, unknown>): string | undefined {
  const info = (item.video_info ?? item.videoInfo) as Record<string, unknown> | undefined;
  const variants = info?.variants ?? item.variants ?? item.videoVariants;
  if (Array.isArray(variants)) {
    const best = variants.filter(variant => playableMediaUrl(variant?.url))
      .sort((left, right) => Number(right.bitrate || 0) - Number(left.bitrate || 0))[0];
    if (best) return best.url;
  }
  return [item.playbackUrl, item.videoUrl, item.video_url, item.url, item.previewUrl].map(playableMediaUrl).find(Boolean);
}
