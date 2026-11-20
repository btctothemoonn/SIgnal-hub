// Binance candles use their UTC opening timestamp. Only fully closed buckets can be drawn.
export const CARD_CANDLE_MS = 5 * 60_000;
export const CARD_CANDLE_COUNT = 48;
export const CARD_WINDOW_MS = CARD_CANDLE_COUNT * CARD_CANDLE_MS;

export function cardWindowEnd(nowMs: number) {
  return Math.floor(nowMs / CARD_CANDLE_MS) * CARD_CANDLE_MS;
}
