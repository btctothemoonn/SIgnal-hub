import { readMarketCardMetrics } from "./market-card-metrics.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { readMarketSignalsSnapshot } from "./market-signals.ts";

const DAY_MS = 24 * 60 * 60_000;

// Read both the initial page and its refreshes from the same local observations.
export function getMarketSignalsBoardData(nowMs = Date.now()) {
  const store = openMarketAlertsStore();
  try {
    const now = new Date(nowMs).toISOString();
    const fromMs = nowMs - DAY_MS;
    const alerts = store.getBoardAlerts(new Date(fromMs).toISOString(), now);
    const signals = readMarketSignalsSnapshot({ nowMs });
    const lifecycleEvents = store.listLifecycleEvents(fromMs, nowMs);
    const trackedCoins = new Set(lifecycleEvents.map(event => event.symbol));
    const cardSymbols = [...new Set([...alerts.events.map(event => event.symbol), ...trackedCoins])];
    const cardSet = new Set(cardSymbols);
    // A confirmation inside the board window may belong to an observation that began just before it.
    const volumeEpisodes = store.listVolumeEpisodes(fromMs - 2 * 3_600_000, nowMs)
      .filter(episode => cardSet.has(episode.symbol));
    const wanted = new Set(["BTCUSDT", ...cardSymbols, ...signals.signals.map(signal => signal.symbol)]);
    const tickers = store.getMarketTickers().filter(ticker => wanted.has(ticker.symbol));
    const assetClasses = Object.fromEntries(
      Object.entries(signals.symbolClasses).filter(([symbol]) => wanted.has(symbol)),
    );
    return {
      generatedAt: now,
      ...alerts,
      tickers,
      assetClasses,
      lifecycleEvents,
      volumeEpisodes,
      cardCandles: store.getCardCandles(cardSymbols, nowMs),
      cardMetrics: readMarketCardMetrics(cardSymbols, nowMs),
      signals: {
        ...signals,
        symbolClasses: {},
        coinSymbols: [...new Set([...signals.coinSymbols.filter(symbol => wanted.has(symbol)), ...trackedCoins])],
      },
    };
  } finally {
    store.close();
  }
}

export type MarketSignalsBoardData = ReturnType<typeof getMarketSignalsBoardData>;
