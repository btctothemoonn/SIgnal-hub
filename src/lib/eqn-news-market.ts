import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import { eqnArray, eqnNumber, eqnObject, eqnText, isEqnSymbol } from "./eqn-news-core.ts";
import { eqnFetchText, eqnRetryDelay, eqnWait, EqnUpstreamError } from "./eqn-news-client.ts";
import type { NewsCandle, NewsMarket, NewsReaction } from "./news-terminal-types.ts";

export const EQN_MARKET_INTERVALS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 } as const;
export type EqnMarketRequest = { symbol: string; venue: "binance" | "hyperliquid"; interval: keyof typeof EQN_MARKET_INTERVALS; assetId?: string | null };
export type EqnMarketView = "full" | "chart" | "stats";
export type EqnAsset = { symbol: string; pair: string; multiplier: number; tradable: boolean };
// Only cross-name/asset-id equivalences live here. New exact venue tickers do not need a registry entry.
const ASSET_IDS: Record<string, string[]> = {
  BTC: ["bitcoin"], ETH: ["ethereum"], SOL: ["solana"], BNB: ["binancecoin"], XRP: ["ripple"], DOGE: ["dogecoin"],
  ADA: ["cardano"], AVAX: ["avalanche-2"], LINK: ["chainlink"], DOT: ["polkadot"], LTC: ["litecoin"], BCH: ["bitcoin-cash"],
  SUI: ["sui"], APT: ["aptos"], ARB: ["arbitrum"], OP: ["optimism"], HYPE: ["hyperliquid"], TON: ["the-open-network"],
  PEPE: ["pepe"], SHIB: ["shiba-inu"], BONK: ["bonk"], FLOKI: ["floki"], LUNC: ["terra-luna"], XEC: ["ecash"],
  WIF: ["dogwifcoin"], TRUMP: ["official-trump"], UNI: ["uniswap"], AAVE: ["aave"], CRV: ["curve-dao-token"],
  ENA: ["ethena"], ONDO: ["ondo-finance"], INJ: ["injective-protocol"], NEAR: ["near"], SEI: ["sei-network"],
  TIA: ["celestia"], FIL: ["filecoin"], ATOM: ["cosmos"], ETC: ["ethereum-classic"], TRX: ["tron"], XLM: ["stellar"],
  WLD: ["worldcoin-wld"], RENDER: ["render-token"], TAO: ["bittensor"], FET: ["fetch-ai"], PENDLE: ["pendle"],
  JUP: ["jupiter-exchange-solana"], PYTH: ["pyth-network"], JTO: ["jito-governance-token"], EIGEN: ["eigenlayer"],
};
const SCALED: Record<string, { binance: string; hyperliquid: string }> = {
  PEPE: { binance: "1000PEPE", hyperliquid: "kPEPE" }, SHIB: { binance: "1000SHIB", hyperliquid: "kSHIB" },
  BONK: { binance: "1000BONK", hyperliquid: "kBONK" }, FLOKI: { binance: "1000FLOKI", hyperliquid: "kFLOKI" },
  LUNC: { binance: "1000LUNC", hyperliquid: "kLUNC" }, XEC: { binance: "1000XEC", hyperliquid: "kXEC" },
};
// Explicit cross-exchange names for the same contract (Bybit LONGXIAUSDT is Binance 龙虾USDT).
const NAMED: Record<string, Partial<Record<EqnMarketRequest["venue"], string>>> = { LONGXIA: { binance: "龙虾" } };
export function resolveEqnAsset(symbol: string, venue: EqnMarketRequest["venue"], metadata: unknown[], assetId?: string | null): EqnAsset | null {
  const canonical = symbol.trim().toUpperCase();
  if (!isEqnSymbol(canonical)) return null;
  // asset_id namespace must be known. Do not silently equate unrelated assets sharing a ticker.
  if (assetId && !ASSET_IDS[canonical]?.includes(assetId.replace(/^coingecko:/, ""))) return null;
  const rows = metadata.map(eqnObject);
  const candidates = [canonical, SCALED[canonical]?.[venue], NAMED[canonical]?.[venue]].filter((value): value is string => Boolean(value));
  // Crypto perpetuals are tradable. Equity/TradFi markets are chart-only until the trader explicitly supports them.
  const kinds = venue === "binance"
    ? [{ market: "PERPETUAL", tradable: true }, { market: "TRADIFI_PERPETUAL", tradable: false }]
    : [{ market: "", tradable: true }, { market: "xyz", tradable: false }];
  for (const kind of kinds) for (const candidate of candidates) {
    const matches = rows.filter((row) => venue === "binance"
      ? row.baseAsset === candidate && row.quoteAsset === "USDT" && row.status === "TRADING" && row.contractType === kind.market && row.symbol === `${candidate}USDT`
      : row.name === (kind.market ? `${kind.market}:${candidate}` : candidate) && row.isDelisted !== true);
    // The trader only signs ASCII symbols; CJK-named Binance perpetuals are chart-only.
    if (matches.length === 1) return { symbol: canonical, pair: venue === "binance" ? String(matches[0].symbol) : String(matches[0].name), multiplier: candidate === SCALED[canonical]?.[venue] ? 1000 : 1, tradable: kind.tradable && /^[A-Za-z0-9]+$/.test(candidate) };
  }
  return null;
}

export function parseEqnMarketQuery(params: URLSearchParams): EqnMarketRequest {
  const symbol = (params.get("symbol") || "BTC").trim().toUpperCase();
  const venue = params.get("venue") || "binance";
  const interval = params.get("interval") || "1m";
  const assetId = params.get("assetId");
  if (!isEqnSymbol(symbol)) throw new Error("Invalid symbol");
  if (venue !== "binance" && venue !== "hyperliquid") throw new Error("Invalid venue");
  if (!Object.hasOwn(EQN_MARKET_INTERVALS, interval)) throw new Error("Invalid interval");
  if ((assetId?.length ?? 0) > 160) throw new Error("Invalid assetId");
  return { symbol, venue, interval: interval as EqnMarketRequest["interval"], assetId };
}

export function calculateEqnReactions(publishedAt: number, candles: NewsCandle[], now = Date.now(), windows = [1, 5, 15, 60]): NewsReaction[] {
  const sorted = candles.filter((c) => Number.isFinite(c.time) && c.open > 0).sort((a, b) => a.time - b.time);
  const atOrAfter = (time: number) => sorted.find((c) => c.time >= time && c.time < time + 60000 && c.time <= now);
  const baseline = atOrAfter(publishedAt);
  return windows.map((minutes) => {
    const target = publishedAt + minutes * 60000;
    const candle = target <= now ? atOrAfter(target) : undefined;
    return { minutes, change: baseline && candle ? (candle.open / baseline.open - 1) * 100 : null };
  });
}

export function readEqnMarketContext(pair: string, since?: number, path = process.env.MARKET_ALERTS_DB?.trim() || getRuntimeDataPath(process.env, "market-alerts", "alerts.sqlite")) {
  const empty = { marketCap: null as number | null, fdv: null as number | null, ticker: null as EqnTickerSnapshot | null, signals: [] as { title: string; occurredAt: string; url: string }[] };
  const signalsPath = process.env.MARKET_SIGNALS_DB?.trim() || getRuntimeDataPath(process.env, "market-alerts", "signals.sqlite");
  let db: DatabaseSync | undefined;
  try {
    if (existsSync(path)) {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout=1000");
    const hasTable = (name: string) => Boolean(db!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
    // SELECT * tolerates older market-alert schemas that predate the price snapshot columns.
    const ticker = hasTable("market_alert_tickers") ? db.prepare("SELECT * FROM market_alert_tickers WHERE symbol=?").get(pair) : undefined;
    // Old valuations are not current market data. Never derive FDV from a guessed supply.
    if (ticker && Date.now() - Date.parse(String(ticker.valuation_updated_at)) < 86400000) {
      empty.marketCap = eqnNumber(ticker.market_cap_usd); empty.fdv = eqnNumber(ticker.fdv_usd);
    }
    const price = eqnNumber(ticker?.price); const updatedAt = Date.parse(String(ticker?.updated_at));
    if (price !== null && price > 0 && Number.isFinite(updatedAt)) empty.ticker = { price, change24h: eqnNumber(ticker!.pct_24h), volume24h: eqnNumber(ticker!.quote_volume), updatedAt };
    if (since !== undefined && hasTable("market_alert_events")) {
      empty.signals = db.prepare("SELECT id,type,stage,occurred_at FROM market_alert_events WHERE symbol=? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 20").all(pair, new Date(since).toISOString()).map((row) => ({
        title: `${eqnText(row.type, 40)} ${eqnText(row.stage, 160)} `.trim(), occurredAt: String(row.occurred_at), url: `/alerts?symbol=${encodeURIComponent(pair)}&event=${encodeURIComponent(String(row.id))}`,
      }));
    }
    }
  } catch { /* Existing market database is optional and may be migrating. */ }
  finally { db?.close(); }
  if (since !== undefined && existsSync(signalsPath)) {
    let signals: DatabaseSync | undefined;
    try {
      signals = new DatabaseSync(signalsPath, { readOnly: true });
      signals.exec("PRAGMA busy_timeout=1000");
      const rows = signals.prepare("SELECT id,kind,signal_at FROM market_signals WHERE symbol=? AND signal_at>=? ORDER BY signal_at DESC LIMIT 20").all(pair, new Date(since).toISOString());
      empty.signals.push(...rows.map((row) => ({ title: eqnText(row.kind, 160), occurredAt: String(row.signal_at), url: `/alerts?symbol=${encodeURIComponent(pair)}&signal=${encodeURIComponent(String(row.id))}` })));
    } catch { /* Signal strategy storage is independent from market alert/ticker storage. */ }
    finally { signals?.close(); }
  }
  empty.signals = empty.signals.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 20);
  return empty;
}

export type EqnTickerSnapshot = { price: number; change24h: number | null; volume24h: number | null; updatedAt: number };
// Shared with the market-alert worker. Interactive chart requests may jump at most 1s of background backlog,
// but they still advance the shared slot and always honor a Binance 429/418 block.
export interface EqnBinanceRateLimit { reserve(now: number, priority?: boolean): number; defer(until: number): void }
function existingBinanceRateLimit(): EqnBinanceRateLimit {
  const path = () => process.env.MARKET_ALERTS_DB?.trim() || getRuntimeDataPath(process.env, "market-alerts", "alerts.sqlite");
  const withDb = <T>(fallback: T, fn: (db: DatabaseSync) => T): T => {
    if (!existsSync(path())) return fallback;
    let db: DatabaseSync | undefined;
    try { db = new DatabaseSync(path()); db.exec("PRAGMA busy_timeout=1000"); return fn(db); }
    catch { return fallback; }
    finally { db?.close(); }
  };
  return {
    reserve(now, priority = false) {
      return withDb(0, (db) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const state = db.prepare("SELECT next_request_at,blocked_until FROM market_alert_binance_rate_limit WHERE id=1").get();
          const next = Number(state?.next_request_at ?? 0); const blocked = Number(state?.blocked_until ?? 0);
          const ready = Math.max(now, blocked, priority ? Math.min(next, now + 1000) : next);
          if (ready - now < 10000) db.prepare("UPDATE market_alert_binance_rate_limit SET next_request_at=?,updated_at=? WHERE id=1").run(Math.max(next, ready) + 200, new Date(now).toISOString());
          db.exec("COMMIT"); return ready - now;
        } catch (e) { db.exec("ROLLBACK"); throw e; }
      });
    },
    defer(until) { withDb(undefined, (db) => { db.prepare("UPDATE market_alert_binance_rate_limit SET blocked_until=MAX(blocked_until,?),updated_at=? WHERE id=1").run(until, new Date().toISOString()); }); },
  };
}

type MarketRuntime = {
  fetch?: typeof fetch; now?: () => number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>;
  valuations?: (pair: string) => { marketCap: number | null; fdv: number | null; ticker?: EqnTickerSnapshot | null };
  rateLimit?: EqnBinanceRateLimit | null;
  optionalWaitMs?: number;
};
function normalizeCandle(value: unknown, venue: EqnMarketRequest["venue"]): NewsCandle | null {
  const row = eqnObject(value); const arr = eqnArray(value);
  const values = venue === "binance" ? arr.slice(0, 6).map(eqnNumber) : [row.t, row.o, row.h, row.l, row.c, row.v].map(eqnNumber);
  if (values.length !== 6 || values.some((x) => x === null)) return null;
  const [time, open, high, low, close, volume] = values as number[];
  if (time <= 0 || Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || volume < 0) return null;
  return { time, open, high, low, close, volume };
}

export function createEqnMarketClient(runtime: MarketRuntime = {}) {
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? ((ms) => eqnWait(ms, runtime.signal));
  const rateLimit = runtime.rateLimit === undefined ? existingBinanceRateLimit() : runtime.rateLimit;
  const cache = new Map<string, { expires: number; value: unknown }>();
  const flights = new Map<string, Promise<unknown>>();
  const stale = new Map<string, unknown>();
  const recentCandles = new Map<string, NewsCandle[]>();
  const cooldown = { binance: 0, hyperliquid: 0 };
  let queue = Promise.resolve();
  let nextAt = 0;
  async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const entry = cache.get(key);
    if (entry && entry.expires > now()) { cache.delete(key); cache.set(key, entry); return entry.value as T; }
    if (flights.has(key)) return flights.get(key) as Promise<T>;
    if (flights.size >= 24) throw new EqnUpstreamError("Market request capacity reached", 503);
    const flight = fn().then((value) => {
      cache.delete(key); cache.set(key, { expires: now() + ttl, value });
      if (key.startsWith("metadata:")) stale.set(key, value);
      while (cache.size > 128) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => flights.delete(key));
    flights.set(key, flight); return flight;
  }
  // Exchange metadata changes rarely: serve the previous copy instantly and refresh it in the background.
  async function revalidated<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const entry = cache.get(key);
    const previous = stale.get(key) as T | undefined;
    if ((!entry || entry.expires <= now()) && previous !== undefined) {
      cached(key, ttl, fn).catch(() => {});
      return previous;
    }
    return cached(key, ttl, fn);
  }
  async function json(venue: EqnMarketRequest["venue"], url: string, body?: unknown, priority = false): Promise<unknown> {
    const reservation = queue.then(async () => {
      const blocked = cooldown[venue] - now();
      if (blocked > 0) throw new EqnUpstreamError("Market upstream cooling down", 429, cooldown[venue]);
      const wait = Math.max(0, nextAt - now(), venue === "binance" ? rateLimit?.reserve(now(), priority) ?? 0 : 0);
      if (wait >= 10000) throw new EqnUpstreamError("Market upstream busy; retry later", 429);
      if (wait) await sleep(wait);
      nextAt = now() + 200;
    });
    queue = reservation.catch(() => {});
    await reservation;
    const { response, text } = await eqnFetchText(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}, { ...runtime, timeoutMs: 8000 });
    if (response.status === 429 || response.status === 418) {
      cooldown[venue] = now() + eqnRetryDelay(response.headers.get("retry-after"), now());
      if (venue === "binance") rateLimit?.defer(cooldown[venue]);
      throw new EqnUpstreamError("Market upstream rate limited", 429, cooldown[venue]);
    }
    if (!response.ok) throw new EqnUpstreamError(`Market upstream HTTP ${response.status}`, response.status);
    return JSON.parse(text);
  }
  const binance = (path: string, priority = false) => json("binance", `https://fapi.binance.com/fapi/v1/${path}`, undefined, priority);
  const hl = (body: unknown) => json("hyperliquid", "https://api.hyperliquid.xyz/info", body);
  async function metadata(venue: EqnMarketRequest["venue"]) {
    if (venue === "binance") return revalidated("metadata:binance", 300000, async () => {
      const value = eqnObject(await binance("exchangeInfo", true));
      if (!Array.isArray(value.symbols)) throw new EqnUpstreamError("Binance metadata unavailable");
      return { rows: value.symbols, contexts: [] as unknown[] };
    });
    return revalidated("metadata:hyperliquid", 15000, async () => {
      const read = async (dex?: string) => {
        const value = eqnArray(await hl(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" }));
        const rows = eqnObject(value[0]).universe;
        if (!Array.isArray(rows) || !Array.isArray(value[1]) || rows.length !== value[1].length) throw new EqnUpstreamError("Hyperliquid metadata unavailable");
        return { rows: rows as unknown[], contexts: value[1] as unknown[] };
      };
      const main = await read();
      // The HIP-3 xyz dex carries equity charts such as xyz:NVDA; main-market crypto must keep working if it is unavailable.
      const xyz = await read("xyz").catch(() => ({ rows: [] as unknown[], contexts: [] as unknown[] }));
      return { rows: [...main.rows, ...xyz.rows], contexts: [...main.contexts, ...xyz.contexts] };
    });
  }
  async function asset(request: EqnMarketRequest) {
    const meta = await metadata(request.venue);
    return { mapping: resolveEqnAsset(request.symbol, request.venue, meta.rows, request.assetId), meta };
  }
  async function getCandles(request: EqnMarketRequest, start?: number, end?: number): Promise<NewsCandle[]> {
    const { mapping } = await asset(request);
    if (!mapping) return [];
    const endTime = end ?? now();
    const step = EQN_MARKET_INTERVALS[request.interval];
    const windowStart = Math.floor(endTime / step) * step - step * 499;
    const historyKey = `${request.venue}:${mapping.pair}:${request.interval}`;
    const previous = start === undefined && end === undefined ? recentCandles.get(historyKey) : undefined;
    // Re-fetch the last open candle too. A long absence naturally falls back to the full window.
    const startTime = start ?? Math.max(windowStart, previous?.at(-1)?.time ?? windowStart);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime || endTime - startTime > step * 1440) throw new Error("Invalid candle window");
    const key = `candles:${request.venue}:${mapping.pair}:${request.interval}:${start === undefined ? "recent" : startTime}:${end === undefined ? "now" : endTime}`;
    return cached(key, 15000, async () => {
      const limit = String(Math.min(1500, Math.max(1, Math.floor(endTime / step) - Math.ceil(startTime / step) + 1)));
      const response = request.venue === "binance"
        ? await binance(`klines?${new URLSearchParams({ symbol: mapping.pair, interval: request.interval, limit, startTime: String(Math.floor(startTime)), endTime: String(Math.floor(endTime)) })}`, true)
        : await hl({ type: "candleSnapshot", req: { coin: mapping.pair, interval: request.interval, startTime: Math.floor(startTime), endTime: Math.floor(endTime) } });
      if (!Array.isArray(response)) throw new EqnUpstreamError("Candle data unavailable");
      const candles = response.slice(0, 1440).map((row) => normalizeCandle(row, request.venue)).filter((x): x is NewsCandle => x !== null);
      if (!candles.length) return [];
      const merged = [...new Map([...(previous ?? []), ...candles].map((candle) => [candle.time, candle])).values()]
        .filter((candle) => candle.time >= (start ?? windowStart) && candle.time <= endTime)
        .sort((a, b) => a.time - b.time);
      if (start === undefined && end === undefined) {
        recentCandles.delete(historyKey);
        recentCandles.set(historyKey, merged.slice(-500));
        while (recentCandles.size > 64) recentCandles.delete(recentCandles.keys().next().value!);
      }
      return merged;
    });
  }
  async function loadMarket(request: EqnMarketRequest, view: EqnMarketView): Promise<NewsMarket> {
    const result: NewsMarket = { symbol: request.symbol, pair: null, venue: request.venue, tradable: false, price: null, change24h: null, marketCap: null, fdv: null, volume24h: null, fundingRate: null, openInterest: null, candles: [], fetchedAt: now(), error: null };
    const errors: string[] = [];
    try {
      const { mapping, meta } = await asset(request);
      if (!mapping) { result.error = `${request.venue === "binance" ? "币安" : "Hyperliquid"}暂无 ${request.symbol} 合约行情`; return result; }
      result.pair = mapping.pair; result.tradable = mapping.tradable;
      if (view === "chart") {
        result.candles = (await getCandles(request)).map((candle) => ({ ...candle, time: Math.floor(candle.time / 1000) }));
        result.price = result.candles.at(-1)?.close ?? null;
        result.error = result.candles.length ? null : "Candles empty";
        result.fetchedAt = now();
        return result;
      }
      const valuationPair = request.venue === "binance" ? mapping.pair : `${SCALED[request.symbol]?.binance ?? request.symbol}USDT`;
      const valuation = (runtime.valuations ?? readEqnMarketContext)(valuationPair);
      result.marketCap = valuation.marketCap; result.fdv = valuation.fdv;
      let settled = false;
      const capture = async <T>(label: string, fn: () => Promise<T>, apply: (value: T) => void) => {
        try { apply(await fn()); } catch { errors.push(`${label} unavailable`); }
      };
      // Display-only fields must not hold the chart hostage. Late results still warm the cache for the next poll.
      const optional = <T>(fn: () => Promise<T>, apply: (value: T) => void) => {
        const task = fn().then((value) => { if (!settled) apply(value); }, () => {});
        return Promise.race([task, new Promise<void>((resolve) => setTimeout(resolve, runtime.optionalWaitMs ?? 1200))]);
      };
      const candles = view === "stats" ? Promise.resolve() : capture("Candles", () => getCandles(request), (value) => { result.candles = value; if (!value.length) errors.push("Candles empty"); });
      if (request.venue === "binance") {
        await Promise.all([
          candles,
          optional(() => cached(`ticker:${mapping.pair}`, 15000, () => binance(`ticker/24hr?symbol=${encodeURIComponent(mapping.pair)}`)), (value) => {
            const ticker = eqnObject(value);
            result.price = eqnNumber(ticker.lastPrice);
            result.change24h = eqnNumber(ticker.priceChangePercent); result.volume24h = eqnNumber(ticker.quoteVolume);
          }),
          optional(() => cached(`funding:${mapping.pair}`, 30000, () => binance(`premiumIndex?symbol=${encodeURIComponent(mapping.pair)}`)), (value) => { result.fundingRate = eqnNumber(eqnObject(value).lastFundingRate); }),
          optional(() => cached(`oi:${mapping.pair}`, 30000, () => binance(`openInterest?symbol=${encodeURIComponent(mapping.pair)}`)), (value) => { result.openInterest = eqnNumber(eqnObject(value).openInterest); }),
        ]);
        settled = true;
        // The current candle close is live; the market-alert snapshot fills 24h stats while the ticker cache warms.
        result.price ??= result.candles.at(-1)?.close ?? (valuation.ticker && now() - valuation.ticker.updatedAt < 180000 ? valuation.ticker.price : null);
        if (result.change24h === null && valuation.ticker && now() - valuation.ticker.updatedAt < 180000) {
          result.change24h = valuation.ticker.change24h; result.volume24h = valuation.ticker.volume24h;
        }
        if (result.price === null) errors.push("Ticker price missing");
      } else {
        const index = meta.rows.findIndex((row) => eqnObject(row).name === mapping.pair);
        const ticker = eqnObject(meta.contexts[index]); const price = eqnNumber(ticker.markPx); const previous = eqnNumber(ticker.prevDayPx);
        result.price = price;
        result.change24h = price !== null && previous && previous > 0 ? (price / previous - 1) * 100 : null;
        result.volume24h = eqnNumber(ticker.dayNtlVlm); result.fundingRate = eqnNumber(ticker.funding); result.openInterest = eqnNumber(ticker.openInterest);
        if (result.price === null) errors.push("Ticker unavailable");
        await candles;
      }
      // OI is quote notional USD; contract quantities differ between scaled markets.
      if (result.openInterest !== null) result.openInterest = result.price === null ? null : result.openInterest * result.price;
    } catch { errors.push("Venue metadata unavailable"); }
    result.error = errors.length ? errors.join("; ") : null;
    // Internal exchange/reaction candle times are ms; chart-facing NewsMarket uses Unix seconds.
    result.candles = result.candles.map((candle) => ({ ...candle, time: Math.floor(candle.time / 1000) }));
    result.fetchedAt = now();
    return result;
  }
  return {
    resolve: async (request: EqnMarketRequest) => (await asset(request)).mapping,
    getCandles,
    async getMarket(request: EqnMarketRequest, view: EqnMarketView = "full"): Promise<NewsMarket> {
      const key = `market:${view}:${request.venue}:${request.symbol}:${request.interval}:${request.assetId ?? ""}`;
      const entry = cache.get(key)?.value as NewsMarket | undefined;
      try {
        return await cached(key, 15000, async () => {
          const fresh = await loadMarket(request, view);
          if (fresh.error && entry?.pair && now() - entry.fetchedAt < 120000 && fresh.pair === entry.pair) {
            return { ...fresh, price: fresh.price ?? entry.price, change24h: fresh.change24h ?? entry.change24h, volume24h: fresh.volume24h ?? entry.volume24h, candles: fresh.candles.length ? fresh.candles : entry.candles, fetchedAt: entry.fetchedAt, error: `Partial/stale market data: ${fresh.error}` };
          }
          return fresh;
        });
      } catch { return { symbol: request.symbol, pair: null, venue: request.venue, tradable: false, price: null, change24h: null, marketCap: null, fdv: null, volume24h: null, fundingRate: null, openInterest: null, candles: [], fetchedAt: now(), error: "Market capacity reached; retry later" }; }
    },
  };
}
let singleton: ReturnType<typeof createEqnMarketClient> | undefined;
export function getEqnMarketClient() { return singleton ??= createEqnMarketClient(); }
