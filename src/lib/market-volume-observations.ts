import type { DatabaseSync } from "node:sqlite";
import { CARD_CANDLE_COUNT, CARD_CANDLE_MS, CARD_WINDOW_MS, cardWindowEnd } from "./market-card-window.ts";
import { ALERTS_LIQUIDATION_RETENTION_MS } from "./market-alerts-retention.ts";

const MINUTE = 60_000;
const EPISODE_MS = 120 * MINUTE;
const HIT_RETENTION_MS = 30 * 86_400_000;
// Keep the whole four-hour chart even when now falls inside the next five-minute bucket.
const CANDLE_RETENTION_MS = CARD_WINDOW_MS + CARD_CANDLE_MS;
const BASELINE = 20;

export type CardCandle = { at: number; open: number; high: number; low: number; close: number };
export type CardFiveMinuteCandle = CardCandle & { quoteVolume: number };
export type MarketCardMinute = CardCandle & { symbol: string; quoteVolume: number; observeVolume: boolean };
export type VolumeEpisode = {
  symbol: string; firstAt: number; firstPrice: number; firstRatio: number; firstQuoteVolume: number;
  lastAt: number; count: number;
};

function closedCardBar(symbol: string, row: unknown[], observeVolume: boolean, closedBy: number, interval: number): MarketCardMinute | null {
  const [at, open, high, low, close, , closeAt, quoteVolume] = row.map((v) =>
    typeof v === "number" || (typeof v === "string" && v.trim()) ? Number(v) : NaN);
  if (at % interval !== 0 || closeAt !== at + interval - 1 || at + interval > closedBy) return null;
  const result = { symbol, at, open, high, low, close, quoteVolume, observeVolume };
  return validMinute(result) ? result : null;
}

export function closedCardMinute(symbol: string, row: unknown[], observeVolume: boolean, closedBy: number) {
  return closedCardBar(symbol, row, observeVolume, closedBy, MINUTE);
}

function validMinute(b: MarketCardMinute) {
  return b.symbol.length > 4 && b.symbol.endsWith("USDT") &&
    Number.isSafeInteger(b.at) && b.at >= 0 && b.at % MINUTE === 0 &&
    [b.open, b.high, b.low, b.close, b.quoteVolume].every(Number.isFinite) &&
    b.low > 0 && b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close) && b.quoteVolume >= 0;
}

export function createVolumeObservationStore(db: DatabaseSync, transaction: <T>(work: () => T) => T) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_card_minutes (
      symbol TEXT NOT NULL, at INTEGER NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      quote_volume REAL NOT NULL, observe_volume INTEGER NOT NULL, PRIMARY KEY (symbol, at)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS market_card_minutes_at ON market_card_minutes(at);
    CREATE TABLE IF NOT EXISTS market_card_five_minutes (
      symbol TEXT NOT NULL, at INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
      close REAL NOT NULL, quote_volume REAL NOT NULL, PRIMARY KEY (symbol, at)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS market_card_five_minutes_at ON market_card_five_minutes(at);
    CREATE TABLE IF NOT EXISTS market_volume_hits (
      symbol TEXT NOT NULL, at INTEGER NOT NULL, episode_at INTEGER NOT NULL,
      price REAL NOT NULL, ratio REAL NOT NULL, quote_volume REAL NOT NULL, PRIMARY KEY (symbol, at)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS market_volume_hits_at ON market_volume_hits(at);
    CREATE INDEX IF NOT EXISTS market_volume_hits_episode ON market_volume_hits(episode_at, symbol, at);
    CREATE TABLE IF NOT EXISTS market_liquidation_coverage (minute_at INTEGER PRIMARY KEY);
  `);
  const insertBar = db.prepare("INSERT OR IGNORE INTO market_card_minutes VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const window = db.prepare(`
    SELECT at, close, quote_volume AS q FROM market_card_minutes
    WHERE symbol=? AND observe_volume=1 AND at BETWEEN ? AND ? ORDER BY at
  `);
  const priorHit = db.prepare("SELECT episode_at FROM market_volume_hits WHERE symbol=? AND at<? ORDER BY at DESC LIMIT 1");
  const insertHit = db.prepare("INSERT OR IGNORE INTO market_volume_hits VALUES (?, ?, ?, ?, ?, ?)");
  const laterHits = db.prepare("SELECT at, episode_at FROM market_volume_hits WHERE symbol=? AND at>? ORDER BY at");
  const moveHit = db.prepare("UPDATE market_volume_hits SET episode_at=? WHERE symbol=? AND at=?");
  const insertCoverage = db.prepare("INSERT OR IGNORE INTO market_liquidation_coverage VALUES (?)");
  const deleteBars = db.prepare("DELETE FROM market_card_minutes WHERE at<?");
  const deleteFiveMinutes = db.prepare("DELETE FROM market_card_five_minutes WHERE at<?");
  const insertFiveMinutes = db.prepare("INSERT OR IGNORE INTO market_card_five_minutes VALUES(?,?,?,?,?,?,?)");
  const deleteHits = db.prepare("DELETE FROM market_volume_hits WHERE episode_at<?");
  const deleteCoverage = db.prepare("DELETE FROM market_liquidation_coverage WHERE minute_at<?");

  function recordHit(symbol: string, at: number, price: number, volume: number, ratio: number) {
    const previous = priorHit.get(symbol, at);
    let firstAt = previous && at - Number(previous.episode_at) < EPISODE_MS ? Number(previous.episode_at) : at;
    if (!insertHit.run(symbol, at, firstAt, price, ratio, volume).changes) return;
    // A late seed can fill a missing baseline. Re-anchor subsequent hits only until their original episode is reached.
    for (const later of laterHits.all(symbol, at)) {
      const nextAt = Number(later.at);
      if (nextAt - firstAt >= EPISODE_MS) firstAt = nextAt;
      if (Number(later.episode_at) === firstAt) break;
      moveHit.run(firstAt, symbol, nextAt);
    }
  }

  function evaluate(symbol: string, start: number, end: number) {
    const bars = window.all(symbol, start - BASELINE * MINUTE, end + BASELINE * MINUTE) as
      { at: number; close: number; q: number }[];
    for (let i = BASELINE; i < bars.length; i++) {
      const current = bars[i];
      if (current.at < start || current.q < 50_000 || current.at - bars[i - BASELINE].at !== BASELINE * MINUTE) continue;
      const volumes = bars.slice(i - BASELINE, i).map((b) => b.q).sort((a, b) => a - b);
      const median = (volumes[9] + volumes[10]) / 2;
      if (median > 0 && current.q / median >= 5) {
        // Binance T is the last millisecond inside the bar. The close is available at T + 1.
        recordHit(symbol, current.at + MINUTE, current.close, current.q, current.q / median);
      }
    }
  }

  let lastPrune = -Infinity;
  function prune(nowMs: number) {
    deleteBars.run(nowMs - CANDLE_RETENTION_MS);
    deleteFiveMinutes.run(cardWindowEnd(nowMs) - CARD_WINDOW_MS);
    deleteHits.run(nowMs - HIT_RETENTION_MS);
    deleteCoverage.run(nowMs - ALERTS_LIQUIDATION_RETENTION_MS);
  }

  function recordCardMinutes(minutes: MarketCardMinute[], nowMs: number) {
    if (!minutes.length) return;
    const shouldPrune = nowMs - lastPrune >= 5 * MINUTE;
    transaction(() => {
      const changed = new Map<string, { start: number; end: number }>();
      for (const b of minutes) {
        if (!validMinute(b) || b.at < nowMs - CANDLE_RETENTION_MS || b.at + MINUTE > nowMs) continue;
        const added = insertBar.run(b.symbol, b.at, b.open, b.high, b.low, b.close, b.quoteVolume, Number(b.observeVolume));
        if (!added.changes || !b.observeVolume) continue;
        const prior = changed.get(b.symbol);
        if (prior) {
          prior.start = Math.min(b.at, prior.start);
          prior.end = Math.max(b.at, prior.end);
        } else changed.set(b.symbol, { start: b.at, end: b.at });
      }
      for (const [symbol, r] of changed) evaluate(symbol, r.start, r.end);
      if (shouldPrune) prune(nowMs);
    });
    if (shouldPrune) lastPrune = nowMs;
  }

  const episodes = db.prepare(`
    WITH active AS (
      SELECT symbol, episode_at, MAX(at) AS lastAt FROM market_volume_hits
      WHERE at BETWEEN ? AND ? GROUP BY symbol, episode_at
    )
    SELECT a.symbol, a.episode_at AS firstAt, first.price AS firstPrice, first.ratio AS firstRatio,
      first.quote_volume AS firstQuoteVolume, a.lastAt,
      (SELECT COUNT(*) FROM market_volume_hits h
        WHERE h.symbol=a.symbol AND h.at BETWEEN a.episode_at AND a.lastAt) AS count
    FROM active a JOIN market_volume_hits first ON first.symbol=a.symbol AND first.at=a.episode_at
    ORDER BY a.lastAt DESC, a.symbol
  `);
  function listVolumeEpisodes(fromMs: number, nowMs: number): VolumeEpisode[] {
    return episodes.all(fromMs, nowMs).map((r) => ({ ...r }) as VolumeEpisode);
  }
  const chartBars = db.prepare(`
    SELECT symbol, at, open, high, low, close FROM market_card_minutes
    WHERE symbol IN (SELECT value FROM json_each(?)) AND at BETWEEN ? AND ? ORDER BY symbol, at
  `);
  function getCardCandles(symbols: string[], nowMs: number): Record<string, CardCandle[]> {
    const result: Record<string, CardCandle[]> = {};
    if (!symbols.length) return result;
    const latest = Math.floor(nowMs / MINUTE) * MINUTE - MINUTE;
    for (const row of chartBars.all(JSON.stringify(symbols), latest - 59 * MINUTE, latest)) {
      const { symbol, ...candle } = row;
      (result[String(symbol)] ??= []).push(candle as CardCandle);
    }
    return result;
  }
  const nativeCoverage = db.prepare("SELECT COUNT(*) AS n FROM market_card_five_minutes WHERE symbol=? AND at>=? AND at<?");
  function recordCardFiveMinuteKlines(symbol: string, klines: unknown[][], nowMs: number) {
    if (!klines.length) return;
    const end = cardWindowEnd(nowMs);
    const from = end - CARD_WINDOW_MS;
    // Most REST scans within this bucket already have every native close. Avoid taking a write lock then.
    if (nativeCoverage.get(symbol, from, end)?.n === CARD_CANDLE_COUNT) return;
    transaction(() => {
      for (const row of klines) {
        const b = closedCardBar(symbol, row, false, nowMs, CARD_CANDLE_MS);
        if (b && b.at >= from) insertFiveMinutes.run(symbol, b.at, b.open, b.high, b.low, b.close, b.quoteVolume);
      }
    });
  }

  const fiveMinuteChart = db.prepare(`
    WITH native AS (
      SELECT symbol, at, open, high, low, close, quote_volume AS quoteVolume FROM market_card_five_minutes
      WHERE symbol IN (SELECT value FROM json_each($symbols)) AND at >= $start AND at < $end
    ), minutes AS (
      SELECT *, at - at % ${CARD_CANDLE_MS} AS bucket FROM market_card_minutes
      WHERE symbol IN (SELECT value FROM json_each($symbols)
        EXCEPT SELECT symbol FROM native GROUP BY symbol HAVING COUNT(*) = ${CARD_CANDLE_COUNT})
        AND at >= $start AND at < $end
    ), aggregated AS (
      SELECT symbol, bucket AS at, MAX(CASE WHEN at=bucket THEN open END) AS open, MAX(high) AS high, MIN(low) AS low,
        MAX(CASE WHEN at=bucket+${CARD_CANDLE_MS - MINUTE} THEN close END) AS close, SUM(quote_volume) AS quoteVolume
      FROM minutes GROUP BY symbol,bucket HAVING COUNT(*)=${CARD_CANDLE_MS / MINUTE}
    )
    SELECT * FROM native UNION ALL
    SELECT a.* FROM aggregated a WHERE NOT EXISTS (SELECT 1 FROM native n WHERE n.symbol=a.symbol AND n.at=a.at)
    ORDER BY symbol,at
  `);
  function getCardFiveMinuteCandles(symbols: string[], nowMs: number): Record<string, CardFiveMinuteCandle[]> {
    const result: Record<string, CardFiveMinuteCandle[]> = {};
    if (!symbols.length) return result;
    const end = cardWindowEnd(nowMs);
    for (const row of fiveMinuteChart.all({ symbols: JSON.stringify(symbols), start: end - CARD_WINDOW_MS, end })) {
      const { symbol, ...bar } = row;
      (result[String(symbol)] ??= []).push(bar as CardFiveMinuteCandle);
    }
    return result;
  }

  const latestMinute = db.prepare(`
    SELECT b.symbol, b.at, b.close FROM json_each(?) w JOIN market_card_minutes b ON b.symbol=w.value AND b.at=(
      SELECT at FROM market_card_minutes WHERE symbol=w.value AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 1
    )
  `);
  function getLatestCardMinutes(symbols: string[], nowMs: number): Record<string, { at: number; close: number }> {
    const last = Math.floor(nowMs / MINUTE) * MINUTE - MINUTE;
    return Object.fromEntries(latestMinute.all(JSON.stringify(symbols), last - 59 * MINUTE, last)
      .map(row => [String(row.symbol), { at: Number(row.at), close: Number(row.close) }]));
  }

  function recordLiquidationCoverage(firstMinuteAt: number, endMinuteExclusive: number) {
    if (firstMinuteAt >= endMinuteExclusive) return;
    transaction(() => {
      for (let at = firstMinuteAt; at < endMinuteExclusive; at += MINUTE) insertCoverage.run(at);
    });
  }

  return { recordCardMinutes, recordCardFiveMinuteKlines, listVolumeEpisodes, getCardCandles, getCardFiveMinuteCandles,
    getLatestCardMinutes, recordLiquidationCoverage, prune };
}
