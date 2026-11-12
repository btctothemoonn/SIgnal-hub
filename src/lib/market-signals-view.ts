import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { readMarketSignalsSnapshot } from "./market-signals.ts";

const DAY_MS = 24 * 60 * 60_000;

// Everything the /alerts board renders, read from local SQLite only (no exchange requests).
export function getMarketSignalsBoardData(nowMs = Date.now()) {
  const store = openMarketAlertsStore();
  try {
    const now = new Date(nowMs).toISOString();
    const alerts = store.getMarketAlertsSnapshot({ limit: 200, from: new Date(nowMs - DAY_MS).toISOString(), now });
    const signals = readMarketSignalsSnapshot({ nowMs });
    const wanted = new Set<string>(["BTCUSDT"]);
    for (const event of alerts.events) wanted.add(event.symbol);
    for (const signal of signals.signals) wanted.add(signal.symbol);
    const tickers = store.getMarketTickers().filter((ticker) => wanted.has(ticker.symbol));
    const assetClasses = Object.fromEntries(
      Object.entries(signals.symbolClasses).filter(([symbol]) => wanted.has(symbol)),
    );
    return {
      generatedAt: now,
      latestUpdatedAt: alerts.latestUpdatedAt,
      events: alerts.events,
      health: alerts.health,
      tickers,
      assetClasses,
      signals: { ...signals, symbolClasses: {} },
    };
  } finally {
    store.close();
  }
}

export type MarketSignalsBoardData = ReturnType<typeof getMarketSignalsBoardData>;
