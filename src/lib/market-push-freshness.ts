export type PushCandleWindow = {
  openAt: string | null;
  closeAt: string | null;
  intervalMs: number;
  contiguous: boolean;
};
export type OpportunityPushEvidence = {
  sourceTimes: Record<string, string | null>;
  candles: PushCandleWindow[];
  reusedCandle?: PushCandleWindow;
};
function timestamp(value: unknown): number {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}
export function pushSourceTime(value: unknown): string | null {
  const time = timestamp(value);
  return Number.isFinite(time) && time > 0 && time <= 8.64e15 ? new Date(time).toISOString() : null;
}
export function buildPushCandleWindow(rows: unknown[][], intervalMs: number, count: number): PushCandleWindow {
  const window = rows.slice(-count);
  const latest = window.at(-1);
  const contiguous = window.length === count && window.every((row, index) => {
    const open = timestamp(row[0]), close = timestamp(row[6]);
    return Number.isFinite(open) && open > 0 && close - open === intervalMs - 1 &&
      (index === 0 || open - timestamp(window[index - 1][0]) === intervalMs);
  });
  return { openAt: pushSourceTime(latest?.[0]), closeAt: pushSourceTime(latest?.[6]), intervalMs, contiguous };
}
export function isCurrentPushCandle(window: PushCandleWindow | undefined, nowMs: number, maxAgeMs: number): boolean {
  if (!window?.contiguous || ![60000, 300000].includes(window.intervalMs)) return false;
  const open = Date.parse(window.openAt ?? ''), close = Date.parse(window.closeAt ?? '');
  // A live candle's close is planned. Check the interval, never use that future time as an observation.
  return Number.isFinite(open) && open > 0 && close - open === window.intervalMs - 1 &&
    open <= nowMs && nowMs - close <= maxAgeMs;
}
