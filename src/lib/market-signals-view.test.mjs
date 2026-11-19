import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMarketAlertsStore } from "./market-alerts-store.ts";
import { getMarketSignalsBoardData } from "./market-signals-view.ts";

const dir = mkdtempSync(join(tmpdir(), "volume-board-"));
process.env.SIGNAL_HUB_RUNTIME_DIR = dir;
process.env.MARKET_ALERTS_DB = join(dir, "alerts.sqlite");
process.env.MARKET_SIGNALS_DB = join(dir, "signals.sqlite");
const now = Date.UTC(2026, 10, 19, 3);
const store = openMarketAlertsStore();
try {
  for (let i = 0; i < 202; i++) {
    const time = new Date(now - i * 60_000).toISOString();
    store.insertMarketAlertEvent({
      id: "pump-" + i, symbol: "PIEVERSEUSDT", type: "volatility", side: "LONG",
      level: 1, stage: "暴涨预警", trigger: "B加速", source: "ws", price: 1.203,
      volumeRatio: 2, changePct: 5, score: null, reasons: [], metrics: {}, occurredAt: time, createdAt: time,
    });
  }
  const minute = 60_000;
  const firstAt = now - 10 * minute;
  const symbol = "BURSTUSDT";
  const candles = Array.from({ length: 21 }, (_, i) => ({
    symbol, at: firstAt - (21 - i) * minute, open: 1, high: 1.2, low: 0.95,
    close: 1.1, quoteVolume: i === 20 ? 60_000 : 10_000, observeVolume: true,
  }));
  store.recordCardMinutes(candles, now);
  store.recordCardMinutes(candles.map(bar => ({ ...bar, symbol: "PIEVERSEUSDT" })), now);
  const stageOnly = "STAGEUSDT";
  store.recordCardMinutes(candles.map(bar => ({ ...bar, symbol: stageOnly })), now);
  const quarters = Array.from({ length: 100 }, (_, i) => ({
    at: now - (99 - i) * 15 * minute, high: i === 99 ? 1.26 : 1.01, low: 1, close: i === 99 ? 1.25 : 1,
  }));
  store.lifecycle.storeBars(stageOnly, quarters);
  store.lifecycle.evaluate([stageOnly], now);
  const late = new Date(now - 86_399_000).toISOString();
  store.insertMarketAlertEvent({
    id: "late", symbol: "PIEVERSEUSDT", type: "volatility", side: "LONG", level: 1,
    stage: "暴涨预警", trigger: "B加速", source: "ws", price: 1.203,
    volumeRatio: 2, changePct: 5, score: null, reasons: [], metrics: {},
    occurredAt: new Date(now - 86_460_000).toISOString(), createdAt: late,
  });
  const board = getMarketSignalsBoardData(now);
  assert.equal(board.events.length, 203, "all confirmations inside the observation window reach the card");
  assert.equal(board.events.at(-1).id, "late");
  assert.deepEqual(board.lifecycleEvents.map(({ kind, symbol }) => [kind, symbol]), [["pumped", stageOnly]]);
  assert.ok(board.signals.coinSymbols.includes(stageOnly), "a lifecycle event can open a crypto card without a raw alert");
  assert.equal(board.cardCandles[stageOnly].length, candles.length);
  assert.ok(!board.volumeEpisodes.some(item => item.symbol === symbol), "a standalone burst stays out of the board");
  assert.ok(!(symbol in board.cardMetrics) && !(symbol in board.cardCandles));
  const episode = board.volumeEpisodes.find(item => item.symbol === "PIEVERSEUSDT");
  assert.ok(episode, "an alert card keeps the matching volume history");
  assert.equal(episode.firstPrice, 1.1);
  assert.equal(episode.firstRatio, 6);
  assert.equal(board.cardCandles.PIEVERSEUSDT.at(-1).at, firstAt - minute);
  assert.equal(board.cardMetrics.PIEVERSEUSDT?.shortLiquidations15m, null);
  assert.equal(store.getMarketAlertsSnapshot({ limit: 300 }).events.length, 200, "legacy pagination still caps a page at 200");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
