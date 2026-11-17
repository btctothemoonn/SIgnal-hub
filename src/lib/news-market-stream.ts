import type { NewsCandle, NewsMarket } from "./news-terminal-types.ts";

export const NEWS_CANDLE_STEPS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

export function parseNewsCandleMessage(raw: string, venue: NewsMarket["venue"], pair: string, interval: string): { candle: NewsCandle; eventAt: number } | null {
  try {
    const message = JSON.parse(raw);
    let row;
    let eventAt;
    if (venue === "binance") {
      const event = message.data ?? message;
      row = event.k;
      if (event.e !== "kline" || event.s !== pair || row?.s !== pair || row.i !== interval) return null;
      eventAt = Number(event.E);
    } else {
      if (message.channel !== "candle") return null;
      row = message.data;
      if (row?.s !== pair || row.i !== interval) return null;
      // Hyperliquid candles have no separate event timestamp. WebSocket delivery order is retained.
      eventAt = Date.now();
    }
    const values = [row.t, row.o, row.h, row.l, row.c, row.v];
    if (values.some((value) => typeof value !== "string" && typeof value !== "number")) return null;
    const [timeMs, open, high, low, close, volume] = values.map(Number);
    const time = timeMs / 1000;
    const step = NEWS_CANDLE_STEPS[interval];
    if (![time, open, high, low, close, volume, eventAt].every(Number.isFinite) || !step || time <= 0 || time % step !== 0 || timeMs > Date.now() + step * 1000 || Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || volume < 0) return null;
    return { candle: { time, open, high, low, close, volume }, eventAt };
  } catch { return null; }
}

export function mergeNewsCandles(previous: NewsCandle[], incoming: NewsCandle[], limit = 500): NewsCandle[] {
  return [...new Map([...previous, ...incoming].map((candle) => [candle.time, candle])).values()]
    .sort((left, right) => left.time - right.time).slice(-limit);
}

type CandleStreamOptions = {
  venue: NewsMarket["venue"];
  pair: string;
  interval: string;
  onCandle: (candle: NewsCandle, eventAt: number) => void;
  onState: (live: boolean) => void;
  onReconnect: () => void;
  createSocket?: (url: string) => WebSocket;
};

export function connectNewsCandles(options: CandleStreamOptions): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let opened = false;
  let lastDataAt = 0;
  let lastEventAt = 0;
  let lastCandleAt = 0;
  const { venue, pair, interval } = options;
  function schedule() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, Math.min(30_000, 1000 * 2 ** Math.min(retries++, 5)));
  }
  function open() {
    if (stopped) return;
    const url = venue === "binance"
      ? `wss://fstream.binance.com/market/ws/${encodeURIComponent(pair.toLowerCase())}@kline_${interval}`
      : "wss://api.hyperliquid.xyz/ws";
    try { socket = (options.createSocket ?? ((address) => new WebSocket(address)))(url); }
    catch { options.onState(false); schedule(); return; }
    const current = socket;
    const disconnect = () => {
      if (stopped || current !== socket) return;
      if (heartbeat) clearInterval(heartbeat);
      if (connectionTimer) clearTimeout(connectionTimer);
      current.onclose = null;
      current.onerror = null;
      current.onmessage = null;
      current.onopen = null;
      current.close();
      options.onState(false);
      schedule();
    };
    current.onopen = () => {
      if (stopped || current !== socket) return;
      if (connectionTimer) clearTimeout(connectionTimer);
      lastDataAt = Date.now();
      if (venue === "hyperliquid") current.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", coin: pair, interval } }));
      if (opened) options.onReconnect();
      opened = true;
      heartbeat = setInterval(() => {
        if (Date.now() - lastDataAt > 45_000) { disconnect(); return; }
        if (venue === "hyperliquid" && current.readyState === 1) current.send(JSON.stringify({ method: "ping" }));
      }, 15_000);
    };
    current.onmessage = (event) => {
      if (stopped || current !== socket || typeof event.data !== "string") return;
      const parsed = parseNewsCandleMessage(event.data, venue, pair, interval);
      if (!parsed || parsed.candle.time < lastCandleAt || (parsed.candle.time === lastCandleAt && parsed.eventAt < lastEventAt)) return;
      lastDataAt = Date.now();
      lastEventAt = parsed.eventAt;
      lastCandleAt = parsed.candle.time;
      retries = 0;
      options.onState(true);
      options.onCandle(parsed.candle, parsed.eventAt);
    };
    current.onerror = disconnect;
    current.onclose = disconnect;
    connectionTimer = setTimeout(disconnect, 15_000);
  }
  open();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (connectionTimer) clearTimeout(connectionTimer);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  };
}
