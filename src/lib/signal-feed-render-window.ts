export const SIGNAL_FEED_RENDER_BATCH_SIZE = 30;

function normalizeTotal(total: number) {
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}

export function initialSignalFeedRenderCount(total: number) {
  return Math.min(normalizeTotal(total), SIGNAL_FEED_RENDER_BATCH_SIZE);
}

export function nextSignalFeedRenderCount(current: number, total: number) {
  const normalizedTotal = normalizeTotal(total);
  const normalizedCurrent = Math.max(0, Math.floor(current));
  return Math.min(
    normalizedTotal,
    normalizedCurrent + SIGNAL_FEED_RENDER_BATCH_SIZE,
  );
}

export function signalFeedRenderCountForTarget<T extends { id: string }>(
  items: readonly T[],
  targetId: string,
  current: number,
) {
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return Math.min(Math.max(0, current), items.length);
  return Math.max(Math.min(Math.max(0, current), items.length), targetIndex + 1);
}
