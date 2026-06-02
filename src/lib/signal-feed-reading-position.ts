export type SignalFeedReadingAnchor = {
  itemId: string;
  viewportTop: number;
  savedAt: string;
};

export function parseSignalFeedReadingAnchor(
  raw: string | null,
): SignalFeedReadingAnchor | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SignalFeedReadingAnchor>;
    if (
      typeof parsed.itemId !== "string" ||
      !parsed.itemId.trim() ||
      typeof parsed.viewportTop !== "number" ||
      !Number.isFinite(parsed.viewportTop) ||
      typeof parsed.savedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.savedAt))
    ) {
      return null;
    }

    return {
      itemId: parsed.itemId,
      viewportTop: parsed.viewportTop,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function calculateSignalFeedScrollDelta(
  anchorTop: number,
  currentTop: number,
) {
  return currentTop - anchorTop;
}
