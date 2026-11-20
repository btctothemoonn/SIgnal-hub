import { readMarketCardMetrics } from "./market-card-metrics.ts";
import { MARKET_TICKER_FRESH_MS } from "./market-alerts-core.ts";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { readMarketSignalsSnapshot, type MarketBoardMarket } from "./market-signals.ts";

const DAY_MS = 24 * 60 * 60_000;

// Read both the initial page and its refreshes from the same local observations.
export function getMarketSignalsBoardData(nowMs = Date.now(), market: MarketBoardMarket = "crypto") {
  const store = openMarketAlertsStore();
  try {
    const now = new Date(nowMs).toISOString();
    const fromMs = nowMs - DAY_MS;
    const alerts = store.getBoardAlerts(new Date(fromMs).toISOString(), now);
    const { searchSymbols, ...signals } = readMarketSignalsSnapshot({ nowMs, market });
    const eligible = new Set(searchSymbols);
    const equities = market === "equities";
    const events = alerts.events.filter(event => eligible.has(event.symbol) && (!equities || event.type === "volatility"));
    const lifecycleEvents = equities ? [] : store.listLifecycleEvents(fromMs, nowMs).filter(event => eligible.has(event.symbol));
    const cardSymbols = [...new Set([...events.map(event => event.symbol), ...lifecycleEvents.map(event => event.symbol)])];
    const cardSet = new Set(cardSymbols);
    // A confirmation inside the board window may belong to an observation that began just before it.
    const volumeEpisodes = equities ? [] : store.listVolumeEpisodes(fromMs - 2 * 3_600_000, nowMs)
      .filter(episode => cardSet.has(episode.symbol));
    const tickers = store.getMarketTickers().filter(ticker => {
      const age = nowMs - Date.parse(ticker.updatedAt);
      return eligible.has(ticker.symbol) && age >= 0 && age <= MARKET_TICKER_FRESH_MS;
    });
    const assetClasses = equities ? Object.fromEntries(cardSymbols.map(symbol => [symbol, "EQUITY"])) : {};
    return {
      generatedAt: now,
      market,
      searchSymbols,
      ...alerts,
      events,
      tickers,
      assetClasses,
      lifecycleEvents,
      volumeEpisodes,
      cardCandles: store.getCardCandles(cardSymbols, nowMs),
      cardMetrics: readMarketCardMetrics(cardSymbols, nowMs),
      signals: {
        ...signals,
        symbolClasses: {},
        coinSymbols: equities ? [] : cardSymbols,
      },
    };
  } finally {
    store.close();
  }
}

export type MarketSignalsBoardData = ReturnType<typeof getMarketSignalsBoardData>;
